import type {
  HistoryCaptureContext,
  RunAtSourceLocationOptions,
  RunAtSourceLocationResult,
  RunRequestSource,
} from '../orchestration';
import {
  presentExecutionResult,
  type PresentExecutionOptions,
  type ResponsePresentation,
} from '../response/presentation';
import type { RunVariableStore } from '../variables';
import { resolveFailurePolicy, type FailurePolicy } from './failure-policies';
import {
  CollectionRunStatus,
  RequestFailureCategory,
  RequestRunOutcomeKind,
  buildRunStatistics,
  describeFailureCategory,
  freezeRunSummary,
  type DependencyEdge,
  type PlannedRequest,
  type RequestAttemptRecord,
  type RequestFailureDiagnostics,
  type RequestRunResult,
  type RunPlan,
  type RunProgressAttempt,
  type RunProgressEvent,
  type RunSummary,
} from './models';
import {
  computeRetryDelayMs,
  delay as cancellableDelay,
  isCollectionRetryEligible,
  isCollectionRetryEligibleFromSideEffectContext,
} from './retry-eligibility';
import {
  DESTRUCTIVE_REQUEST_SKIP_REASON,
  isDestructiveHttpMethod,
  normalizeCollectionRunOptions,
  type CollectionRunOptions,
} from './run-options';

/**
 * Narrow port over {@link ExecutionOrchestrator.runAtSourceLocation}.
 * Collection runner tests fake this port; production wires the orchestrator.
 */
export interface CollectionRequestExecutorPort {
  runAtSourceLocation(
    source: RunRequestSource,
    options?: RunAtSourceLocationOptions,
  ): Promise<RunAtSourceLocationResult>;
}

/** Reads `.api` source text for a planned request file URI/path. */
export interface CollectionRunSourceReader {
  readText(filePath: string): Promise<string>;
}

/** Progress callback port for UI adapters. */
export interface CollectionRunProgressPort {
  onProgress(event: RunProgressEvent): void;
}

export interface CollectionRunnerOptions {
  readonly executor: CollectionRequestExecutorPort;
  readonly sourceReader: CollectionRunSourceReader;
  readonly progress?: CollectionRunProgressPort;
  readonly now?: () => number;
  /**
   * Injectable delay between retries (tests). Defaults to
   * {@link cancellableDelay}.
   */
  readonly delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ExecuteRunOptions {
  readonly plan: RunPlan;
  /** Aborts the in-flight request and skips the remainder. */
  readonly signal?: AbortSignal;
  /** Optional secret-free history labels for every attempt in this run. */
  readonly historyCaptureContext?: HistoryCaptureContext;
  /**
   * Active per-run store (Phase 2). When present, enables the pre-flight
   * dependency check: a request whose incoming implicit edge variable is
   * still absent from this store after its producer ran is skipped rather
   * than attempted (§6.7).
   */
  readonly runVariableStore?: RunVariableStore;
  /**
   * Names of variables statically defined outside the run store (env,
   * collection, workspace, global — §6.7). A missing run-store value does
   * not trigger a pre-flight skip when its name is present here, since a
   * static definition can still satisfy the request. Evaluated per
   * pre-flight check (not captured once) so mid-run collection variable
   * refreshes are honored.
   */
  readonly staticVariableNames?: () => ReadonlySet<string>;
}

/**
 * Sequential collection runner. Builds no HTTP logic of its own — every
 * attempted request goes through {@link CollectionRequestExecutorPort}.
 * Retry and destructive-skip live only here (not in a second engine).
 */
export class CollectionRunnerService {
  private readonly now: () => number;
  private readonly delay: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  public constructor(private readonly options: CollectionRunnerOptions) {
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? cancellableDelay;
  }

  public async execute(options: ExecuteRunOptions): Promise<RunSummary> {
    const { plan } = options;
    const policy = resolveFailurePolicy(plan.failurePolicy);
    const runOptions = normalizeCollectionRunOptions(plan.runOptions);
    const startedAt = this.now();
    const results: RequestRunResult[] = [];
    const resultsById = new Map<string, RequestRunResult>();
    const labelById = new Map(
      plan.requests.map((request) => [request.requestId, request.label]),
    );
    const dependencyEdges: readonly DependencyEdge[] =
      plan.extensions?.dependencies?.edges ?? [];
    let status: (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus] =
      CollectionRunStatus.Completed;
    let stop = false;

    this.emit({
      runId: plan.runId,
      phase: 'started',
      completed: 0,
      remaining: plan.requests.length,
      total: plan.requests.length,
      elapsedMs: 0,
    });

    for (const planned of plan.requests) {
      if (stop || options.signal?.aborted) {
        status =
          status === CollectionRunStatus.Stopped
            ? CollectionRunStatus.Stopped
            : CollectionRunStatus.Cancelled;
        // When stopped by failure policy, remaining requests are skipped — not
        // cancelled — so statistics distinguish policy stops from user abort.
        if (status === CollectionRunStatus.Stopped) {
          const skipped: RequestRunResult = {
            requestId: planned.requestId,
            ordinal: planned.ordinal,
            label: planned.label,
            outcome: RequestRunOutcomeKind.Skipped,
            message: 'Skipped after earlier failure.',
          };
          results.push(skipped);
          resultsById.set(planned.requestId, skipped);
        } else {
          const cancelled = cancelledResult(planned, 'Run cancelled.');
          results.push(cancelled);
          resultsById.set(planned.requestId, cancelled);
        }
        continue;
      }

      this.emit({
        runId: plan.runId,
        phase: 'request-started',
        current: planned,
        completed: results.length,
        remaining: plan.requests.length - results.length,
        total: plan.requests.length,
        elapsedMs: this.now() - startedAt,
      });

      const result = await this.executeOne(
        planned,
        policy,
        runOptions,
        options.signal,
        options.historyCaptureContext,
        {
          dependencyEdges,
          labelById,
          resultsById,
          runVariableStore: options.runVariableStore,
          staticVariableNames: options.staticVariableNames,
        },
        (attempt) => {
          this.emit({
            runId: plan.runId,
            phase: 'request-started',
            current: planned,
            completed: results.length,
            remaining: plan.requests.length - results.length,
            total: plan.requests.length,
            elapsedMs: this.now() - startedAt,
            attempt,
          });
        },
      );
      results.push(result);
      resultsById.set(planned.requestId, result);

      this.emit({
        runId: plan.runId,
        phase: 'request-finished',
        current: planned,
        completed: results.length,
        remaining: plan.requests.length - results.length,
        total: plan.requests.length,
        elapsedMs: this.now() - startedAt,
        lastResult: result,
      });

      if (result.outcome === RequestRunOutcomeKind.Cancelled) {
        status = CollectionRunStatus.Cancelled;
        stop = true;
        continue;
      }

      if (policy.shouldStopAfter(result)) {
        status = CollectionRunStatus.Stopped;
        stop = true;
      }
    }

    const summary = freezeRunSummary({
      runId: plan.runId,
      plan,
      results,
      statistics: buildRunStatistics(results, this.now() - startedAt),
      completedAt: new Date(this.now()).toISOString(),
      status,
    });

    this.emit({
      runId: plan.runId,
      phase: 'completed',
      completed: results.length,
      remaining: 0,
      total: plan.requests.length,
      elapsedMs: summary.statistics.durationMs,
    });

    return summary;
  }

  private async executeOne(
    planned: PlannedRequest,
    policy: FailurePolicy,
    runOptions: CollectionRunOptions,
    signal: AbortSignal | undefined,
    historyCaptureContext: HistoryCaptureContext | undefined,
    dependencyContext: DependencyPreflightContext,
    onAttemptProgress: (attempt: RunProgressAttempt) => void,
  ): Promise<RequestRunResult> {
    if (signal?.aborted) {
      return cancelledResult(planned, 'Run cancelled.');
    }

    const skipReason = findPreflightSkipReason(planned, dependencyContext);
    if (skipReason !== undefined) {
      return {
        requestId: planned.requestId,
        ordinal: planned.ordinal,
        label: planned.label,
        outcome: RequestRunOutcomeKind.Skipped,
        message: skipReason,
        skipReason,
      };
    }

    if (
      runOptions.skipDestructiveRequests &&
      isDestructiveHttpMethod(planned.method)
    ) {
      return {
        requestId: planned.requestId,
        ordinal: planned.ordinal,
        label: planned.label,
        outcome: RequestRunOutcomeKind.Skipped,
        message: DESTRUCTIVE_REQUEST_SKIP_REASON,
        skipReason: DESTRUCTIVE_REQUEST_SKIP_REASON,
      };
    }

    let text: string;
    try {
      text = await this.options.sourceReader.readText(planned.filePath);
    } catch {
      const outcome = policy.classifyInvalid();
      const reason = 'Unable to read the request file.';
      return {
        requestId: planned.requestId,
        ordinal: planned.ordinal,
        label: planned.label,
        outcome,
        ...buildFailureFields({
          category: RequestFailureCategory.Unread,
          reason,
          httpRequestSent: false,
        }),
      };
    }

    if (signal?.aborted) {
      return cancelledResult(planned, 'Run cancelled.');
    }

    const maxAttempts = runOptions.retry.enabled
      ? runOptions.retry.maxRetries + 1
      : 1;
    const attempts: RequestAttemptRecord[] = [];
    const requestStartedAt = this.now();

    for (
      let attemptNumber = 1;
      attemptNumber <= maxAttempts;
      attemptNumber += 1
    ) {
      if (signal?.aborted) {
        return attachAttempts(
          cancelledResult(planned, 'Run cancelled.'),
          attempts,
          this.now() - requestStartedAt,
        );
      }

      if (maxAttempts > 1) {
        onAttemptProgress({
          current: attemptNumber,
          max: maxAttempts,
          phase: 'executing',
        });
      }

      const attemptStarted = this.now();
      const retriesRemainingAfterThisAttempt = maxAttempts - attemptNumber;
      let mapped: RequestRunResult;
      try {
        const runResult = await this.options.executor.runAtSourceLocation(
          {
            text,
            sourceId: planned.filePath,
            offset: planned.offset,
          },
          {
            showViewer: false,
            useProgressUi: false,
            showNotifications: false,
            ...(signal === undefined ? {} : { signal }),
            ...(historyCaptureContext === undefined
              ? {}
              : { historyCaptureContext }),
            ...(runOptions.retry.enabled && maxAttempts > 1
              ? {
                  shouldCommitSideEffects: (ctx) => {
                    if (retriesRemainingAfterThisAttempt <= 0) {
                      return true;
                    }
                    return !isCollectionRetryEligibleFromSideEffectContext(ctx);
                  },
                }
              : {}),
          },
        );
        mapped = mapOrchestratorResult(
          planned,
          runResult,
          policy,
          this.now() - attemptStarted,
          historyCaptureContext?.environmentName === undefined
            || historyCaptureContext.environmentName.trim().length === 0
            ? undefined
            : {
                environmentLabel: historyCaptureContext.environmentName.trim(),
              },
        );
      } catch {
        const reason = 'The request could not be executed.';
        mapped = {
          requestId: planned.requestId,
          ordinal: planned.ordinal,
          label: planned.label,
          outcome: RequestRunOutcomeKind.Failed,
          durationMs: this.now() - attemptStarted,
          ...buildFailureFields({
            category: RequestFailureCategory.Transport,
            reason,
            httpRequestSent: false,
          }),
        };
      }

      const willRetry =
        retriesRemainingAfterThisAttempt > 0 &&
        isCollectionRetryEligible(mapped);

      attempts.push(
        toAttemptRecord(attemptNumber, mapped, {
          displayAsRetryableFailure: willRetry,
        }),
      );

      if (mapped.outcome === RequestRunOutcomeKind.Cancelled) {
        return attachAttempts(
          mapped,
          attempts,
          this.now() - requestStartedAt,
        );
      }

      if (!willRetry) {
        return attachAttempts(
          mapped,
          attempts,
          this.now() - requestStartedAt,
        );
      }

      const waitMs = computeRetryDelayMs(
        attemptNumber,
        runOptions.retry.delayMs,
        runOptions.retry.backoff,
      );
      onAttemptProgress({
        current: attemptNumber + 1,
        max: maxAttempts,
        phase: 'waiting',
      });

      try {
        await this.delay(waitMs, signal);
      } catch {
        return attachAttempts(
          cancelledResult(planned, 'Run cancelled.'),
          attempts,
          this.now() - requestStartedAt,
        );
      }
    }

    // Unreachable when maxAttempts >= 1; satisfy the type checker.
    return attachAttempts(
      cancelledResult(planned, 'Run cancelled.'),
      attempts,
      this.now() - requestStartedAt,
    );
  }

  private emit(event: RunProgressEvent): void {
    this.options.progress?.onProgress(event);
  }
}

function toAttemptRecord(
  attemptNumber: number,
  result: RequestRunResult,
  options?: {
    /**
     * When true, record this attempt as a failed/retryable display row even if
     * the mapped orchestrator outcome is Passed (e.g. success+503 that will
     * be retried). Does not mutate the final {@link RequestRunResult}.
     */
    readonly displayAsRetryableFailure?: boolean;
  },
): RequestAttemptRecord {
  const displayAsFailure = options?.displayAsRetryableFailure === true;
  const outcome = displayAsFailure
    ? RequestRunOutcomeKind.Failed
    : result.outcome;
  const retryable = displayAsFailure
    ? true
    : result.outcome === RequestRunOutcomeKind.Failed
      ? isCollectionRetryEligible(result)
      : undefined;
  const message = displayAsFailure
    ? result.statusCode !== undefined
      ? `Retryable HTTP ${result.statusCode}`
      : (result.message ??
        result.failureDiagnostics?.reason ??
        'Retryable attempt')
    : result.message === undefined
      ? result.failureDiagnostics?.reason === undefined
        ? undefined
        : result.failureDiagnostics.reason
      : result.message;
  return {
    attemptNumber,
    outcome,
    ...(result.statusCode === undefined
      ? {}
      : { statusCode: result.statusCode }),
    ...(message === undefined ? {} : { message }),
    ...(result.durationMs === undefined
      ? {}
      : { durationMs: result.durationMs }),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

function attachAttempts(
  result: RequestRunResult,
  attempts: readonly RequestAttemptRecord[],
  wallClockMs: number,
): RequestRunResult {
  // Prefer summed orchestrator attempt timings so averageResponseTimeMs stays
  // aligned with per-attempt HTTP work (excludes inter-retry delays).
  const attemptSum = attempts.reduce(
    (sum, attempt) => sum + (attempt.durationMs ?? 0),
    0,
  );
  const durationMs =
    attempts.length === 0
      ? wallClockMs
      : attemptSum > 0
        ? attemptSum
        : (result.durationMs ?? wallClockMs);
  return {
    ...result,
    durationMs,
    ...(attempts.length === 0
      ? {}
      : { attempts: Object.freeze([...attempts]) }),
  };
}

/** Per-run context threaded into {@link findPreflightSkipReason} (§6.7). */
interface DependencyPreflightContext {
  readonly dependencyEdges: readonly DependencyEdge[];
  readonly labelById: ReadonlyMap<string, string>;
  readonly resultsById: ReadonlyMap<string, RequestRunResult>;
  readonly runVariableStore: RunVariableStore | undefined;
  readonly staticVariableNames: (() => ReadonlySet<string>) | undefined;
}

/**
 * Skips a request when an incoming implicit (produces/consumes) edge's
 * variable is still absent from the active run store after its producer has
 * already run — topo order guarantees the producer ran first, so a missing
 * value means it failed, was skipped, or did not extract the variable.
 *
 * A run-store miss does not skip when the variable is also statically
 * defined (env / collection / workspace / global, §6.7): resolution falls
 * through to that definition at request time, so skipping would be wrong.
 */
function findPreflightSkipReason(
  planned: PlannedRequest,
  context: DependencyPreflightContext,
): string | undefined {
  const {
    dependencyEdges,
    labelById,
    resultsById,
    runVariableStore,
    staticVariableNames,
  } = context;
  if (runVariableStore === undefined) {
    return undefined;
  }
  const incoming = dependencyEdges.filter(
    (edge) =>
      edge.toRequestId === planned.requestId &&
      edge.kind === 'implicit' &&
      edge.variable !== undefined,
  );
  if (incoming.length === 0) {
    return undefined;
  }
  // Evaluated lazily (once per request, not once per run) so a collection
  // variable extracted or refreshed mid-run is visible to later pre-flights.
  const staticNames = staticVariableNames?.();
  for (const edge of incoming) {
    const variable = edge.variable!;
    if (runVariableStore.get(variable) !== undefined) {
      continue;
    }
    if (staticNames?.has(variable) === true) {
      continue;
    }
    const producerLabel = labelById.get(edge.fromRequestId) ?? edge.fromRequestId;
    const producerState = describeProducerState(
      resultsById.get(edge.fromRequestId),
    );
    return `Missing run variable: ${variable} (producer ${producerLabel} ${producerState})`;
  }
  return undefined;
}

function describeProducerState(result: RequestRunResult | undefined): string {
  if (result === undefined) {
    return 'did not run';
  }
  switch (result.outcome) {
    case RequestRunOutcomeKind.Failed:
      return 'failed';
    case RequestRunOutcomeKind.Skipped:
      return 'was skipped';
    case RequestRunOutcomeKind.Cancelled:
      return 'was cancelled';
    case RequestRunOutcomeKind.Passed:
      return 'did not produce it';
  }
}

/**
 * Maps an orchestrator attempt onto {@link RequestRunResult}.
 * Shared by CollectionRunnerService and headless hosts (MCP) so single-request
 * and collection-run outcomes stay aligned (including blocking extraction).
 */
export function mapOrchestratorResult(
  planned: PlannedRequest,
  runResult: RunAtSourceLocationResult,
  policy: FailurePolicy,
  fallbackDurationMs: number,
  presentOptions?: PresentExecutionOptions,
): RequestRunResult {
  const durationMs = runResult.durationMs ?? fallbackDurationMs;
  const assertionFields = assertionFieldsFrom(runResult);
  const extractionFields = extractionFieldsFrom(runResult);
  const consumedVariables =
    planned.consumes !== undefined && planned.consumes.length > 0
      ? planned.consumes
      : undefined;
  const presentation =
    runResult.execution === undefined
      ? undefined
      : presentExecutionResult(
          runResult.execution,
          runResult.assertions,
          runResult.extraction,
          presentOptions,
        );
  const base = {
    requestId: planned.requestId,
    ordinal: planned.ordinal,
    label: planned.label,
    durationMs,
    ...(runResult.statusCode === undefined
      ? {}
      : { statusCode: runResult.statusCode }),
    ...assertionFields,
    ...extractionFields,
    ...(consumedVariables === undefined ? {} : { consumedVariables }),
    ...(presentation === undefined ? {} : { presentation }),
    ...(runResult.resolvedVariables === undefined
      ? {}
      : { resolvedVariables: runResult.resolvedVariables }),
  };

  const httpRequestSent = runResult.execution !== undefined;

  // Orchestrator contract: assertion failures return outcome 'failed' with
  // assertionFailed: true (never 'success' + assertionFailed).
  // Required/malformed extraction failures may still arrive as 'success'
  // with an extraction report — map those to Failed (§9.4 stop-on-first-error).
  switch (runResult.outcome) {
    case 'success':
      if (hasBlockingExtractionFailure(runResult.extraction)) {
        const explanation = explanationFromPresentation(presentation);
        return {
          ...base,
          outcome: RequestRunOutcomeKind.Failed,
          ...buildFailureFields({
            category: RequestFailureCategory.Extraction,
            reason: describeExtractionFailure(runResult.extraction),
            httpRequestSent,
            failedAtStage: 'extraction',
            ...(explanation === undefined ? {} : { explanation }),
          }),
        };
      }
      return {
        ...base,
        outcome: RequestRunOutcomeKind.Passed,
      };
    case 'failed':
      return {
        ...base,
        outcome: RequestRunOutcomeKind.Failed,
        ...buildFailureFields(
          describeExecutionFailure(runResult, presentation, httpRequestSent),
        ),
      };
    case 'cancelled':
      return {
        ...base,
        outcome: RequestRunOutcomeKind.Cancelled,
        ...buildFailureFields({
          category: RequestFailureCategory.Cancelled,
          reason: 'Request cancelled.',
          httpRequestSent,
        }),
      };
    case 'replaced':
      return {
        ...base,
        outcome: RequestRunOutcomeKind.Cancelled,
        ...buildFailureFields({
          category: RequestFailureCategory.Cancelled,
          reason: 'Request replaced by another run.',
          httpRequestSent,
        }),
      };
    case 'precondition-failed': {
      const outcome = policy.classifyInvalid();
      return {
        ...base,
        outcome,
        ...buildFailureFields({
          category: RequestFailureCategory.Precondition,
          reason:
            runResult.message ??
            'The request could not be prepared for execution.',
          httpRequestSent,
          ...(runResult.preconditionStage === undefined
            ? {}
            : { failedAtStage: runResult.preconditionStage }),
        }),
      };
    }
  }
}

/** Concise `message` + typed diagnostics built from one already-known failure. */
function buildFailureFields(input: {
  readonly category: RequestFailureCategory;
  readonly reason: string;
  readonly httpRequestSent: boolean;
  readonly failedAtStage?: string;
  readonly explanation?: RequestFailureDiagnostics['explanation'];
}): Pick<RequestRunResult, 'message' | 'failureDiagnostics'> {
  const failureDiagnostics: RequestFailureDiagnostics = {
    category: input.category,
    reason: input.reason,
    httpRequestSent: input.httpRequestSent,
    ...(input.failedAtStage === undefined
      ? {}
      : { failedAtStage: input.failedAtStage }),
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
  };
  return {
    message: `${describeFailureCategory(input.category)}\n${input.reason}`,
    failureDiagnostics,
  };
}

/**
 * Projects presentation explanation onto diagnostics without re-classifying.
 */
function explanationFromPresentation(
  presentation: ResponsePresentation | undefined,
): RequestFailureDiagnostics['explanation'] | undefined {
  const explanation = presentation?.explanation;
  if (explanation === undefined) {
    return undefined;
  }
  return {
    title: explanation.title,
    facts: explanation.facts,
    possibleCauses: explanation.possibleCauses,
  };
}

/**
 * Classifies an orchestrator `failed` outcome from data already produced by
 * the pipeline. Transport wins over assertions: when the HTTP attempt itself
 * did not complete, assertion outcomes only restate the transport error.
 */
function describeExecutionFailure(
  runResult: RunAtSourceLocationResult,
  presentation: ResponsePresentation | undefined,
  httpRequestSent: boolean,
): {
  readonly category: RequestFailureCategory;
  readonly reason: string;
  readonly httpRequestSent: boolean;
  readonly failedAtStage?: string;
  readonly explanation?: RequestFailureDiagnostics['explanation'];
} {
  const explanation = explanationFromPresentation(presentation);
  const httpCompleted =
    runResult.execution?.success === true || runResult.statusCode !== undefined;
  if (httpCompleted) {
    if (runResult.assertionFailed === true) {
      return {
        category: RequestFailureCategory.Assertion,
        reason: describeAssertionFailure(presentation),
        httpRequestSent,
        failedAtStage: 'assertions',
        ...(explanation === undefined ? {} : { explanation }),
      };
    }
    if (hasBlockingExtractionFailure(runResult.extraction)) {
      return {
        category: RequestFailureCategory.Extraction,
        reason: describeExtractionFailure(runResult.extraction),
        httpRequestSent,
        failedAtStage: 'extraction',
        ...(explanation === undefined ? {} : { explanation }),
      };
    }
  }
  return {
    category: RequestFailureCategory.Transport,
    reason: describeTransportFailure(runResult, presentation),
    httpRequestSent,
    failedAtStage: 'transport',
    ...(explanation === undefined ? {} : { explanation }),
  };
}

function describeTransportFailure(
  runResult: RunAtSourceLocationResult,
  presentation: ResponsePresentation | undefined,
): string {
  const failure = presentation?.failure;
  if (failure !== undefined) {
    return failure.message.length > 0
      ? `${failure.title}: ${failure.message}`
      : failure.title;
  }
  const errorCode = runResult.assertions?.context.errorCode;
  if (errorCode !== undefined) {
    return `The request did not complete (${errorCode}).`;
  }
  return 'The request did not complete.';
}

/** Max chars for expected/actual in the execution-table row message. */
const ASSERTION_ROW_VALUE_MAX_CHARS = 100;

/**
 * First failed/malformed assertion diagnostic from presentation.
 * Prefers Expected/Actual (engine-masked failure fields, truncated for the
 * row), then assertion text, then `failure.reason`. Does not re-evaluate or
 * re-parse assertions.
 */
function describeAssertionFailure(
  presentation: ResponsePresentation | undefined,
): string {
  const failedAssertion = presentation?.assertions?.assertions.find(
    (assertion) => assertion.failure !== undefined,
  );
  if (failedAssertion?.failure === undefined) {
    return 'One or more assertions failed.';
  }
  const failure = failedAssertion.failure;
  if (failure.expected !== undefined && failure.actual !== undefined) {
    return (
      `Expected ${truncateAssertionRowValue(failure.expected)}` +
      ` but received ${truncateAssertionRowValue(failure.actual)}`
    );
  }
  const assertionText =
    failure.assertionText.length > 0
      ? failure.assertionText
      : failedAssertion.text;
  if (assertionText.length > 0) {
    return assertionText;
  }
  return failure.reason;
}

function truncateAssertionRowValue(value: string): string {
  if (value.length <= ASSERTION_ROW_VALUE_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, ASSERTION_ROW_VALUE_MAX_CHARS - 1)}…`;
}

function describeExtractionFailure(
  report: RunAtSourceLocationResult['extraction'],
): string {
  const outcome = report?.outcomes.find(
    (candidate) =>
      candidate.kind === 'malformed' ||
      (candidate.kind === 'failed' && candidate.rule.required === true),
  );
  if (outcome === undefined) {
    return 'One or more extract rules failed.';
  }
  const name = outcome.rule.variableName;
  return outcome.reason === undefined
    ? `Could not extract "${name}".`
    : `Could not extract "${name}": ${outcome.reason}`;
}

function assertionFieldsFrom(
  runResult: RunAtSourceLocationResult,
): Pick<
  RequestRunResult,
  'assertionsPassed' | 'assertionsFailed' | 'assertionsTotal'
> {
  const summary = runResult.assertions?.summary;
  if (summary === undefined) {
    return {};
  }
  return {
    assertionsPassed: summary.passed,
    assertionsFailed: summary.failed + summary.malformed,
    assertionsTotal: summary.total,
  };
}

function extractionFieldsFrom(
  runResult: RunAtSourceLocationResult,
): Pick<RequestRunResult, 'producedVariables' | 'extractionFailed'> {
  const report = runResult.extraction;
  if (report === undefined) {
    return {};
  }
  const producedVariables = report.outcomes
    .filter((outcome) => outcome.kind === 'extracted')
    .map((outcome) => outcome.rule.variableName);
  return {
    producedVariables,
    extractionFailed: report.failedCount + report.malformedCount > 0,
  };
}

/**
 * §9.4: required extract failure or any malformed outcome fails the request.
 * Optional not-found → skipped (does not fail). Optional write failures are
 * kind=failed with required=false and do not fail solely via this check.
 */
function hasBlockingExtractionFailure(
  report: RunAtSourceLocationResult['extraction'],
): boolean {
  if (report === undefined) {
    return false;
  }
  return report.outcomes.some(
    (outcome) =>
      outcome.kind === 'malformed' ||
      (outcome.kind === 'failed' && outcome.rule.required === true),
  );
}

function cancelledResult(
  planned: PlannedRequest,
  message: string,
): RequestRunResult {
  return {
    requestId: planned.requestId,
    ordinal: planned.ordinal,
    label: planned.label,
    outcome: RequestRunOutcomeKind.Cancelled,
    ...buildFailureFields({
      category: RequestFailureCategory.Cancelled,
      reason: message,
      httpRequestSent: false,
    }),
  };
}
