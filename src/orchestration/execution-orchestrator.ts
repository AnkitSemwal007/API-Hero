import type {
  ExecutionContext,
  ExecutionResult,
  RequestExecutor,
} from '../execution';
import {
  evaluateAssertions,
  extractAssertionsForOffset,
  hasAssertionFailures,
  toAssertionHistoryCounts,
  type TestReport,
} from '../assertions';
import {
  parseApiDocument,
  validateApiRequest,
  type ApiDocument,
  type ParserResult,
  type RequestNode,
  type ValidationResult,
} from '../parser';
import {
  buildSelectedRequest,
  type RequestBuildError,
} from '../request';
import type { AuthenticatedRequest, RuntimeRequest } from '../models';
import {
  ApiKeyAuthenticationProvider,
  AuthenticationAbortError,
  AuthenticationError,
  AuthenticationProviderRegistry,
  BasicAuthenticationProvider,
  BearerAuthenticationProvider,
  DefaultAuthenticationResolver,
  NoneAuthenticationProvider,
  type AuthenticationResolutionContext,
  type AuthenticationResolver,
} from '../auth';
import {
  DefaultVariableResolver,
  type VariableResolutionContext,
  type VariableResolver,
} from '../variables';
import {
  buildHistorySourceLocation,
  type HistoryRecorder,
} from '../history';
import { rangesOverlap } from '../shared';
import {
  RequestSelectionError,
  selectRequestAtOffset,
  type SelectedRequest,
} from './request-selection';

export interface RunRequestSource {
  readonly text: string;
  readonly sourceId: string;
  readonly offset: number;
}

export type ExecutionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'success'; readonly statusCode: number }
  | { readonly kind: 'failed' }
  | { readonly kind: 'cancelled' };

export interface ExecutionStatusPresenter {
  update(status: ExecutionStatus): void;
  dispose(): void;
}

export interface ExecutionProgressReporter {
  report(message: string): void;
}

export interface ExecutionProgressRunner {
  run<T>(
    task: (
      signal: AbortSignal,
      reporter: ExecutionProgressReporter,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface ExecutionNotificationSink {
  error(message: string): void;
}

export interface ExecutionResultViewer {
  show(result: ExecutionResult, assertions?: TestReport): void;
}

export type ExecutionContextProvider = () => Omit<ExecutionContext, 'signal'>;
export type VariableResolutionContextProvider = (
  document: ApiDocument,
) => VariableResolutionContext;
export type AuthenticationResolutionContextProvider = (
  variables: ReadonlyMap<string, import('../models').VariableValue>,
) => Omit<AuthenticationResolutionContext, 'variables'>;

/**
 * Optional secret-free labels captured alongside a finished execution.
 * Collection name is best-effort; omit when unknown.
 */
export interface HistoryCaptureContext {
  readonly environmentName?: string;
  readonly collectionName?: string;
}

export type HistoryCaptureContextProvider = () => HistoryCaptureContext;

/**
 * Optional observer notified after assertion evaluation for a finished execute.
 * Used by VS Code Problems — never called on keystroke, only after runs.
 */
export interface AssertionEvaluationObserver {
  onEvaluated(input: {
    readonly sourceId: string;
    readonly report: TestReport | undefined;
  }): void;
}

export interface RequestExecutionPipeline {
  parse(source: RunRequestSource): ParserResult;
  select(document: ApiDocument, offset: number): SelectedRequest;
  validate(document: ApiDocument, request: RequestNode): ValidationResult;
  build(
    document: ApiDocument,
    request: RequestNode,
    validation: ValidationResult,
  ): RuntimeRequest;
}

export type RunRequestOutcome =
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'replaced'
  | 'precondition-failed';

/**
 * Options for {@link ExecutionOrchestrator.runAtSourceLocation}.
 * Collection Runner uses this port with viewer/progress/notifications suppressed.
 */
export interface RunAtSourceLocationOptions {
  /** When false, the response viewer is not opened. Default true. */
  readonly showViewer?: boolean;
  /**
   * When false, skips the progress UI wrapper and drives cancellation from
   * {@link signal} only. Default true.
   */
  readonly useProgressUi?: boolean;
  /** When false, precondition failures do not show error toasts. Default true. */
  readonly showNotifications?: boolean;
  /** Optional external cancellation (collection-run abort). */
  readonly signal?: AbortSignal;
  /**
   * Optional history labels for this attempt. When omitted, the composition
   * provider from construction is used.
   */
  readonly historyCaptureContext?: HistoryCaptureContext;
}

/** Richer single-request result used by Collection Runner. */
export interface RunAtSourceLocationResult {
  readonly outcome: RunRequestOutcome;
  /** Duration from the execution result when a network attempt occurred. */
  readonly durationMs?: number;
  readonly statusCode?: number;
  /**
   * Assertion evaluation for this attempt when execute completed and was not
   * cancelled. Absent for precondition / replaced / cancelled-before-execute.
   */
  readonly assertions?: TestReport;
  /**
   * True when assertions were evaluated and at least one failed or was
   * malformed. HTTP 4xx/5xx alone does not set this — only assertion outcomes.
   */
  readonly assertionFailed?: boolean;
}

const DEFAULT_PIPELINE: RequestExecutionPipeline = Object.freeze({
  parse: (source: RunRequestSource) =>
    parseApiDocument(source.text, { sourceId: source.sourceId }),
  select: selectRequestAtOffset,
  validate: validateApiRequest,
  build: buildSelectedRequest,
});
const DEFAULT_AUTHENTICATION_RESOLVER = new DefaultAuthenticationResolver(
  new AuthenticationProviderRegistry([
    new NoneAuthenticationProvider(),
    new BasicAuthenticationProvider(),
    new BearerAuthenticationProvider(),
    new ApiKeyAuthenticationProvider(),
  ]),
);
const EMPTY_SECRETS = Object.freeze({
  get: (): Promise<undefined> => Promise.resolve(undefined),
  store: (): Promise<void> => Promise.resolve(),
  delete: (): Promise<void> => Promise.resolve(),
});

/**
 * Owns the complete single-request workflow and its replacement concurrency
 * policy. A newer run aborts the active run; stale runs cannot update UI.
 */
export class ExecutionOrchestrator {
  private nextRunId = 0;
  private active:
    | { readonly id: number; readonly controller: AbortController }
    | undefined;
  private disposed = false;

  public constructor(
    private readonly executor: RequestExecutor,
    private readonly viewer: ExecutionResultViewer,
    private readonly status: ExecutionStatusPresenter,
    private readonly progress: ExecutionProgressRunner,
    private readonly notifications: ExecutionNotificationSink,
    private readonly getExecutionContext: ExecutionContextProvider = () => ({}),
    private readonly pipeline: RequestExecutionPipeline = DEFAULT_PIPELINE,
    private readonly variableResolver: VariableResolver = new DefaultVariableResolver(),
    private readonly getVariableContext: VariableResolutionContextProvider = () => ({
      definitions: [],
    }),
    private readonly authenticationResolver: AuthenticationResolver =
      DEFAULT_AUTHENTICATION_RESOLVER,
    private readonly getAuthenticationContext:
      AuthenticationResolutionContextProvider = () => ({
        profiles: [],
        secrets: EMPTY_SECRETS,
      }),
    /**
     * Optional history recorder. When omitted, runs are not persisted.
     * Capture policy: only network-attempted (and cancelled-at-transport)
     * results are recorded. Precondition failures before `execute` are skipped.
     * Capture-context labels come from the single composition-owned provider
     * wired by `extension.ts` (via `registerHistory().getCaptureContext`).
     */
    private readonly historyRecorder?: HistoryRecorder,
    private readonly getHistoryCaptureContext: HistoryCaptureContextProvider = () =>
      ({}),
    /**
     * Optional assertion Problems observer. Invoked after evaluation for the
     * current run only (not on document edits).
     */
    private readonly assertionObserver?: AssertionEvaluationObserver,
  ) {}

  public async runAtPosition(
    source: RunRequestSource,
  ): Promise<RunRequestOutcome> {
    const result = await this.runAtSourceLocation(source);
    return result.outcome;
  }

  /**
   * Executes one request at a source location. Collection Runner prefers this
   * port so it can suppress the viewer and progress UI while still recording
   * history through the normal capture path.
   */
  public async runAtSourceLocation(
    source: RunRequestSource,
    options: RunAtSourceLocationOptions = {},
  ): Promise<RunAtSourceLocationResult> {
    const showViewer = options.showViewer !== false;
    const useProgressUi = options.useProgressUi !== false;
    const showNotifications = options.showNotifications !== false;

    if (this.disposed) {
      if (showNotifications) {
        this.notifications.error('API Runner is no longer active.');
      }
      return { outcome: 'precondition-failed' };
    }

    this.active?.controller.abort('replaced');
    const run = {
      id: ++this.nextRunId,
      controller: new AbortController(),
    };
    this.active = run;
    this.historyRecorder?.beginRun(run.id);
    this.status.update({ kind: 'running' });

    const linkExternalSignal = (): (() => void) | undefined => {
      if (options.signal === undefined) {
        return undefined;
      }
      const onAbort = (): void => run.controller.abort('cancelled');
      options.signal.addEventListener('abort', onAbort, { once: true });
      if (options.signal.aborted) {
        run.controller.abort('cancelled');
      }
      return () => options.signal?.removeEventListener('abort', onAbort);
    };

    try {
      const executePipeline = async (
        progressSignal: AbortSignal,
        reporter: ExecutionProgressReporter,
      ): Promise<RunAtSourceLocationResult> => {
        const onProgressCancellation = (): void =>
          run.controller.abort('cancelled');
        progressSignal.addEventListener('abort', onProgressCancellation, {
          once: true,
        });
        if (progressSignal.aborted) {
          run.controller.abort('cancelled');
        }
        const unlinkExternal = linkExternalSignal();
        try {
          if (run.controller.signal.aborted) {
            return this.finishCancellationResult(run.id);
          }
          reporter.report('Parsing request');
          const parsed = this.pipeline.parse(source);
          const selected = this.pipeline.select(parsed.ast, source.offset);
          const syntaxErrors = parsed.diagnostics.filter(
            (diagnostic) =>
              diagnostic.severity === 'error' &&
              rangesOverlap(diagnostic.range, selected.blockRange),
          );
          if (syntaxErrors.length > 0) {
            return this.failPreconditionResult(
              run.id,
              `The selected request has a syntax error: ${syntaxErrors[0]!.message}`,
              showNotifications,
            );
          }

          reporter.report('Validating request');
          const validation = this.pipeline.validate(
            parsed.ast,
            selected.request,
          );
          const semanticError = validation.diagnostics.find(
            (diagnostic) => diagnostic.severity === 'error',
          );
          if (semanticError !== undefined) {
            return this.failPreconditionResult(
              run.id,
              `The selected request is invalid: ${semanticError.message}`,
              showNotifications,
            );
          }
          if (run.controller.signal.aborted) {
            return this.finishCancellationResult(run.id);
          }

          reporter.report('Building request');
          const request = this.pipeline.build(
            parsed.ast,
            selected.request,
            validation,
          );
          reporter.report('Resolving variables');
          const resolution = this.variableResolver.resolveRequest(
            request,
            this.getVariableContext(parsed.ast),
          );
          if (!resolution.success) {
            const names = [...new Set(resolution.errors.flatMap((error) => error.chain))]
              .join(', ');
            return this.failPreconditionResult(
              run.id,
              `The selected request has unresolved variables: ${names}.`,
              showNotifications,
            );
          }
          if (run.controller.signal.aborted) {
            return this.finishCancellationResult(run.id);
          }
          reporter.report('Resolving authentication');
          let authenticated;
          try {
            authenticated = await this.authenticationResolver.resolve(
              resolution.request,
              {
                ...this.getAuthenticationContext(resolution.values),
                variables: resolution.values,
              },
              run.controller.signal,
            );
          } catch (error) {
            if (
              error instanceof AuthenticationAbortError ||
              run.controller.signal.aborted
            ) {
              return this.finishCancellationResult(run.id);
            }
            if (error instanceof AuthenticationError) {
              return this.failPreconditionResult(
                run.id,
                error.message,
                showNotifications,
              );
            }
            throw error;
          }
          if (!this.isCurrent(run.id)) {
            return { outcome: 'replaced' };
          }
          if (run.controller.signal.aborted) {
            return this.finishCancellationResult(run.id);
          }
          reporter.report('Sending request');
          const result = await this.executor.execute(authenticated, {
            ...this.getExecutionContext(),
            signal: run.controller.signal,
          });
          if (!this.isCurrent(run.id)) {
            return { outcome: 'replaced' };
          }

          // Assertion policy: evaluate after execute for any network result
          // except CANCELLED. Includes HTTP 4xx/5xx (assertions validate the
          // response). Skipped for precondition failures (never reach here),
          // replaced/stale runs, and transport cancellation.
          const cancelledAtTransport =
            !result.success && result.error.code === 'CANCELLED';
          let assertionReport: TestReport | undefined;
          if (!cancelledAtTransport) {
            const extracted = extractAssertionsForOffset(
              parsed.ast,
              source.text,
              source.offset,
              {
                sourceId: source.sourceId,
                requestIdFor: () => authenticated.id,
              },
            );
            if (
              extracted !== undefined &&
              (extracted.suite.assertions.length > 0 ||
                extracted.malformed.length > 0)
            ) {
              assertionReport = evaluateAssertions({
                result,
                suite: extracted.suite,
                malformed: extracted.malformed,
              });
            }
          }
          const assertionFailed =
            assertionReport !== undefined &&
            hasAssertionFailures(assertionReport);

          await this.commitHistory(
            run.id,
            source,
            selected,
            authenticated,
            result,
            options.historyCaptureContext,
            assertionReport,
          );

          try {
            // Notify only for evaluated runs (not CANCELLED / replaced /
            // precondition). Undefined report clears prior Problems.
            if (!cancelledAtTransport) {
              this.assertionObserver?.onEvaluated({
                sourceId: source.sourceId,
                report: assertionReport,
              });
            }
          } catch {
            // Diagnostics must never fail the run path.
          }

          if (showViewer) {
            try {
              this.viewer.show(result, assertionReport);
            } catch {
              this.status.update({ kind: 'failed' });
              if (showNotifications) {
                this.notifications.error(
                  'The request completed, but API Runner could not open the response viewer.',
                );
              }
              return {
                outcome: 'failed',
                durationMs: result.timing.durationMs,
                ...(result.success
                  ? { statusCode: result.response.statusCode }
                  : {}),
                ...(assertionReport === undefined
                  ? {}
                  : { assertions: assertionReport, assertionFailed }),
              };
            }
          }

          if (cancelledAtTransport) {
            this.status.update({ kind: 'cancelled' });
            return {
              outcome: 'cancelled',
              durationMs: result.timing.durationMs,
            };
          }
          if (result.success && !assertionFailed) {
            this.status.update({
              kind: 'success',
              statusCode: result.response.statusCode,
            });
            return {
              outcome: 'success',
              durationMs: result.timing.durationMs,
              statusCode: result.response.statusCode,
              ...(assertionReport === undefined
                ? {}
                : { assertions: assertionReport, assertionFailed: false }),
            };
          }
          this.status.update({ kind: 'failed' });
          return {
            outcome: 'failed',
            durationMs: result.timing.durationMs,
            ...(result.success
              ? { statusCode: result.response.statusCode }
              : {}),
            ...(assertionReport === undefined
              ? {}
              : { assertions: assertionReport, assertionFailed }),
          };
        } finally {
          progressSignal.removeEventListener(
            'abort',
            onProgressCancellation,
          );
          unlinkExternal?.();
        }
      };

      if (useProgressUi) {
        return await this.progress.run(executePipeline);
      }

      const silentReporter: ExecutionProgressReporter = {
        report: () => undefined,
      };
      return await executePipeline(
        options.signal ?? new AbortController().signal,
        silentReporter,
      );
    } catch (error) {
      if (!this.isCurrent(run.id)) {
        return { outcome: 'replaced' };
      }
      if (run.controller.signal.aborted) {
        return this.finishCancellationResult(run.id);
      }
      this.status.update({ kind: 'failed' });
      if (showNotifications) {
        this.notifications.error(friendlyUnexpectedError(error));
      }
      return { outcome: 'precondition-failed' };
    } finally {
      if (this.isCurrent(run.id)) {
        this.active = undefined;
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.active?.controller.abort('disposed');
    this.active = undefined;
    this.status.dispose();
  }

  private failPreconditionResult(
    runId: number,
    message: string,
    showNotifications: boolean,
  ): RunAtSourceLocationResult {
    if (!this.isCurrent(runId)) {
      return { outcome: 'replaced' };
    }
    this.status.update({ kind: 'failed' });
    if (showNotifications) {
      this.notifications.error(message);
    }
    return { outcome: 'precondition-failed' };
  }

  private finishCancellationResult(runId: number): RunAtSourceLocationResult {
    if (!this.isCurrent(runId)) {
      return { outcome: 'replaced' };
    }
    this.status.update({ kind: 'cancelled' });
    return { outcome: 'cancelled' };
  }

  /**
   * Persists one history entry for the current run only.
   * Precondition failures never reach this path (by design — see history.md).
   */
  private async commitHistory(
    runId: number,
    source: RunRequestSource,
    selected: SelectedRequest,
    request: AuthenticatedRequest,
    result: ExecutionResult,
    historyCaptureOverride?: HistoryCaptureContext,
    assertionReport?: TestReport,
  ): Promise<void> {
    if (this.historyRecorder === undefined || !this.isCurrent(runId)) {
      return;
    }
    // Partial overrides (e.g. collectionName from Collection Runner) must merge
    // with the composition provider so environmentName is preserved.
    const context = {
      ...this.getHistoryCaptureContext(),
      ...(historyCaptureOverride ?? {}),
    };
    const start = selected.request.range.start;
    try {
      await this.historyRecorder.record({
        runId,
        result,
        request,
        ...(context.environmentName === undefined
          ? {}
          : { environmentName: context.environmentName }),
        ...(context.collectionName === undefined
          ? {}
          : { collectionName: context.collectionName }),
        source: buildHistorySourceLocation({
          uri: source.sourceId,
          offset: start.offset,
          line: start.line,
          character: start.column,
          requestId: request.id,
        }),
        ...(assertionReport === undefined
          ? {}
          : {
              assertionCounts: toAssertionHistoryCounts(
                assertionReport.summary,
              ),
            }),
      });
    } catch {
      // History must never fail the user-visible run path.
    }
  }

  private isCurrent(runId: number): boolean {
    return this.active?.id === runId;
  }
}

function friendlyUnexpectedError(error: unknown): string {
  if (error instanceof RequestSelectionError) {
    return error.message;
  }
  if (isRequestBuildError(error)) {
    return `API Runner could not build the selected request: ${error.message}`;
  }
  return 'API Runner could not prepare or execute the selected request.';
}

function isRequestBuildError(error: unknown): error is RequestBuildError {
  return (
    error instanceof Error &&
    (error.name === 'RequestBuildError' ||
      error.name === 'RequestBuilderError' ||
      error.name === 'BuilderInvariantError')
  );
}
