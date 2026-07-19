import { Uri, workspace, type ExtensionContext } from 'vscode';

import {
  createFileHistoryStore,
  FileHistoryStore,
  type HistoryStorageFs,
} from '../file-history-store';
import type {
  HistoryEntry,
  HistoryIdentifier,
} from '../models';
import type {
  HistoryListOptions,
  HistoryRepository,
} from '../repository';

/**
 * VS Code adapter around {@link FileHistoryStore}.
 * Public API (`constructor`, `fromExtensionContext`, `storageUri`) is unchanged
 * for callers; persistence orchestration lives in the framework-free store.
 */
export class FileHistoryRepository implements HistoryRepository {
  private readonly store: FileHistoryStore;

  public constructor(
    storageRoot: Uri,
    maxEntries = 1_000,
  ) {
    this.store = createFileHistoryStore({
      storageRoot: storageRoot.toString(),
      fs: createWorkspaceHistoryFs(),
      maxEntries,
    });
  }

  public static fromExtensionContext(
    context: ExtensionContext,
    maxEntries?: number,
  ): FileHistoryRepository {
    return new FileHistoryRepository(context.globalStorageUri, maxEntries);
  }

  public append(entry: HistoryEntry): Promise<void> {
    return this.store.append(entry);
  }

  public list(
    options?: HistoryListOptions,
  ): Promise<readonly HistoryEntry[]> {
    return this.store.list(options);
  }

  public get(id: HistoryIdentifier): Promise<HistoryEntry | undefined> {
    return this.store.get(id);
  }

  public delete(id: HistoryIdentifier): Promise<boolean> {
    return this.store.delete(id);
  }

  public clear(): Promise<void> {
    return this.store.clear();
  }

  public getMaxEntries(): number {
    return this.store.getMaxEntries();
  }

  public setMaxEntries(maxEntries: number): Promise<void> {
    return this.store.setMaxEntries(maxEntries);
  }

  /** Absolute storage URI for diagnostics / docs. */
  public get storageUri(): Uri {
    return Uri.parse(this.store.storageUri);
  }
}

export { migrateHistoryDocument } from '../repository';

function createWorkspaceHistoryFs(): HistoryStorageFs {
  return {
    async readFile(uri: string): Promise<Uint8Array> {
      return workspace.fs.readFile(Uri.parse(uri));
    },
    async writeFile(uri: string, data: Uint8Array): Promise<void> {
      await workspace.fs.writeFile(Uri.parse(uri), data);
    },
    async createDirectory(uri: string): Promise<void> {
      await workspace.fs.createDirectory(Uri.parse(uri));
    },
    joinPath(root: string, ...segments: string[]): string {
      return Uri.joinPath(Uri.parse(root), ...segments).toString();
    },
    isMissingFileError(error: unknown): boolean {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'FileNotFound'
      );
    },
  };
}
