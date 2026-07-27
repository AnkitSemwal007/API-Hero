import type {
  HistoryCaptureContext,
  RunAtSourceLocationOptions,
  RunAtSourceLocationResult,
  RunRequestSource,
} from '../orchestration';
import { presentExecutionResult } from '../response/presentation';
import type { RunVariableStore } from '../variables';
import { resolveFailurePolicy, type FailurePolicy } from './failure-policies';
import {
  CollectionRunStatus,
  RequestRunOutcomeKind,
  buildRunStatistics,
  freezeRunSummary,
  type DependencyEdge,
  type PlannedRequest,
  type RequestRunResult,
  type RunPlan,
  type RunProgressEvent,
  type RunSummary,
} from './models';

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
 */
export class CollectionRunnerService {
  private readonly now: () => number;

  public constructor(private readonly options: CollectionRunnerOptions) {
    this.now = options.now ?? Date.now;
  }

  public async execute(options: ExecuteRunOptions): Promise<RunSummary> {
    const { plan } = options;
    const policy = resolveFailurePolicy(plan.failurePolicy);
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
        options.signal,
        options.historyCaptureContext,
        {
          dependencyEdges,
          labelById,
          resultsById,
          runVariableStore: options.runVariableStore,
          staticVariableNames: options.staticVariableNames,
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
    signal: AbortSignal | undefined,
    historyCaptureContext: HistoryCaptureContext | undefined,
    dependencyContext: DependencyPreflightContext,
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

    let text: string;
    try {
      text = await this.options.sourceReader.readText(planned.filePath);
    } catch {
      const outcome = policy.classifyInvalid();
      return {
        requestId: planned.requestId,
        ordinal: planned.ordinal,
        label: planned.label,
        outcome,
        message: 'Unable to read the request file.',
      };
    }

    if (signal?.aborted) {
      return cancelledResult(planned, 'Run cancelled.');
    }

    const started = this.now();
    let runResult: RunAtSourceLocationResult;
    try {
      runResult = await this.options.executor.runAtSourceLocation(
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
        },
      );
    } catch {
      return {
        requestId: planned.requestId,
        ordinal: planned.ordinal,
        label: planned.label,
        outcome: RequestRunOutcomeKind.Failed,
        durationMs: this.now() - started,
        message: 'The request could not be executed.',
      };
    }

    return mapOrchestratorResult(
      planned,
      runResult,
      policy,
      this.now() - started,
    );
  }

  private emit(event: RunProgressEvent): void {
    this.options.progress?.onProgress(event);
  }
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
    const producerState = describeProducerState(resultsById.get(edge.fromRequestId));
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

function mapOrchestratorResult(
  planned: PlannedRequest,
  runResult: RunAtSourceLocationResult,
  policy: FailurePolicy,
  fallbackDurationMs: number,
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

  // Orchestrator contract: assertion failures return outcome 'failed' with
  // assertionFailed: true (never 'success' + assertionFailed).
  // Required/malformed extraction failures may still arrive as 'success'
  // with an extraction report — map those to Failed (§9.4 stop-on-first-error).
  switch (runResult.outcome) {
    case 'success':
      if (hasBlockingExtractionFailure(runResult.extraction)) {
        return {
          ...base,
          outcome: RequestRunOutcomeKind.Failed,
          message: 'Extraction failed.',
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
        message:
          runResult.assertionFailed === true &&
          runResult.statusCode !== undefined
            ? 'Assertions failed.'
            : 'Request failed.',
      };
    case 'cancelled':
      return {
        ...base,
        outcome: RequestRunOutcomeKind.Cancelled,
        message: 'Request cancelled.',
      };
    case 'replaced':
      return {
        ...base,
        outcome: RequestRunOutcomeKind.Cancelled,
        message: 'Request replaced by another run.',
      };
    case 'precondition-failed': {
      const outcome = policy.classifyInvalid();
      return {
        ...base,
        outcome,
        message:
          outcome === RequestRunOutcomeKind.Skipped
            ? 'Invalid request skipped.'
            : 'Request is invalid.',
      };
    }
  }
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
    message,
  };
}
