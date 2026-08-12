import { cloneDetached, deepFreeze } from '../shared';
import type { ResponsePresentation } from '../response/presentation';
import type { ResolvedVariableSnapshot } from '../variables';
import type { CollectionRunOptions } from './run-options';

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

/**
 * Closed taxonomy for why a request did not pass. Derived once in
 * `mapOrchestratorResult` from data the pipeline already produced — never
 * re-validated or re-classified downstream.
 */
export const RequestFailureCategory = {
  Precondition: 'precondition',
  Transport: 'transport',
  Assertion: 'assertion',
  Extraction: 'extraction',
  Unread: 'unread',
  Cancelled: 'cancelled',
} as const;

export type RequestFailureCategory =
  (typeof RequestFailureCategory)[keyof typeof RequestFailureCategory];

/**
 * Secret-free diagnostics for a non-passing request. `reason` is the single
 * source of truth; {@link RequestRunResult.message} is a concise summary
 * derived from it and must never contradict it.
 */
export interface RequestFailureDiagnostics {
  readonly category: RequestFailureCategory;
  /** Secret-free human reason (SSoT for all failure text). */
  readonly reason: string;
  /** True when the orchestrator attached `execution` (a network attempt ran). */
  readonly httpRequestSent: boolean;
  /**
   * Single recorded stage the request stopped at — the orchestrator's
   * `preconditionStage` or a derived label. Never a synthetic stage timeline.
   */
  readonly failedAtStage?: string;
  /**
   * Additive deterministic status/transport guidance. Speculative lines are
   * always under `possibleCauses` (never stated as proven fact).
   */
  readonly explanation?: {
    readonly title: string;
    readonly facts: readonly string[];
    readonly possibleCauses: readonly string[];
  };
}

/** Terminal status of an entire collection run. */
export const CollectionRunStatus = {
  Completed: 'completed',
  Cancelled: 'cancelled',
  Stopped: 'stopped',
} as const;

export type CollectionRunStatus =
  (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus];

/** Kind of edge recorded between two requests in a dependency graph. */
export type DependencyEdgeKind = 'implicit' | 'explicit';

/**
 * One directed dependency edge: `fromRequestId` must execute before
 * `toRequestId`. `variable` is present for implicit (produces/consumes) edges;
 * absent for explicit `@depends-on` edges with no associated variable.
 */
export interface DependencyEdge {
  readonly fromRequestId: string;
  readonly toRequestId: string;
  readonly kind: DependencyEdgeKind;
  readonly variable?: string;
}

/** Per-request produces/consumes/depends-on summary attached to a dependency graph. */
export interface DependencyNodeMeta {
  readonly requestId: string;
  readonly produces: readonly string[];
  readonly consumes: readonly string[];
  readonly dependsOnNames: readonly string[];
}

/** Typed `extensions.dependencies` bag populated by `enrichRunPlanWithDependencies`. */
export interface DependenciesExtension {
  readonly nodes: readonly DependencyNodeMeta[];
  readonly edges: readonly DependencyEdge[];
  readonly reordered: boolean;
  readonly originalOrder: readonly string[];
  readonly executionOrder: readonly string[];
  readonly cycles: readonly (readonly string[])[];
  readonly unresolvedConsumes: readonly {
    readonly requestId: string;
    readonly variable: string;
  }[];
}

/**
 * Typed `extensions.variablesPerRun` bag — enrich-time snapshot of declared
 * produces per request (`storeKind` + `producedByRequest`). Not a live store
 * dump; actual extractions names live on {@link RequestRunResult.producedVariables}.
 */
export interface VariablesPerRunExtension {
  readonly storeKind: 'in-memory';
  readonly producedByRequest: Readonly<Record<string, readonly string[]>>;
}

/**
 * Reserved bags for deferred runner features. `dependencies` and
 * `variablesPerRun` are typed (Phase 2); other keys stay opaque until their
 * owning feature lands. Do not scaffold competing modules for these keys.
 */
export interface CollectionRunExtensionBag {
  readonly parallel?: Readonly<Record<string, unknown>>;
  readonly conditional?: Readonly<Record<string, unknown>>;
  readonly dependencies?: DependenciesExtension;
  readonly variablesPerRun?: VariablesPerRunExtension;
  readonly ci?: Readonly<Record<string, unknown>>;
  readonly cli?: Readonly<Record<string, unknown>>;
  readonly reports?: Readonly<Record<string, unknown>>;
  readonly assertions?: Readonly<Record<string, unknown>>;
  readonly ai?: Readonly<Record<string, unknown>>;
  readonly export?: Readonly<Record<string, unknown>>;
  readonly [key: string]:
    | Readonly<Record<string, unknown>>
    | DependenciesExtension
    | VariablesPerRunExtension
    | undefined;
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
  /**
   * Folder `relativePath` for depend-ref qualification (`''` / omitted for root).
   */
  readonly folderRelativePath?: string;
  /** Variable names this request's enabled extract rules may produce (Phase 2). */
  readonly produces?: readonly string[];
  /** Variable names referenced via `{{name}}` that need external resolution (Phase 2). */
  readonly consumes?: readonly string[];
  /**
   * Discovery request ids resolved from this request's `@depends-on` tokens
   * (human-readable refs → ids at enrich time).
   */
  readonly dependsOnRequestIds?: readonly string[];
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
  /**
   * Validated retry / skip-destructive options for this plan.
   * Omitted → identical to historical behavior (no retries, no destructive skip).
   */
  readonly runOptions?: CollectionRunOptions;
  readonly requests: readonly PlannedRequest[];
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  readonly extensions?: CollectionRunExtensionBag;
}

/**
 * One HTTP / orchestrator attempt within a single planned request.
 * Retries append entries here — the parent {@link RequestRunResult} stays one row.
 */
export interface RequestAttemptRecord {
  /** 1-based attempt number. */
  readonly attemptNumber: number;
  readonly outcome: RequestRunOutcomeKind;
  readonly statusCode?: number;
  /** Secret-free message / reason for this attempt. */
  readonly message?: string;
  readonly durationMs?: number;
  /** Whether this failed attempt was classified as retryable. */
  readonly retryable?: boolean;
}

/** Result of executing (or skipping) one planned request. */
export interface RequestRunResult {
  readonly requestId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly outcome: RequestRunOutcomeKind;
  /**
   * Summed orchestrator attempt timings (excludes inter-retry delays).
   * For a single attempt, matches the orchestrator duration.
   */
  readonly durationMs?: number;
  readonly statusCode?: number;
  /** Secret-free message for UI / summary. */
  readonly message?: string;
  /**
   * Typed failure facts for the Run Report Details panel. Omitted for passed
   * requests and for policy skips that are not failures (dependency skips
   * keep {@link skipReason} instead).
   */
  readonly failureDiagnostics?: RequestFailureDiagnostics;
  /** Assertion counts when the orchestrator evaluated expects for this attempt. */
  readonly assertionsPassed?: number;
  readonly assertionsFailed?: number;
  readonly assertionsTotal?: number;
  /** Variable names actually extracted for this attempt (Phase 2). */
  readonly producedVariables?: readonly string[];
  /**
   * Variable names this request planned to consume (from plan-time `consumes`).
   * Secret-free names only — for run report display.
   */
  readonly consumedVariables?: readonly string[];
  /** Secret-free reason this request was skipped due to a dependency (Phase 2). */
  readonly skipReason?: string;
  /**
   * True when the extraction report had any failed or malformed outcome
   * (including optional write failures). Report/UI flag only — stop/fail
   * policy uses {@link RequestRunOutcomeKind.Failed} after required/malformed
   * mapping (§9.4), not this flag alone.
   */
  readonly extractionFailed?: boolean;
  /**
   * Presentation-ready response for the Collection Run Debugger. Built once
   * via `presentExecutionResult` — never store raw RuntimeResponse here.
   */
  readonly presentation?: ResponsePresentation;
  /**
   * Secret-safe variable snapshots for Execution Details (referenced vars only).
   */
  readonly resolvedVariables?: readonly ResolvedVariableSnapshot[];
  /**
   * Per-attempt records when the request was executed (including retries).
   * Omitted for dependency / destructive skips that never attempted HTTP.
   */
  readonly attempts?: readonly RequestAttemptRecord[];
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
  /**
   * Categorized failure counts derived from
   * {@link RequestRunResult.failureDiagnostics}. Additive breakdown of the
   * existing `failed` / `skipped` totals — never a replacement for them.
   */
  readonly preconditionFailures: number;
  readonly transportFailures: number;
  readonly assertionFailures: number;
  readonly extractionFailures: number;
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

/** Live attempt visibility for retries (Execution Center / progress UI). */
export interface RunProgressAttempt {
  /** Current attempt (executing) or upcoming attempt (waiting), 1-based. */
  readonly current: number;
  /** Max attempts for this request (`maxRetries + 1` when retry enabled). */
  readonly max: number;
  readonly phase: 'executing' | 'waiting';
}

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
  /** Present while a request is executing or waiting between retries. */
  readonly attempt?: RunProgressAttempt;
}

/**
 * Human label for a failure category. Single source for the concise row
 * summary (`message` first line) and the report's Execution Status section.
 */
export function describeFailureCategory(
  category: RequestFailureCategory,
): string {
  switch (category) {
    case RequestFailureCategory.Precondition:
      return 'Validation Failed';
    case RequestFailureCategory.Transport:
      return 'Network Error';
    case RequestFailureCategory.Assertion:
      return 'Assertion Failed';
    case RequestFailureCategory.Extraction:
      return 'Extraction Failed';
    case RequestFailureCategory.Unread:
      return 'Request Unavailable';
    case RequestFailureCategory.Cancelled:
      return 'Cancelled';
  }
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
  let preconditionFailures = 0;
  let transportFailures = 0;
  let assertionFailures = 0;
  let extractionFailures = 0;

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
    switch (result.failureDiagnostics?.category) {
      case RequestFailureCategory.Precondition:
        preconditionFailures += 1;
        break;
      case RequestFailureCategory.Transport:
        transportFailures += 1;
        break;
      case RequestFailureCategory.Assertion:
        assertionFailures += 1;
        break;
      case RequestFailureCategory.Extraction:
        extractionFailures += 1;
        break;
      default:
        break;
    }
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
    preconditionFailures,
    transportFailures,
    assertionFailures,
    extractionFailures,
  };
}
