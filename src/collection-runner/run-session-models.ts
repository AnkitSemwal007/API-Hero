/**
 * Session snapshots for {@link CollectionRunManager}.
 * Framework-free - no vscode imports.
 */

import type {
  CollectionRunMode,
  CollectionRunStatus,
  FailurePolicyKind,
  PlannedRequest,
  RequestRunResult,
  RunIdentifier,
  RunPlan,
  RunProgressEvent,
  RunSummary,
} from './models';

/** Lifecycle status of a tracked collection-run session. */
export const RunSessionStatus = {
  Running: 'running',
  Completed: 'completed',
  Cancelled: 'cancelled',
  Stopped: 'stopped',
  Failed: 'failed',
} as const;

export type RunSessionStatus =
  (typeof RunSessionStatus)[keyof typeof RunSessionStatus];

export interface CollectionRunSessionSnapshot {
  readonly runId: RunIdentifier;
  readonly status: RunSessionStatus;
  readonly plan: RunPlan;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly mode: CollectionRunMode;
  readonly failurePolicy: FailurePolicyKind;
  readonly total: number;
  readonly completed: number;
  readonly remaining: number;
  readonly elapsedMs: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly current?: PlannedRequest;
  readonly lastProgress?: RunProgressEvent;
  readonly results: readonly RequestRunResult[];
  readonly summary?: RunSummary;
  readonly errorMessage?: string;
}

/** Options for {@link CollectionRunManager.begin}. */
export interface BeginCollectionRunSessionOptions {
  readonly plan: RunPlan;
  readonly abortController?: AbortController;
  readonly nowMs?: number;
}

export interface BeginCollectionRunSessionResult {
  readonly runId: RunIdentifier;
  readonly signal: AbortSignal;
  readonly abortController: AbortController;
  readonly snapshot: CollectionRunSessionSnapshot;
}

export function sessionStatusFromRunStatus(
  status: CollectionRunStatus,
): Exclude<RunSessionStatus, 'running' | 'failed'> {
  switch (status) {
    case 'cancelled':
      return RunSessionStatus.Cancelled;
    case 'stopped':
      return RunSessionStatus.Stopped;
    case 'completed':
    default:
      return RunSessionStatus.Completed;
  }
}
