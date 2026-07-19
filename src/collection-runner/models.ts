import { cloneDetached, deepFreeze } from '../shared';

/** Opaque stable identity for one collection run. */
export type RunIdentifier = string;

/** How a collection run selects its request set. */
export const CollectionRunMode = {
  Collection: 'collection',
  Folder: 'folder',
  SelectedRequests: 'selected-requests',
} as const;

export type CollectionRunMode =
  (typeof CollectionRunMode)[keyof typeof CollectionRunMode];

/** Built-in failure policies for sequential collection runs. */
export const FailurePolicyKind = {
  StopOnFirstError: 'stop-on-first-error',
  ContinueOnError: 'continue-on-error',
  SkipInvalidRequests: 'skip-invalid-requests',
} as const;

export type FailurePolicyKind =
  (typeof FailurePolicyKind)[keyof typeof FailurePolicyKind];

/** Per-request outcome recorded in a run summary. */
export const RequestRunOutcomeKind = {
  Passed: 'passed',
  Failed: 'failed',
  Skipped: 'skipped',
  Cancelled: 'cancelled',
} as const;

export type RequestRunOutcomeKind =
  (typeof RequestRunOutcomeKind)[keyof typeof RequestRunOutcomeKind];

/** Terminal status of an entire collection run. */
export const CollectionRunStatus = {
  Completed: 'completed',
  Cancelled: 'cancelled',
  Stopped: 'stopped',
} as const;

export type CollectionRunStatus =
  (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus];

/**
 * Reserved bags for deferred runner features. Values stay opaque; this sprint
 * never populates them. Do not scaffold competing modules for these keys.
 */
export interface CollectionRunExtensionBag {
  readonly parallel?: Readonly<Record<string, unknown>>;
  readonly conditional?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly variablesPerRun?: Readonly<Record<string, unknown>>;
  readonly ci?: Readonly<Record<string, unknown>>;
  readonly cli?: Readonly<Record<string, unknown>>;
  readonly reports?: Readonly<Record<string, unknown>>;
  readonly assertions?: Readonly<Record<string, unknown>>;
  readonly ai?: Readonly<Record<string, unknown>>;
  readonly export?: Readonly<Record<string, unknown>>;
  readonly [key: string]: Readonly<Record<string, unknown>> | undefined;
}

/** One request step inside an ordered {@link RunPlan}. */
export interface PlannedRequest {
  readonly requestId: string;
  readonly collectionId: string;
  readonly folderId?: string;
  /** Absolute URI/path of the owning `.api` file. */
  readonly filePath: string;
  /** UTF-16 offset into the file used with `runAtSourceLocation`. */
  readonly offset: number;
  readonly label: string;
  readonly method: string;
  readonly url: string;
  /** Zero-based order within the plan. */
  readonly ordinal: number;
}

/**
 * Immutable ordered plan built from a collections snapshot.
 * Plan membership is fixed at build time — mid-run discovery refreshes do not
 * mutate an in-flight plan.
 */
export interface RunPlan {
  readonly runId: RunIdentifier;
  readonly mode: CollectionRunMode;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly folderId?: string;
  readonly failurePolicy: FailurePolicyKind;
  readonly requests: readonly PlannedRequest[];
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  readonly extensions?: CollectionRunExtensionBag;
}

/** Result of executing (or skipping) one planned request. */
export interface RequestRunResult {
  readonly requestId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly outcome: RequestRunOutcomeKind;
  /** Wall-clock time for the orchestrator call when the request was attempted. */
  readonly durationMs?: number;
  readonly statusCode?: number;
  /** Secret-free message for UI / summary. */
  readonly message?: string;
  /** Assertion counts when the orchestrator evaluated expects for this attempt. */
  readonly assertionsPassed?: number;
  readonly assertionsFailed?: number;
  readonly assertionsTotal?: number;
}

/** Aggregate counts and timing for a finished run. */
export interface RunStatistics {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
  readonly durationMs: number;
  /**
   * Mean wall-clock time across attempted requests that reported `durationMs`.
   * Zero when no attempts reported timing.
   */
  readonly averageResponseTimeMs: number;
  /** Sum of per-request assertion pass counts. */
  readonly assertionsPassed: number;
  /** Sum of per-request assertion fail (+ malformed) counts. */
  readonly assertionsFailed: number;
  /** Sum of per-request assertion totals. */
  readonly assertionsTotal: number;
}

/** Immutable summary produced when a run finishes, stops, or is cancelled. */
export interface RunSummary {
  readonly runId: RunIdentifier;
  readonly plan: RunPlan;
  readonly results: readonly RequestRunResult[];
  readonly statistics: RunStatistics;
  /** ISO-8601 completion timestamp. */
  readonly completedAt: string;
  readonly status: CollectionRunStatus;
}

/**
 * Handle for one collection run lifecycle. `summary` is present after the run
 * reaches a terminal state.
 */
export interface CollectionRun {
  readonly id: RunIdentifier;
  readonly plan: RunPlan;
  readonly summary?: RunSummary;
  readonly extensions?: CollectionRunExtensionBag;
}

/** Progress phases emitted by {@link CollectionRunnerService}. */
export type RunProgressPhase =
  | 'started'
  | 'request-started'
  | 'request-finished'
  | 'completed';

/** Progress snapshot for UI adapters (notification / status bar). */
export interface RunProgressEvent {
  readonly runId: RunIdentifier;
  readonly phase: RunProgressPhase;
  readonly current?: PlannedRequest;
  readonly completed: number;
  readonly remaining: number;
  readonly total: number;
  readonly elapsedMs: number;
  readonly lastResult?: RequestRunResult;
}

/** Creates a new opaque run identifier. */
export function createRunIdentifier(
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): RunIdentifier {
  const suffix = Math.floor(random() * 1_000_000_000)
    .toString(36)
    .padStart(6, '0');
  return `run_${nowMs.toString(36)}_${suffix}`;
}

/** Deeply freezes a detached run plan. */
export function freezeRunPlan(plan: RunPlan): RunPlan {
  return deepFreeze(cloneDetached(plan));
}

/** Deeply freezes a detached run summary. */
export function freezeRunSummary(summary: RunSummary): RunSummary {
  return deepFreeze(cloneDetached(summary));
}

/** Builds aggregate statistics from per-request results. */
export function buildRunStatistics(
  results: readonly RequestRunResult[],
  durationMs: number,
): RunStatistics {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = 0;
  let timingSum = 0;
  let timingCount = 0;
  let assertionsPassed = 0;
  let assertionsFailed = 0;
  let assertionsTotal = 0;

  for (const result of results) {
    switch (result.outcome) {
      case RequestRunOutcomeKind.Passed:
        passed += 1;
        break;
      case RequestRunOutcomeKind.Failed:
        failed += 1;
        break;
      case RequestRunOutcomeKind.Skipped:
        skipped += 1;
        break;
      case RequestRunOutcomeKind.Cancelled:
        cancelled += 1;
        break;
    }
    if (result.durationMs !== undefined) {
      timingSum += result.durationMs;
      timingCount += 1;
    }
    assertionsPassed += result.assertionsPassed ?? 0;
    assertionsFailed += result.assertionsFailed ?? 0;
    assertionsTotal += result.assertionsTotal ?? 0;
  }

  return {
    total: results.length,
    passed,
    failed,
    skipped,
    cancelled,
    durationMs,
    averageResponseTimeMs:
      timingCount === 0 ? 0 : Math.round(timingSum / timingCount),
    assertionsPassed,
    assertionsFailed,
    assertionsTotal,
  };
}
