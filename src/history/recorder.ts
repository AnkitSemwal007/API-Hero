import type { AuthenticatedRequest } from '../models';
import type { ExecutionResult } from '../execution';
import type { AssertionHistoryCounts } from '../assertions';
import { deepFreeze } from '../shared';
import {
  createHistoryIdentifier,
  freezeHistoryEntry,
  HistoryExecutionStatus,
  type HistoryEntry,
  type HistoryMetadata,
  type HistorySourceLocation,
  HISTORY_SCHEMA_VERSION,
} from './models';
import type { HistoryRepository } from './repository';
import {
  sanitizeHistoryErrorMessage,
  sanitizeHistoryUrl,
} from './sanitize';

/**
 * Capture context supplied by orchestration after a finished network attempt.
 * Collection / environment names are best-effort and secret-free.
 */
export interface HistoryCaptureInput {
  readonly runId: number;
  readonly result: ExecutionResult;
  readonly request: AuthenticatedRequest;
  readonly environmentName?: string;
  readonly collectionName?: string;
  readonly source?: HistorySourceLocation;
  /**
   * Optional secret-free assertion summary counts. Full assertion dumps are
   * intentionally omitted from history.
   */
  readonly assertionCounts?: AssertionHistoryCounts;
}

/**
 * Port invoked by {@link ExecutionOrchestrator} after a finished execution.
 * Implementations must ignore stale (replaced) runs.
 */
export interface HistoryRecorder {
  /** Marks the active run so stale appends are dropped. */
  beginRun(runId: number): void;
  /**
   * Appends one immutable entry for the current run only.
   * @returns `true` when an entry was appended; `false` for a stale no-op.
   */
  record(input: HistoryCaptureInput): Promise<boolean>;
}

/**
 * Framework-free history recorder.
 * Builds sanitized metadata-only entries and delegates persistence.
 */
export class DefaultHistoryRecorder implements HistoryRecorder {
  private activeRunId: number | undefined;

  public constructor(
    private readonly repository: HistoryRepository,
    private readonly createId: () => string = () => createHistoryIdentifier(),
  ) {}

  public beginRun(runId: number): void {
    this.activeRunId = runId;
  }

  public async record(input: HistoryCaptureInput): Promise<boolean> {
    if (this.activeRunId !== input.runId) {
      return false;
    }
    const entry = buildHistoryEntry(input, this.createId);
    if (this.activeRunId !== input.runId) {
      return false;
    }
    await this.repository.append(entry);
    return true;
  }
}

/** Pure builder used by the recorder and unit tests. */
export function buildHistoryEntry(
  input: HistoryCaptureInput,
  createId: () => string = () => createHistoryIdentifier(),
): HistoryEntry {
  const { result, request } = input;
  const url = sanitizeHistoryUrl(request.resolution.presentationUrl);
  const status = resolveStatus(result);
  const metadata = buildMetadata(input, result);

  return freezeHistoryEntry({
    id: createId(),
    schemaVersion: HISTORY_SCHEMA_VERSION,
    summary: deepFreeze({
      method: request.method,
      url,
      ...(result.success
        ? {
            statusCode: result.response.statusCode,
            statusText: result.response.statusText,
          }
        : {}),
      durationMs: result.timing.durationMs,
      timestamp: result.timing.completedAt,
      status,
    }),
    metadata,
    ...(input.assertionCounts === undefined
      ? {}
      : {
          extensions: deepFreeze({
            assertions: { ...input.assertionCounts },
          }),
        }),
  });
}

function resolveStatus(
  result: ExecutionResult,
): (typeof HistoryExecutionStatus)[keyof typeof HistoryExecutionStatus] {
  if (result.success) {
    return HistoryExecutionStatus.Success;
  }
  if (result.error.code === 'CANCELLED') {
    return HistoryExecutionStatus.Cancelled;
  }
  return HistoryExecutionStatus.Failure;
}

function buildMetadata(
  input: HistoryCaptureInput,
  result: ExecutionResult,
): HistoryMetadata {
  const metadata: {
    -readonly [K in keyof HistoryMetadata]?: HistoryMetadata[K];
  } = {};

  if (input.request.name !== undefined && input.request.name.length > 0) {
    metadata.requestName = input.request.name;
  }
  if (
    input.environmentName !== undefined &&
    input.environmentName.length > 0
  ) {
    metadata.environmentName = input.environmentName;
  }
  if (
    input.collectionName !== undefined &&
    input.collectionName.length > 0
  ) {
    metadata.collectionName = input.collectionName;
  }
  if (input.source !== undefined) {
    metadata.source = deepFreeze({ ...input.source });
  }

  if (result.success) {
    if (result.response.contentType !== undefined) {
      metadata.contentType = result.response.contentType;
    }
    metadata.responseSizeBytes = result.response.bodySizeBytes;
  } else {
    metadata.errorCode = result.error.code;
    metadata.errorMessage = sanitizeHistoryErrorMessage(result.error.message);
  }

  return deepFreeze(metadata);
}
