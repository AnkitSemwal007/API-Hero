/**
 * Collection-scoped `@depends-on` rename cascade for the Request Editor.
 * Uses discovery snapshot + WorkspaceEdit; domain rewrite stays vscode-free.
 */

import {
  Range,
  Uri,
  workspace,
  WorkspaceEdit,
  type TextDocument,
} from 'vscode';

import {
  normalizePathKey,
  type Collection,
  type WorkspaceCollections,
} from '../../collections';
import {
  planDependRefRewrites,
  type DependRefIndexEntry,
} from '../../dependencies';
import {
  parseSourceToRequestDocument,
  serializeRequestDocument,
  type RequestSourceDocument,
} from '../../request-source';

export interface CascadeDependRefRenameOptions {
  readonly aggregate: WorkspaceCollections | undefined;
  readonly documentPath: string;
  readonly oldName: string;
  readonly newName: string;
}

export interface CascadeDependRefRenameResult {
  /** Absolute paths that could not be opened for cascade rewrite. */
  readonly skippedOpenPaths: readonly string[];
}

/**
 * When `@name` changes in the Request Editor, rewrite dependents' `@depends-on`
 * tokens across the same collection (bare + qualified).
 */
export async function cascadeDependRefRenameOnNameChange(
  options: CascadeDependRefRenameOptions,
): Promise<CascadeDependRefRenameResult> {
  const { aggregate, documentPath, oldName, newName } = options;
  if (aggregate === undefined) {
    return { skippedOpenPaths: [] };
  }
  if (oldName === newName || oldName.length === 0 || newName.length === 0) {
    return { skippedOpenPaths: [] };
  }

  const collection = findCollectionForDocumentPath(aggregate, documentPath);
  if (collection === undefined) {
    return { skippedOpenPaths: [] };
  }

  const renamed = findRequestInCollection(collection, documentPath);
  if (renamed === undefined) {
    return { skippedOpenPaths: [] };
  }

  const folderPath =
    renamed.folderId === undefined
      ? ''
      : (collection.folders[renamed.folderId]?.relativePath ?? '');

  const catalogBefore: DependRefIndexEntry[] = Object.values(
    collection.requests,
  ).map((request) => ({
    requestId: request.id,
    name:
      request.id === renamed.id ? oldName : request.display.label,
    folderPath:
      request.folderId === undefined
        ? ''
        : (collection.folders[request.folderId]?.relativePath ?? ''),
  }));

  const catalogAfter: DependRefIndexEntry[] = Object.values(
    collection.requests,
  ).map((request) => ({
    requestId: request.id,
    name:
      request.id === renamed.id ? newName : request.display.label,
    folderPath:
      request.folderId === undefined
        ? ''
        : (collection.folders[request.folderId]?.relativePath ?? ''),
  }));

  const { documents, skippedOpenPaths } = await loadDependOnDocuments(
    collection,
    renamed.id,
  );
  const rewrites = planDependRefRewrites({
    identity: {
      requestId: renamed.id,
      oldName,
      oldFolderPath: folderPath,
      newName,
    },
    catalogBefore,
    catalogAfter,
    documents,
  });

  if (rewrites.length === 0) {
    return { skippedOpenPaths };
  }

  const edit = new WorkspaceEdit();
  for (const rewrite of rewrites) {
    const snapshot = documents.find(
      (document) => document.filePath === rewrite.filePath,
    );
    if (snapshot === undefined || snapshot.model === undefined) {
      continue;
    }
    const nextModel: RequestSourceDocument = {
      ...snapshot.model,
      dependsOn: rewrite.dependsOn,
    };
    const nextText = serializeRequestDocument(nextModel);
    if (nextText === snapshot.sourceText) {
      continue;
    }
    const uri = Uri.file(rewrite.filePath);
    const doc = snapshot.textDocument;
    const fullRange = new Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length),
    );
    edit.replace(uri, fullRange, nextText);
  }

  if (edit.size > 0) {
    await workspace.applyEdit(edit);
  }
  return { skippedOpenPaths };
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

function findRequestInCollection(
  collection: Collection,
  documentPath: string,
): Collection['requests'][string] | undefined {
  const key = normalizePathKey(documentPath);
  for (const request of Object.values(collection.requests)) {
    if (normalizePathKey(request.filePath) === key) {
      return request;
    }
  }
  return undefined;
}

interface LoadedDependOnDocument {
  readonly filePath: string;
  readonly requestId: string;
  readonly dependsOn: readonly string[];
  readonly model?: RequestSourceDocument;
  readonly sourceText: string;
  readonly textDocument: TextDocument;
}

async function loadDependOnDocuments(
  collection: Collection,
  renamedRequestId: string,
): Promise<{
  readonly documents: readonly LoadedDependOnDocument[];
  readonly skippedOpenPaths: readonly string[];
}> {
  const out: LoadedDependOnDocument[] = [];
  const skippedOpenPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const request of Object.values(collection.requests)) {
    if (request.id === renamedRequestId) {
      continue;
    }
    const key = normalizePathKey(request.filePath);
    if (seenPaths.has(key)) {
      continue;
    }
    seenPaths.add(key);

    const uri = Uri.file(request.filePath);
    let textDocument: TextDocument;
    try {
      textDocument = await workspace.openTextDocument(uri);
    } catch {
      skippedOpenPaths.push(request.filePath);
      continue;
    }
    const sourceText = textDocument.getText();
    const parsed = parseSourceToRequestDocument(sourceText, uri.toString());
    if (parsed.kind !== 'single') {
      continue;
    }
    out.push({
      filePath: request.filePath,
      requestId: request.id,
      dependsOn: parsed.document.dependsOn ?? [],
      model: parsed.document,
      sourceText,
      textDocument,
    });
  }

  return { documents: out, skippedOpenPaths };
}

