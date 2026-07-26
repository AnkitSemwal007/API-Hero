/**
 * Thin editor projection over the existing dependency engine (ADR 0003).
 * Framework-free — never owns edge inference, cycles, or topo.
 *
 * Editor → {@link buildDependencyGraph} → Runner (same analyses ⇒ same edges).
 */

import { parseApiDocument } from '../parser';
import type { DependencyEdge } from '../collection-runner';
import {
  formatDependRef,
  minimalDependRefFor,
  type DependRefIndexEntry,
} from './depend-ref';
import { buildDependencyGraph } from './graph-builder';
import type { RequestDependencyAnalysis } from './models';
import { analyzeProducesConsumesForDocument } from './produces-consumes';

/** One Auto (inferred) producer group for the focused request. */
export interface AutoDependencyView {
  readonly dependRef: string;
  readonly fromRequestId: string;
  readonly variables: readonly string[];
}

/** One Manual (`@depends-on`) producer for the focused request. */
export interface ManualDependencyView {
  readonly dependRef: string;
  readonly fromRequestId: string;
}

/** Variable with more than one in-collection extract producer (Q1 Option A). */
export interface AmbiguousProducerView {
  readonly variable: string;
  readonly producers: readonly {
    readonly dependRef: string;
    readonly requestId: string;
  }[];
}

/**
 * Request-editor projection of {@link buildDependencyGraph} for one focus
 * request. View models only — not a second graph.
 */
export type VariableDependencyProjection = {
  readonly auto: readonly AutoDependencyView[];
  readonly manual: readonly ManualDependencyView[];
  readonly unknownVariables: readonly string[];
  readonly ambiguousProducers: readonly AmbiguousProducerView[];
  /** Same edges `buildDependencyGraph` returned — equality-test with runner. */
  readonly graphEdges: readonly DependencyEdge[];
};

export type ProjectVariableDependenciesResult =
  | VariableDependencyProjection
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ProjectVariableDependenciesOptions {
  readonly analyses: readonly RequestDependencyAnalysis[];
  readonly labelByRequestId: ReadonlyMap<string, string>;
  readonly folderPathByRequestId?: ReadonlyMap<string, string>;
  readonly focusRequestId: string;
  /**
   * Env / workspace / collection / global names (Q2). Filter Unknown
   * diagnostics only — never create edges.
   */
  readonly staticVariableNames?: ReadonlySet<string>;
  /**
   * Workspace-suppressed unknown names (Q3). Filter Unknown list only.
   */
  readonly ignoredVariableNames?: ReadonlySet<string>;
}

/** One collection member to analyze (whole-collection index, Q5). */
export interface CollectionDependencyRequestRef {
  readonly requestId: string;
  readonly filePath: string;
  /** Offset into the owning file (typically `range.start.offset`). */
  readonly offset: number;
}

export interface AnalyzeCollectionDependenciesOptions {
  readonly requests: readonly CollectionDependencyRequestRef[];
  readonly readText: (filePath: string) => Promise<string>;
  /**
   * Optional analysis cache keyed by `filePath\\0fingerprint\\0offset`.
   * Avoids re-parse when file content is unchanged (RULE 9).
   */
  readonly analysisCache?: Map<string, RequestDependencyAnalysis>;
}

/**
 * Projects Auto / Manual / Unknown / Ambiguous for `focusRequestId` by calling
 * {@link buildDependencyGraph} once — no custom edge inference.
 */
export function projectVariableDependencies(
  options: ProjectVariableDependenciesOptions,
): ProjectVariableDependenciesResult {
  const graphResult = buildDependencyGraph({
    analyses: options.analyses,
    labelByRequestId: options.labelByRequestId,
    folderPathByRequestId: options.folderPathByRequestId,
  });
  if (!graphResult.ok) {
    return {
      ok: false,
      code: graphResult.code,
      message: graphResult.message,
    };
  }

  const focusRequestId = options.focusRequestId;
  const staticNames = options.staticVariableNames ?? new Set<string>();
  const ignoredNames = options.ignoredVariableNames ?? new Set<string>();
  const index = buildIndex(
    options.labelByRequestId,
    options.folderPathByRequestId ?? new Map(),
  );

  const autoByFrom = new Map<string, string[]>();
  const manual: ManualDependencyView[] = [];
  const producersByVariable = new Map<string, Set<string>>();

  for (const edge of graphResult.graph.edges) {
    if (edge.toRequestId !== focusRequestId) {
      continue;
    }
    if (edge.kind === 'explicit') {
      manual.push({
        dependRef: dependRefFor(edge.fromRequestId, index),
        fromRequestId: edge.fromRequestId,
      });
      continue;
    }
    if (edge.kind === 'implicit') {
      const variables = autoByFrom.get(edge.fromRequestId) ?? [];
      if (edge.variable !== undefined && edge.variable.length > 0) {
        variables.push(edge.variable);
        const producers =
          producersByVariable.get(edge.variable) ?? new Set<string>();
        producers.add(edge.fromRequestId);
        producersByVariable.set(edge.variable, producers);
      }
      autoByFrom.set(edge.fromRequestId, variables);
    }
  }

  const auto: AutoDependencyView[] = [...autoByFrom.entries()]
    .map(([fromRequestId, variables]) => ({
      dependRef: dependRefFor(fromRequestId, index),
      fromRequestId,
      variables: uniqueSorted(variables),
    }))
    .sort((left, right) => left.dependRef.localeCompare(right.dependRef));

  const manualDeduped = dedupeManual(manual).sort((left, right) =>
    left.dependRef.localeCompare(right.dependRef),
  );

  const unknownVariables = uniqueSorted(
    graphResult.unresolvedConsumes
      .filter((entry) => entry.requestId === focusRequestId)
      .map((entry) => entry.variable)
      .filter(
        (name) => !staticNames.has(name) && !ignoredNames.has(name),
      ),
  );

  const ambiguousProducers: AmbiguousProducerView[] = [...producersByVariable.entries()]
    .filter(([, producers]) => producers.size > 1)
    .map(([variable, producers]) => ({
      variable,
      producers: [...producers]
        .map((requestId) => ({
          dependRef: dependRefFor(requestId, index),
          requestId,
        }))
        .sort((left, right) => left.dependRef.localeCompare(right.dependRef)),
    }))
    .sort((left, right) => left.variable.localeCompare(right.variable));

  return {
    auto,
    manual: manualDeduped,
    unknownVariables,
    ambiguousProducers,
    graphEdges: graphResult.graph.edges,
  };
}

/**
 * Analyzes every request in a collection (Q5). Reads each unique file once,
 * parses once, calls {@link analyzeProducesConsumesForDocument} per request.
 * Swallows read/parse errors to empty analysis (same as analyze-plan).
 */
export async function analyzeCollectionDependencies(
  options: AnalyzeCollectionDependenciesOptions,
): Promise<readonly RequestDependencyAnalysis[]> {
  const textByFile = new Map<string, string>();
  const analyses: RequestDependencyAnalysis[] = [];

  for (const request of options.requests) {
    let text = textByFile.get(request.filePath);
    if (text === undefined) {
      text = await readTextSafe(options.readText, request.filePath);
      textByFile.set(request.filePath, text);
    }

    const fingerprint = contentFingerprint(text);
    const cacheKey = `${request.filePath}\0${fingerprint}\0${request.offset}`;
    const cached = options.analysisCache?.get(cacheKey);
    if (cached !== undefined && cached.requestId === request.requestId) {
      analyses.push(cached);
      continue;
    }

    const analysis = analyzeOne(request, text);
    if (options.analysisCache !== undefined) {
      evictStaleAnalysisCacheEntries(
        options.analysisCache,
        request.filePath,
        request.offset,
        cacheKey,
      );
      options.analysisCache.set(cacheKey, analysis);
    }
    analyses.push(analysis);
  }

  return analyses;
}

/** True when `value` is a projection failure. */
export function isProjectionFailure(
  value: ProjectVariableDependenciesResult,
): value is { readonly ok: false; readonly code: string; readonly message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok: unknown }).ok === false
  );
}

/** FNV-1a fingerprint for analysis cache keys (RULE 9). */
export function contentFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${hash >>> 0}`;
}

async function readTextSafe(
  readText: (filePath: string) => Promise<string>,
  filePath: string,
): Promise<string> {
  try {
    return await readText(filePath);
  } catch {
    return '';
  }
}

function analyzeOne(
  request: CollectionDependencyRequestRef,
  text: string,
): RequestDependencyAnalysis {
  if (text.length === 0) {
    return emptyAnalysis(request.requestId);
  }
  try {
    const document = parseApiDocument(text, { sourceId: request.filePath }).ast;
    return analyzeProducesConsumesForDocument(
      document,
      text,
      request.offset,
      request.requestId,
    );
  } catch {
    return emptyAnalysis(request.requestId);
  }
}

function emptyAnalysis(requestId: string): RequestDependencyAnalysis {
  return { requestId, produces: [], consumes: [], dependsOnNames: [] };
}

function buildIndex(
  labelByRequestId: ReadonlyMap<string, string>,
  folderPathByRequestId: ReadonlyMap<string, string>,
): readonly DependRefIndexEntry[] {
  const index: DependRefIndexEntry[] = [];
  for (const [requestId, name] of labelByRequestId) {
    index.push({
      requestId,
      name,
      folderPath: folderPathByRequestId.get(requestId) ?? '',
    });
  }
  return index;
}

function dependRefFor(
  requestId: string,
  index: readonly DependRefIndexEntry[],
): string {
  const entry = index.find((candidate) => candidate.requestId === requestId);
  if (entry === undefined) {
    return requestId;
  }
  return formatDependRef(minimalDependRefFor(entry, index));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dedupeManual(
  entries: readonly ManualDependencyView[],
): ManualDependencyView[] {
  const seen = new Set<string>();
  const result: ManualDependencyView[] = [];
  for (const entry of entries) {
    if (seen.has(entry.fromRequestId)) {
      continue;
    }
    seen.add(entry.fromRequestId);
    result.push(entry);
  }
  return result;
}

/**
 * Drops cache entries for the same file+offset under a different fingerprint
 * so long edit sessions do not retain unbounded stale keys (RULE 9).
 */
function evictStaleAnalysisCacheEntries(
  cache: Map<string, RequestDependencyAnalysis>,
  filePath: string,
  offset: number,
  keepKey: string,
): void {
  const prefix = `${filePath}\0`;
  const offsetSuffix = `\0${offset}`;
  for (const key of [...cache.keys()]) {
    if (key === keepKey) {
      continue;
    }
    if (key.startsWith(prefix) && key.endsWith(offsetSuffix)) {
      cache.delete(key);
    }
  }
}
