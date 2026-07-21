/**
 * Filesystem port for collection mutations. Implementations use VS Code
 * `workspace.fs` or an in-memory fake — domain code never imports `vscode`.
 */

export interface CollectionDirectoryEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}

export interface CollectionFilesystem {
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(oldPath: string, newPath: string): Promise<void>;
  readDirectory(path: string): Promise<readonly CollectionDirectoryEntry[]>;
}
