import type {
  HistoryCaptureContext,
  RunAtSourceLocationOptions,
  RunAtSourceLocationResult,
  RunRequestSource,
} from '../orchestration';
import { resolveFailurePolicy, type FailurePolicy } from './failure-policies';
import {
  CollectionRunStatus,
  RequestRunOutcomeKind,
  buildRunStatistics,
  freezeRunSummary,
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
          results.push({
            requestId: planned.requestId,
            ordinal: planned.ordinal,
            label: planned.label,
            outcome: RequestRunOutcomeKind.Skipped,
            message: 'Skipped after earlier failure.',
          });
        } else {
          results.push(cancelledResult(planned, 'Run cancelled.'));
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
      );
      results.push(result);

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
  ): Promise<RequestRunResult> {
    if (signal?.aborted) {
      return cancelledResult(planned, 'Run cancelled.');
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

function mapOrchestratorResult(
  planned: PlannedRequest,
  runResult: RunAtSourceLocationResult,
  policy: FailurePolicy,
  fallbackDurationMs: number,
): RequestRunResult {
  const durationMs = runResult.durationMs ?? fallbackDurationMs;
  const assertionFields = assertionFieldsFrom(runResult);
  const base = {
    requestId: planned.requestId,
    ordinal: planned.ordinal,
    label: planned.label,
    durationMs,
    ...(runResult.statusCode === undefined
      ? {}
      : { statusCode: runResult.statusCode }),
    ...assertionFields,
  };

  // Orchestrator contract: assertion failures return outcome 'failed' with
  // assertionFailed: true (never 'success' + assertionFailed).
  switch (runResult.outcome) {
    case 'success':
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
