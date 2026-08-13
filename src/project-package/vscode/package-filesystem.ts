/**
 * VS Code `workspace.fs` adapter for project packaging.
 */

import { FileType, Uri, workspace } from 'vscode';

import type {
  PackageDirectoryEntry,
  PackageFilesystem,
} from '../ports';

export class VsCodePackageFilesystem implements PackageFilesystem {
  public async exists(path: string): Promise<boolean> {
    try {
      await workspace.fs.stat(toUri(path));
      return true;
    } catch {
      return false;
    }
  }

  public async createDirectory(path: string): Promise<void> {
    await workspace.fs.createDirectory(toUri(path));
  }

  public async readBytes(path: string): Promise<Uint8Array> {
    const bytes = await workspace.fs.readFile(toUri(path));
    return Uint8Array.from(bytes);
  }

  public async writeBytes(path: string, content: Uint8Array): Promise<void> {
    await workspace.fs.writeFile(toUri(path), Buffer.from(content));
  }

  public async readText(path: string): Promise<string> {
    const bytes = await this.readBytes(path);
    return Buffer.from(bytes).toString('utf8');
  }

  public async writeText(path: string, content: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(content, 'utf8'));
  }

  public async readDirectory(
    path: string,
  ): Promise<readonly PackageDirectoryEntry[]> {
    const entries = await workspace.fs.readDirectory(toUri(path));
    return entries.map(([name, type]) => ({
      name,
      type: (type & FileType.Directory) !== 0 ? 'directory' : 'file',
    }));
  }

  public async delete(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await workspace.fs.delete(toUri(path), {
      recursive: options?.recursive === true,
      useTrash: false,
    });
  }
}

function toUri(path: string): Uri {
  if (path.includes('://')) {
    return Uri.parse(path);
  }
  return Uri.file(path);
}
