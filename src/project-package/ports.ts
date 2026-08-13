/**
 * Filesystem port for project packaging. Domain code never imports `vscode`.
 */

export interface PackageDirectoryEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}

export interface PackageFilesystem {
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readDirectory(path: string): Promise<readonly PackageDirectoryEntry[]>;
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
}
