/**
 * After Manual `@depends-on` additions, align same-folder `requestOrder`
 * so producers precede consumers. Presentation/UX only — never persists Auto edges.
 */

import { window } from 'vscode';

import {
  minimalReorderForConstraints,
  normalizePathKey,
  pathBasename,
  type Collection,
  type CollectionMutationService,
  type Folder,
  type OrderConstraint,
  type RequestReference,
  type WorkspaceCollections,
} from '../../collections';
import {
  analyzeCollectionDependencies,
  buildDependencyGraph,
  countLabelOccurrencesForCyclePath,
  detectCycles,
  formatCyclePath,
  parseDependRef,
  resolveDependRef,
  type DependRefIndexEntry,
} from '../../dependencies';
import { buildRequestEditorDependencyCatalog } from './dependency-catalog';

const REORDER_MESSAGE =
  'Collection reordered to satisfy execution dependencies.';

/** Prevents overlapping align + Undo from clobbering `requestOrder`. */
let alignInFlight = false;

export interface AlignCollectionOrderOnDependsOptions {
  readonly aggregate: WorkspaceCollections | undefined;
  readonly documentPath: string;
  readonly previousDependsOn: readonly string[];
  readonly nextDependsOn: readonly string[];
  readonly mutation: CollectionMutationService;
  readonly readText: (filePath: string) => Promise<string>;
  /** Optional analysis cache shared with the request editor projection. */
  readonly analysisCache?: Map<
    string,
    import('../../dependencies').RequestDependencyAnalysis
  >;
}

/**
 * Reorders same-folder siblings when new Manual depends-on refs require it.
 * No-ops when nothing added, cross-folder, already ordered, or a cycle exists.
 */
export async function alignCollectionOrderOnDepends(
  options: AlignCollectionOrderOnDependsOptions,
): Promise<void> {
  if (alignInFlight) {
    return;
  }

  const added = addedDependRefs(
    options.previousDependsOn,
    options.nextDependsOn,
  );
  if (added.length === 0) {
    return;
  }

  alignInFlight = true;
  try {
    await alignCollectionOrderOnDependsUnlocked(options, added);
  } finally {
    alignInFlight = false;
  }
}

async function alignCollectionOrderOnDependsUnlocked(
  options: AlignCollectionOrderOnDependsOptions,
  added: readonly string[],
): Promise<void> {
  const aggregate = options.aggregate;
  if (aggregate === undefined) {
    return;
  }

  const located = findRequestForDocumentPath(aggregate, options.documentPath);
  if (located === undefined) {
    return;
  }
  const { collection, request: consumer } = located;
  if (collection.kind !== 'native') {
    return;
  }

  const consumerFolderPath = folderPathFor(collection, consumer);
  const catalog = buildRequestEditorDependencyCatalog({
    aggregate,
    documentPath: options.documentPath,
    currentRequestId: consumer.id,
  });
  const index: DependRefIndexEntry[] = Object.values(collection.requests).map(
    (entry) => ({
      requestId: entry.id,
      name: entry.display.label,
      folderPath: folderPathFor(collection, entry),
    }),
  );

  const constraints: OrderConstraint[] = [];
  for (const dependRef of added) {
    const producerId = resolveProducerRequestId(dependRef, catalog, index);
    if (producerId === undefined) {
      continue;
    }
    const producer = collection.requests[producerId];
    if (producer === undefined) {
      continue;
    }
    if (folderPathFor(collection, producer) !== consumerFolderPath) {
      continue;
    }
    constraints.push({ beforeId: producerId, afterId: consumer.id });
  }
  if (constraints.length === 0) {
    return;
  }

  const gate = await detectCollectionReorderGate({
    collection,
    readText: options.readText,
    analysisCache: options.analysisCache,
  });
  if (gate.kind === 'block') {
    void window.showErrorMessage(`API Hero: ${gate.message}`);
    return;
  }

  const siblingIds =
    consumerFolderPath.length === 0
      ? collection.rootRequestIds
      : collection.folders[consumer.folderId ?? '']?.requestIds ?? [];
  if (siblingIds.length === 0) {
    return;
  }

  const reorder = minimalReorderForConstraints(siblingIds, constraints);
  if (!reorder.changed) {
    return;
  }

  const previousBasenames = uniqueFileNames(siblingIds, collection);
  const nextBasenames = uniqueFileNames(reorder.order, collection);
  if (
    previousBasenames.length === 0 ||
    arraysEqual(previousBasenames, nextBasenames)
  ) {
    return;
  }

  await options.mutation.reorderRequests(
    collection.id,
    consumerFolderPath,
    nextBasenames,
  );

  const choice = await window.showInformationMessage(REORDER_MESSAGE, 'Undo');
  if (choice === 'Undo') {
    try {
      await options.mutation.reorderRequests(
        collection.id,
        consumerFolderPath,
        previousBasenames,
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unknown error.';
      void window.showErrorMessage(
        `API Hero: Could not restore the previous collection order. ${detail}`,
      );
    }
  }
}

function addedDependRefs(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  const prevSet = new Set(previous.map((entry) => entry.trim()).filter(Boolean));
  const added: string[] = [];
  const seen = new Set<string>();
  for (const entry of next) {
    const trimmed = entry.trim();
    if (trimmed.length === 0 || prevSet.has(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    added.push(trimmed);
  }
  return added;
}

function resolveProducerRequestId(
  dependRef: string,
  catalog: readonly {
    readonly dependRef: string;
    readonly requestId?: string;
  }[],
  index: readonly DependRefIndexEntry[],
): string | undefined {
  const fromCatalog = catalog.find((entry) => entry.dependRef === dependRef);
  if (fromCatalog?.requestId !== undefined && fromCatalog.requestId.length > 0) {
    return fromCatalog.requestId;
  }
  const parsed = parseDependRef(dependRef);
  if (parsed === undefined) {
    return undefined;
  }
  const resolved = resolveDependRef(parsed, index);
  return resolved.ok ? resolved.requestId : undefined;
}

type ReorderGate =
  | { readonly kind: 'ok' }
  | { readonly kind: 'block'; readonly message: string };

/**
 * Fail-closed: cycles and unresolved/ambiguous `@depends-on` graph failures
 * block visual reorder (aligned with runner enrich).
 */
async function detectCollectionReorderGate(options: {
  readonly collection: Collection;
  readonly readText: (filePath: string) => Promise<string>;
  readonly analysisCache?: Map<
    string,
    import('../../dependencies').RequestDependencyAnalysis
  >;
}): Promise<ReorderGate> {
  const requests = Object.values(options.collection.requests);
  const labelByRequestId = new Map<string, string>();
  const folderPathByRequestId = new Map<string, string>();
  for (const request of requests) {
    labelByRequestId.set(request.id, request.display.label);
    folderPathByRequestId.set(
      request.id,
      folderPathFor(options.collection, request),
    );
  }

  const analyses = await analyzeCollectionDependencies({
    requests: requests.map((request) => ({
      requestId: request.id,
      filePath: request.filePath,
      offset: request.range.start.offset,
    })),
    readText: options.readText,
    analysisCache: options.analysisCache,
  });

  const graphResult = buildDependencyGraph({
    analyses,
    labelByRequestId,
    folderPathByRequestId,
  });
  if (!graphResult.ok) {
    return { kind: 'block', message: graphResult.message };
  }

  const cycleResult = detectCycles(graphResult.graph);
  if (!cycleResult.hasCycle) {
    return { kind: 'ok' };
  }

  const labelCounts = countLabelOccurrencesForCyclePath(labelByRequestId);
  return {
    kind: 'block',
    message: `Dependency cycle detected: ${cycleResult.cycles
      .map((cycle) => formatCyclePath(cycle, labelByRequestId, labelCounts))
      .join('; ')}`,
  };
}

function findRequestForDocumentPath(
  aggregate: WorkspaceCollections,
  documentPath: string,
): { readonly collection: Collection; readonly request: RequestReference } | undefined {
  for (const collection of Object.values(aggregate.collections)) {
    for (const request of Object.values(collection.requests)) {
      if (pathsMatch(request.filePath, documentPath)) {
        return { collection, request };
      }
    }
  }
  return undefined;
}

function pathsMatch(left: string, right: string): boolean {
  return normalizePathKey(left) === normalizePathKey(right);
}

function folderPathFor(
  collection: Collection,
  request: RequestReference,
): string {
  if (request.folderId === undefined) {
    return '';
  }
  const folder: Folder | undefined = collection.folders[request.folderId];
  return folder?.relativePath ?? '';
}

function uniqueFileNames(
  requestIds: readonly string[],
  collection: Collection,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of requestIds) {
    const request = collection.requests[id];
    if (request === undefined) {
      continue;
    }
    const name = pathBasename(request.filePath);
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
