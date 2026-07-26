/**
 * Builds the Request Editor Depends-on catalog from a collections snapshot.
 * Same-collection only. Framework-free.
 */

import type {
  Collection,
  Folder,
  RequestReference,
  WorkspaceCollections,
} from '../../collections';
import { normalizePathKey } from '../../collections';
import {
  formatDependRef,
  minimalDependRefFor,
  type DependRefIndexEntry,
} from '../../dependencies/depend-ref';
import type { RequestEditorDependencyCatalogEntry } from './request-editor-messages';

export interface BuildDependencyCatalogOptions {
  readonly aggregate: WorkspaceCollections | undefined;
  /** Absolute URI/path of the document being edited. */
  readonly documentPath: string;
  /** Discovery request id of the current request (excluded from the picker). */
  readonly currentRequestId?: string;
}

/**
 * Returns same-collection requests for the Depends-on picker as human refs.
 */
export function buildRequestEditorDependencyCatalog(
  options: BuildDependencyCatalogOptions,
): readonly RequestEditorDependencyCatalogEntry[] {
  const aggregate = options.aggregate;
  if (aggregate === undefined) {
    return [];
  }

  const collection = findCollectionForDocumentPath(
    aggregate,
    options.documentPath,
  );
  if (collection === undefined) {
    return [];
  }

  const currentId = options.currentRequestId?.trim();
  const indexEntries: DependRefIndexEntry[] = [];
  for (const request of Object.values(collection.requests)) {
    indexEntries.push({
      requestId: request.id,
      name: request.display.label,
      folderPath: folderPathFor(collection, request),
    });
  }

  const entries: RequestEditorDependencyCatalogEntry[] = [];

  const sameFolderNameCounts = new Map<string, number>();
  for (const entry of indexEntries) {
    const key = `${entry.folderPath}\0${entry.name}`;
    sameFolderNameCounts.set(key, (sameFolderNameCounts.get(key) ?? 0) + 1);
  }

  for (const request of Object.values(collection.requests)) {
    if (currentId !== undefined && request.id === currentId) {
      continue;
    }
    const folderPath = folderPathFor(collection, request);
    // Same-folder duplicate @name cannot be disambiguated — omit from picker.
    if ((sameFolderNameCounts.get(`${folderPath}\0${request.display.label}`) ?? 0) > 1) {
      continue;
    }
    const indexEntry: DependRefIndexEntry = {
      requestId: request.id,
      name: request.display.label,
      folderPath,
    };
    const dependRef = formatDependRef(
      minimalDependRefFor(indexEntry, indexEntries),
    );
    const folderLabel = folderLabelFor(collection, request);
    entries.push({
      name: request.display.label,
      folderPath,
      dependRef,
      requestId: request.id,
      ...(folderLabel !== undefined ? { folderLabel } : {}),
      ...(request.legacyAuthoredId !== undefined
        ? { legacyAuthoredId: request.legacyAuthoredId }
        : {}),
    });
  }

  entries.sort((left, right) => {
    const folderCompare = (left.folderLabel ?? left.folderPath).localeCompare(
      right.folderLabel ?? right.folderPath,
    );
    if (folderCompare !== 0) {
      return folderCompare;
    }
    return left.name.localeCompare(right.name);
  });

  return entries;
}

/**
 * Catalog projection for the webview: human fields only (no discovery ids).
 * Host serialize/migrate keeps the full catalog with `requestId` / legacy ids.
 */
export function toWebviewDependencyCatalog(
  catalog: readonly RequestEditorDependencyCatalogEntry[],
): readonly RequestEditorDependencyCatalogEntry[] {
  return catalog.map((entry) => ({
    name: entry.name,
    folderPath: entry.folderPath,
    dependRef: entry.dependRef,
    ...(entry.folderLabel !== undefined
      ? { folderLabel: entry.folderLabel }
      : {}),
    ...(entry.legacyAuthoredId !== undefined
      ? { legacyAuthoredId: entry.legacyAuthoredId }
      : {}),
  }));
}

function findCollectionForDocumentPath(
  aggregate: WorkspaceCollections,
  documentPath: string,
): Collection | undefined {
  const key = normalizePathKey(documentPath);
  for (const collection of Object.values(aggregate.collections)) {
    for (const request of Object.values(collection.requests)) {
      if (normalizePathKey(request.filePath) === key) {
        return collection;
      }
    }
  }
  return undefined;
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

function folderLabelFor(
  collection: Collection,
  request: RequestReference,
): string | undefined {
  if (request.folderId === undefined) {
    return undefined;
  }
  const folder: Folder | undefined = collection.folders[request.folderId];
  return folder?.display.label;
}

