import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  RelativePattern,
  Uri,
  workspace,
} from 'vscode';

import type {
  ApiFileReader,
  DiscoveredApiFile,
  WorkspaceFolderDescriptor,
  WorkspaceScanResult,
  WorkspaceScanner,
} from '../scanner';

/**
 * Scans VS Code workspace folders for `.api` files (recursive glob) using the
 * workspace file-search API. Falls back gracefully when no folder is open.
 */
export class VsCodeWorkspaceScanner implements WorkspaceScanner {
  public async scan(): Promise<WorkspaceScanResult> {
    const folders = workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      return { folders: [], apiFiles: [], issues: [] };
    }

    const descriptors: WorkspaceFolderDescriptor[] = folders.map((folder) => ({
      path: folder.uri.toString(),
      name: folder.name,
    }));

    const apiFiles: DiscoveredApiFile[] = [];
    const issues: Array<WorkspaceScanResult['issues'][number]> = [];

    for (const folder of folders) {
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

    return { folders: descriptors, apiFiles, issues };
  }
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
