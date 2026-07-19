import { cloneDetached, deepFreeze } from '../shared';

/** Opaque stable identity for one history entry. */
export type HistoryIdentifier = string;

/** Schema version written with every persisted history document. */
export const HISTORY_SCHEMA_VERSION = 1 as const;

/**
 * Outcome of a finished execution that was recorded in history.
 * Distinct from orchestration UI `ExecutionStatus`.
 */
export const HistoryExecutionStatus = {
  Success: 'success',
  Failure: 'failure',
  Cancelled: 'cancelled',
} as const;

export type HistoryExecutionStatus =
  (typeof HistoryExecutionStatus)[keyof typeof HistoryExecutionStatus];

/**
 * Lightweight, secret-free summary of one finished run.
 * `url` is always a sanitized presentation URL (never credentials or tokens).
 */
export interface ExecutionSummary {
  readonly method: string;
  readonly url: string;
  readonly statusCode?: number;
  readonly statusText?: string;
  readonly durationMs: number;
  /** ISO-8601 completion timestamp. */
  readonly timestamp: string;
  readonly status: HistoryExecutionStatus;
}

/**
 * Best-effort source location for reveal / re-run.
 * Stored only when known at capture time; never includes file contents.
 */
export interface HistorySourceLocation {
  readonly uri: string;
  readonly offset?: number;
  readonly line?: number;
  readonly character?: number;
  readonly requestId?: string;
}

/**
 * Optional contextual metadata. Response bodies and sensitive headers are
 * intentionally absent; only size and content-type are kept by default.
 */
export interface HistoryMetadata {
  readonly requestName?: string;
  readonly environmentName?: string;
  readonly collectionName?: string;
  readonly contentType?: string;
  readonly responseSizeBytes?: number;
  /** Safe execution error code when status is failure or cancelled. */
  readonly errorCode?: string;
  /** Safe, redacted error message — never secrets. */
  readonly errorMessage?: string;
  readonly source?: HistorySourceLocation;
}

/**
 * Reserved bags for deferred body persistence, sync, analytics, and assertion
 * summary counts. Values stay opaque except `assertions`, which may hold
 * secret-free pass/fail counts from the Assertion Engine.
 */
export interface HistoryExtensionBag {
  readonly bodyPersistence?: Readonly<Record<string, unknown>>;
  readonly sync?: Readonly<Record<string, unknown>>;
  readonly analytics?: Readonly<Record<string, unknown>>;
  readonly assertions?: Readonly<Record<string, unknown>>;
  readonly [key: string]: Readonly<Record<string, unknown>> | undefined;
}

/** Immutable recorded history entry. */
export interface HistoryEntry {
  readonly id: HistoryIdentifier;
  readonly schemaVersion: typeof HISTORY_SCHEMA_VERSION | number;
  readonly summary: ExecutionSummary;
  readonly metadata: HistoryMetadata;
  readonly extensions?: HistoryExtensionBag;
}

/** Aggregate counts over a history collection. */
export interface HistoryStatistics {
  readonly total: number;
  readonly success: number;
  readonly failure: number;
  readonly cancelled: number;
}

/** Creates a new opaque history identifier. */
export function createHistoryIdentifier(
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): HistoryIdentifier {
  const suffix = Math.floor(random() * 1_000_000_000)
    .toString(36)
    .padStart(6, '0');
  return `hist_${nowMs.toString(36)}_${suffix}`;
}

/** Deeply freezes a detached history entry. */
export function freezeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return deepFreeze(cloneDetached(entry));
}
