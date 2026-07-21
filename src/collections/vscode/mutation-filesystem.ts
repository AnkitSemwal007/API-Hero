/**
 * VS Code `workspace.fs` adapter for {@link CollectionFilesystem}.
 */

import { FileType, Uri, workspace } from 'vscode';

import type {
  CollectionDirectoryEntry,
  CollectionFilesystem,
} from '../mutation';

export class VsCodeCollectionFilesystem implements CollectionFilesystem {
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

  public async readText(path: string): Promise<string> {
    const bytes = await workspace.fs.readFile(toUri(path));
    return Buffer.from(bytes).toString('utf8');
  }

  public async writeText(path: string, content: string): Promise<void> {
    await workspace.fs.writeFile(toUri(path), Buffer.from(content, 'utf8'));
  }

  public async delete(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await workspace.fs.delete(toUri(path), {
      recursive: options?.recursive === true,
      useTrash: true,
    });
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    await workspace.fs.rename(toUri(oldPath), toUri(newPath), {
      overwrite: false,
    });
  }

  public async copy(oldPath: string, newPath: string): Promise<void> {
    await copyRecursive(toUri(oldPath), toUri(newPath));
  }

  public async readDirectory(
    path: string,
  ): Promise<readonly CollectionDirectoryEntry[]> {
    const entries = await workspace.fs.readDirectory(toUri(path));
    return entries.map(([name, type]) => ({
      name,
      type: (type & FileType.Directory) !== 0 ? 'directory' : 'file',
    }));
  }
}

function toUri(path: string): Uri {
  if (path.includes('://')) {
    return Uri.parse(path);
  }
  return Uri.file(path);
}

async function copyRecursive(from: Uri, to: Uri): Promise<void> {
  const stat = await workspace.fs.stat(from);
  if ((stat.type & FileType.Directory) !== 0) {
    await workspace.fs.createDirectory(to);
    const children = await workspace.fs.readDirectory(from);
    for (const [name] of children) {
      await copyRecursive(Uri.joinPath(from, name), Uri.joinPath(to, name));
    }
    return;
  }
  const bytes = await workspace.fs.readFile(from);
  await workspace.fs.writeFile(to, bytes);
}
