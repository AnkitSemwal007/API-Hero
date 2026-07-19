import { STORAGE_KEYS } from '../constants';
import {
  HISTORY_SCHEMA_VERSION,
  type HistoryEntry,
  type HistoryIdentifier,
} from './models';
import {
  emptyHistoryDocument,
  migrateHistoryDocument,
  normalizeRetention,
  type HistoryDocument,
  type HistoryListOptions,
  type HistoryRepository,
} from './repository';

/**
 * Filesystem port for history persistence.
 * Framework-free so Node tests can inject temp-dir backends without VS Code.
 */
export interface HistoryStorageFs {
  readFile(uri: string): Promise<Uint8Array>;
  writeFile(uri: string, data: Uint8Array): Promise<void>;
  createDirectory(uri: string): Promise<void>;
  joinPath(root: string, ...segments: string[]): string;
  /**
   * True when a read failed because the file does not exist.
   * Other I/O failures (permission, disk, etc.) must return false so callers can rethrow.
   */
  isMissingFileError(error: unknown): boolean;
}

/**
 * File-backed history repository using an injected storage backend.
 * Stores a versioned JSON document of metadata-only entries (no bodies).
 */
export class FileHistoryStore implements HistoryRepository {
  private readonly storageRoot: string;
  private readonly fileUri: string;
  private readonly fs: HistoryStorageFs;
  private maxEntries: number;
  private cache: HistoryEntry[] | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    storageRoot: string,
    fs: HistoryStorageFs,
    maxEntries = 1_000,
  ) {
    this.storageRoot = storageRoot;
    this.fs = fs;
    this.fileUri = fs.joinPath(storageRoot, STORAGE_KEYS.requestHistoryFile);
    this.maxEntries = normalizeRetention(maxEntries);
  }

  public async append(entry: HistoryEntry): Promise<void> {
    await this.enqueue(async () => {
      const entries = await this.loadEntries();
      const next = trimEntries(
        [entry, ...entries.filter((item) => item.id !== entry.id)],
        this.maxEntries,
      );
      await this.persist(next);
      this.cache = next;
    });
  }

  public async list(
    options: HistoryListOptions = {},
  ): Promise<readonly HistoryEntry[]> {
    const entries = await this.loadEntries();
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit;
    const slice =
      limit === undefined
        ? entries.slice(offset)
        : entries.slice(offset, offset + Math.max(0, limit));
    return Object.freeze([...slice]);
  }

  public async get(id: HistoryIdentifier): Promise<HistoryEntry | undefined> {
    const entries = await this.loadEntries();
    return entries.find((entry) => entry.id === id);
  }

  public async delete(id: HistoryIdentifier): Promise<boolean> {
    return this.enqueue(async () => {
      const entries = await this.loadEntries();
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length === entries.length) {
        return false;
      }
      await this.persist(next);
      this.cache = next;
      return true;
    });
  }

  public async clear(): Promise<void> {
    await this.enqueue(async () => {
      await this.persist([]);
      this.cache = [];
    });
  }

  public getMaxEntries(): number {
    return this.maxEntries;
  }

  public async setMaxEntries(maxEntries: number): Promise<void> {
    await this.enqueue(async () => {
      this.maxEntries = normalizeRetention(maxEntries);
      const entries = await this.loadEntries();
      const trimmed = trimEntries(entries, this.maxEntries);
      if (trimmed.length !== entries.length) {
        await this.persist(trimmed);
        this.cache = trimmed;
      }
    });
  }

  /** Absolute storage URI/path for diagnostics / docs. */
  public get storageUri(): string {
    return this.fileUri;
  }

  private async loadEntries(): Promise<HistoryEntry[]> {
    if (this.cache !== undefined) {
      return this.cache;
    }
    const document = await this.readDocument();
    this.cache = [...document.entries];
    return this.cache;
  }

  private async readDocument(): Promise<HistoryDocument> {
    let bytes: Uint8Array;
    try {
      bytes = await this.fs.readFile(this.fileUri);
    } catch (error) {
      if (this.fs.isMissingFileError(error)) {
        return emptyHistoryDocument();
      }
      throw error;
    }
    try {
      const text = Buffer.from(bytes).toString('utf8');
      return migrateHistoryDocument(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return emptyHistoryDocument();
      }
      throw error;
    }
  }

  private async persist(entries: readonly HistoryEntry[]): Promise<void> {
    const document: HistoryDocument = {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      entries,
    };
    const payload = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await this.fs.createDirectory(this.storageRoot);
    await this.fs.writeFile(this.fileUri, payload);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Creates a file-backed history store with the given filesystem backend. */
export function createFileHistoryStore(options: {
  readonly storageRoot: string;
  readonly fs: HistoryStorageFs;
  readonly maxEntries?: number;
}): FileHistoryStore {
  return new FileHistoryStore(
    options.storageRoot,
    options.fs,
    options.maxEntries,
  );
}

function trimEntries(
  entries: readonly HistoryEntry[],
  maxEntries: number,
): HistoryEntry[] {
  return entries.length <= maxEntries
    ? [...entries]
    : entries.slice(0, maxEntries);
}
