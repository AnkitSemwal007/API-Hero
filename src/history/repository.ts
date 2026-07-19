import type { HistoryEntry, HistoryIdentifier } from './models';
import { HISTORY_SCHEMA_VERSION } from './models';
import {
  isForbiddenHistoryFieldName,
  sanitizeHistoryErrorMessage,
  sanitizeHistoryUrl,
} from './sanitize';

/**
 * Persistence port for immutable request history.
 * Implementations must never store request/response bodies or secret headers
 * by default — only metadata entries produced by {@link HistoryRecorder}.
 */
export interface HistoryRepository {
  /** Appends one entry and enforces retention. Newest-first list order. */
  append(entry: HistoryEntry): Promise<void>;
  /** Returns lightweight entries newest-first, optionally limited. */
  list(options?: HistoryListOptions): Promise<readonly HistoryEntry[]>;
  /** Loads one entry by id. */
  get(id: HistoryIdentifier): Promise<HistoryEntry | undefined>;
  /** Deletes one entry. Returns whether it existed. */
  delete(id: HistoryIdentifier): Promise<boolean>;
  /** Removes all entries. */
  clear(): Promise<void>;
  /** Current retention cap used by the repository. */
  getMaxEntries(): number;
  /** Updates retention cap and trims if needed. */
  setMaxEntries(maxEntries: number): Promise<void>;
}

export interface HistoryListOptions {
  /** Maximum entries to return (after newest-first ordering). */
  readonly limit?: number;
  /** Skip the first N newest entries. */
  readonly offset?: number;
}

/** On-disk / serialized history document envelope. */
export interface HistoryDocument {
  readonly schemaVersion: number;
  readonly entries: readonly HistoryEntry[];
}

/** Empty v1 document. */
export function emptyHistoryDocument(): HistoryDocument {
  return Object.freeze({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    entries: Object.freeze([]),
  });
}

/**
 * Migrates or rejects unrecognized history documents.
 * Unknown schema versions reset to an empty v1 document (entries are dropped
 * rather than risking secret leakage from an unknown shape).
 * Hand-edited JSON is scrubbed: forbidden secret-named keys are dropped and
 * presentation URLs / error messages are re-sanitized.
 */
export function migrateHistoryDocument(raw: unknown): HistoryDocument {
  if (!isRecord(raw)) {
    return emptyHistoryDocument();
  }
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== HISTORY_SCHEMA_VERSION) {
    return emptyHistoryDocument();
  }
  if (!Array.isArray(raw.entries)) {
    return emptyHistoryDocument();
  }
  const entries: HistoryEntry[] = [];
  for (const item of raw.entries) {
    const entry = parseHistoryEntry(item);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return Object.freeze({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    entries: Object.freeze(entries),
  });
}

function parseHistoryEntry(value: unknown): HistoryEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const scrubbed = scrubForbiddenKeys(value);
  if (!isRecord(scrubbed)) {
    return undefined;
  }
  if (typeof scrubbed.id !== 'string' || scrubbed.id.length === 0) {
    return undefined;
  }
  if (!isRecord(scrubbed.summary) || !isRecord(scrubbed.metadata)) {
    return undefined;
  }
  const summary = scrubbed.summary;
  if (
    typeof summary.method !== 'string' ||
    typeof summary.url !== 'string' ||
    typeof summary.durationMs !== 'number' ||
    typeof summary.timestamp !== 'string' ||
    typeof summary.status !== 'string'
  ) {
    return undefined;
  }

  const sanitizedSummary = {
    ...summary,
    url: sanitizeHistoryUrl(summary.url),
  };
  const metadata = { ...scrubbed.metadata };
  if (typeof metadata.errorMessage === 'string') {
    metadata.errorMessage = sanitizeHistoryErrorMessage(metadata.errorMessage);
  }

  return {
    ...scrubbed,
    id: scrubbed.id,
    schemaVersion:
      typeof scrubbed.schemaVersion === 'number'
        ? scrubbed.schemaVersion
        : HISTORY_SCHEMA_VERSION,
    summary: sanitizedSummary,
    metadata,
  } as unknown as HistoryEntry;
}

/**
 * Recursively drops object keys whose names look secret-bearing.
 * Arrays are mapped element-wise; primitives are returned unchanged.
 */
function scrubForbiddenKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubForbiddenKeys(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenHistoryFieldName(key)) {
      continue;
    }
    result[key] = scrubForbiddenKeys(child);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Process-local fake repository for domain tests.
 * Does not touch the filesystem or VS Code APIs.
 */
export class InMemoryHistoryRepository implements HistoryRepository {
  private entries: HistoryEntry[] = [];
  private maxEntries: number;

  public constructor(maxEntries = 1_000) {
    this.maxEntries = normalizeRetention(maxEntries);
  }

  public async append(entry: HistoryEntry): Promise<void> {
    this.entries = [entry, ...this.entries.filter((item) => item.id !== entry.id)];
    this.trim();
  }

  public async list(
    options: HistoryListOptions = {},
  ): Promise<readonly HistoryEntry[]> {
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit;
    const slice =
      limit === undefined
        ? this.entries.slice(offset)
        : this.entries.slice(offset, offset + Math.max(0, limit));
    return Object.freeze([...slice]);
  }

  public async get(id: HistoryIdentifier): Promise<HistoryEntry | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  public async delete(id: HistoryIdentifier): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    return this.entries.length < before;
  }

  public async clear(): Promise<void> {
    this.entries = [];
  }

  public getMaxEntries(): number {
    return this.maxEntries;
  }

  public async setMaxEntries(maxEntries: number): Promise<void> {
    this.maxEntries = normalizeRetention(maxEntries);
    this.trim();
  }

  private trim(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }
}

export function normalizeRetention(value: unknown, fallback = 1_000): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }
  return fallback;
}
