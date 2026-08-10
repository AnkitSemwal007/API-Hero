/**
 * Node `fs`/`path` workspace scanner for headless hosts (MCP, CLI, tests).
 * Mirrors {@link VsCodeWorkspaceScanner} semantics without importing `vscode`.
 * Paths are absolute filesystem paths (consistent with discovery / runner).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COLLECTIONS_DIRECTORY_NAME,
  COLLECTION_MARKER_FILENAME,
} from './constants';
import type {
  ApiFileReader,
  DiscoveredApiFile,
  DiscoveredCollectionRoot,
  WorkspaceFolderDescriptor,
  WorkspaceScanResult,
  WorkspaceScanner,
} from './scanner';

export interface NodeWorkspaceScannerOptions {
  /** Absolute workspace folder path. Defaults to `process.cwd()`. */
  readonly workspaceRoot: string;
  /** Display name for the workspace folder. Defaults to the directory basename. */
  readonly workspaceName?: string;
}

/**
 * Scans a single workspace root for `Collections/<Name>/` roots and recursive
 * `.api` files using Node filesystem APIs only.
 */
export class NodeWorkspaceScanner implements WorkspaceScanner {
  private readonly workspaceRoot: string;
  private readonly workspaceName: string;

  public constructor(options: NodeWorkspaceScannerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.workspaceName =
      options.workspaceName ?? path.basename(this.workspaceRoot);
  }

  public async scan(): Promise<WorkspaceScanResult> {
    const descriptors: WorkspaceFolderDescriptor[] = [
      { path: this.workspaceRoot, name: this.workspaceName },
    ];

    const apiFiles: DiscoveredApiFile[] = [];
    const collectionRoots: DiscoveredCollectionRoot[] = [];
    const issues: Array<WorkspaceScanResult['issues'][number]> = [];

    try {
      collectionRoots.push(
        ...(await discoverCollectionRoots(this.workspaceRoot)),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Collection root scan failed.';
      issues.push({
        code: 'UNREADABLE',
        message,
        path: this.workspaceRoot,
      });
    }

    try {
      const found = await walkApiFiles(this.workspaceRoot);
      for (const absolutePath of found) {
        const relativePath = path.posix.normalize(
          path
            .relative(this.workspaceRoot, absolutePath)
            .split(path.sep)
            .join('/'),
        );
        if (relativePath.startsWith('..')) {
          continue;
        }
        let mtimeMs: number | undefined;
        try {
          const stat = await fs.stat(absolutePath);
          mtimeMs = stat.mtimeMs;
        } catch {
          issues.push({
            code: 'UNREADABLE',
            message: `Unable to stat API file "${absolutePath}".`,
            path: absolutePath,
          });
        }
        apiFiles.push({
          path: absolutePath,
          relativePath,
          workspaceRootPath: this.workspaceRoot,
          mtimeMs,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Workspace scan failed.';
      issues.push({
        code: 'UNREADABLE',
        message,
        path: this.workspaceRoot,
      });
    }

    return { folders: descriptors, apiFiles, collectionRoots, issues };
  }
}

async function discoverCollectionRoots(
  workspaceRoot: string,
): Promise<DiscoveredCollectionRoot[]> {
  const collectionsDir = path.join(workspaceRoot, COLLECTIONS_DIRECTORY_NAME);
  let entries;
  try {
    entries = await fs.readdir(collectionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots: DiscoveredCollectionRoot[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const rootPath = path.join(collectionsDir, entry.name);
    // Windows junctions/symlinks often report isDirectory()===false on the
    // Dirent; fs.stat follows the link and reports the real directory.
    if (!(await isDirectoryPath(rootPath, entry))) {
      continue;
    }
    const markerPath = path.join(rootPath, COLLECTION_MARKER_FILENAME);
    let resolvedMarker: string | undefined;
    let markerMtimeMs: number | undefined;
    try {
      const stat = await fs.stat(markerPath);
      resolvedMarker = markerPath;
      markerMtimeMs = stat.mtimeMs;
    } catch {
      // Marker is optional — directory alone defines a native collection.
    }
    roots.push({
      path: rootPath,
      name: entry.name,
      workspaceRootPath: workspaceRoot,
      relativePath: `${COLLECTIONS_DIRECTORY_NAME}/${entry.name}`,
      ...(resolvedMarker !== undefined
        ? { markerPath: resolvedMarker, markerMtimeMs }
        : {}),
    });
  }
  return roots;
}

async function walkApiFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  await walk(rootDir, results);
  return results;
}

async function walk(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (await isDirectoryPath(full, entry)) {
      await walk(full, results);
    } else if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      entry.name.toLowerCase().endsWith('.api')
    ) {
      // Follow symlink files when present; skip broken links via stat below.
      try {
        const st = await fs.stat(full);
        if (st.isFile()) {
          results.push(full);
        }
      } catch {
        // Broken link — ignore.
      }
    }
  }
}

/**
 * True when `fullPath` is a directory, including Windows junctions and
 * directory symlinks that `Dirent.isDirectory()` may not report.
 */
async function isDirectoryPath(
  fullPath: string,
  entry: { isDirectory(): boolean; isSymbolicLink(): boolean },
): Promise<boolean> {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    const st = await fs.stat(fullPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** Reads `.api` text from absolute filesystem paths or `file://` URIs. */
export class NodeApiFileReader implements ApiFileReader {
  public async readText(filePath: string): Promise<string> {
    return fs.readFile(toFsPath(filePath), 'utf8');
  }
}

/** Converts a discovery path key (absolute fs path or file URI) to an fs path. */
export function toFsPath(filePath: string): string {
  if (filePath.startsWith('file:')) {
    return fileURLToPath(filePath);
  }
  return filePath;
}
