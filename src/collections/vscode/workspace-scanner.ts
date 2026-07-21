import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  FileType,
  RelativePattern,
  Uri,
  workspace,
} from 'vscode';

import {
  COLLECTIONS_DIRECTORY_NAME,
  COLLECTION_MARKER_FILENAME,
} from '../constants';
import type {
  ApiFileReader,
  DiscoveredApiFile,
  DiscoveredCollectionRoot,
  WorkspaceFolderDescriptor,
  WorkspaceScanResult,
  WorkspaceScanner,
} from '../scanner';

/**
 * Scans VS Code workspace folders for collection roots and `.api` files
 * (recursive glob) using the workspace file-search API. Falls back gracefully
 * when no folder is open.
 */
export class VsCodeWorkspaceScanner implements WorkspaceScanner {
  public async scan(): Promise<WorkspaceScanResult> {
    const folders = workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      return { folders: [], apiFiles: [], collectionRoots: [], issues: [] };
    }

    const descriptors: WorkspaceFolderDescriptor[] = folders.map((folder) => ({
      path: folder.uri.toString(),
      name: folder.name,
    }));

    const apiFiles: DiscoveredApiFile[] = [];
    const collectionRoots: DiscoveredCollectionRoot[] = [];
    const issues: Array<WorkspaceScanResult['issues'][number]> = [];

    for (const folder of folders) {
      try {
        collectionRoots.push(
          ...(await discoverCollectionRoots(folder.uri, folder.uri.toString())),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Collection root scan failed.';
        issues.push({
          code: 'UNREADABLE',
          message,
          path: folder.uri.toString(),
        });
      }

      try {
        const found = await workspace.findFiles(
          new RelativePattern(folder, '**/*.api'),
        );
        for (const uri of found) {
          const relativePath = path.posix.normalize(
            path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/'),
          );
          if (relativePath.startsWith('..')) {
            continue;
          }
          let mtimeMs: number | undefined;
          try {
            const stat = await workspace.fs.stat(uri);
            mtimeMs = stat.mtime;
          } catch {
            issues.push({
              code: 'UNREADABLE',
              message: `Unable to stat API file "${uri.fsPath}".`,
              path: uri.toString(),
            });
          }
          apiFiles.push({
            path: uri.toString(),
            relativePath,
            workspaceRootPath: folder.uri.toString(),
            mtimeMs,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Workspace scan failed.';
        issues.push({
          code: 'UNREADABLE',
          message,
          path: folder.uri.toString(),
        });
      }
    }

    return { folders: descriptors, apiFiles, collectionRoots, issues };
  }
}

async function discoverCollectionRoots(
  workspaceUri: Uri,
  workspaceRootPath: string,
): Promise<DiscoveredCollectionRoot[]> {
  const collectionsUri = Uri.joinPath(workspaceUri, COLLECTIONS_DIRECTORY_NAME);
  let entries: [string, FileType][];
  try {
    entries = await workspace.fs.readDirectory(collectionsUri);
  } catch {
    return [];
  }

  const roots: DiscoveredCollectionRoot[] = [];
  for (const [name, type] of entries) {
    if (type !== FileType.Directory || name.startsWith('.')) {
      continue;
    }
    const rootUri = Uri.joinPath(collectionsUri, name);
    const markerUri = Uri.joinPath(rootUri, COLLECTION_MARKER_FILENAME);
    let markerPath: string | undefined;
    let markerMtimeMs: number | undefined;
    try {
      const stat = await workspace.fs.stat(markerUri);
      markerPath = markerUri.toString();
      markerMtimeMs = stat.mtime;
    } catch {
      // Marker is optional — directory alone defines a native collection.
    }
    roots.push({
      path: rootUri.toString(),
      name,
      workspaceRootPath,
      relativePath: `${COLLECTIONS_DIRECTORY_NAME}/${name}`,
      ...(markerPath !== undefined ? { markerPath, markerMtimeMs } : {}),
    });
  }
  return roots;
}

/** Reads `.api` text through VS Code's filesystem provider. */
export class VsCodeApiFileReader implements ApiFileReader {
  public async readText(filePath: string): Promise<string> {
    const uri = Uri.parse(filePath);
    const bytes = await workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }
}

/**
 * Optional Node-fs reader for absolute filesystem paths (tests / non-URI keys).
 * Production discovery uses {@link VsCodeApiFileReader}.
 */
export class NodeApiFileReader implements ApiFileReader {
  public async readText(filePath: string): Promise<string> {
    return fs.readFile(toFsPath(filePath), 'utf8');
  }
}

function toFsPath(filePath: string): string {
  if (filePath.includes('://')) {
    return Uri.parse(filePath).fsPath;
  }
  return filePath;
}
