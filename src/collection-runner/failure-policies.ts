import {
  FailurePolicyKind,
  RequestRunOutcomeKind,
  type RequestRunResult,
} from './models';

/**
 * Decides whether a sequential run stops after a request result and how
 * invalid (precondition) outcomes are classified.
 */
export interface FailurePolicy {
  readonly kind: FailurePolicyKind;
  readonly label: string;
  /** Classify an invalid / unread / precondition failure. */
  classifyInvalid():
    | typeof RequestRunOutcomeKind.Failed
    | typeof RequestRunOutcomeKind.Skipped;
  /** Whether the run should stop after this result (cancellation always stops). */
  shouldStopAfter(result: RequestRunResult): boolean;
}

function stopOnFailedOrCancelled(result: RequestRunResult): boolean {
  return (
    result.outcome === RequestRunOutcomeKind.Failed ||
    result.outcome === RequestRunOutcomeKind.Cancelled
  );
}

function stopOnCancelledOnly(result: RequestRunResult): boolean {
  return result.outcome === RequestRunOutcomeKind.Cancelled;
}

const STOP_ON_FIRST_ERROR: FailurePolicy = Object.freeze({
  kind: FailurePolicyKind.StopOnFirstError,
  label: 'Stop on First Error',
  classifyInvalid: (): typeof RequestRunOutcomeKind.Failed =>
    RequestRunOutcomeKind.Failed,
  shouldStopAfter: stopOnFailedOrCancelled,
});

const CONTINUE_ON_ERROR: FailurePolicy = Object.freeze({
  kind: FailurePolicyKind.ContinueOnError,
  label: 'Continue on Error',
  classifyInvalid: (): typeof RequestRunOutcomeKind.Failed =>
    RequestRunOutcomeKind.Failed,
  shouldStopAfter: stopOnCancelledOnly,
});

const SKIP_INVALID: FailurePolicy = Object.freeze({
  kind: FailurePolicyKind.SkipInvalidRequests,
  label: 'Skip Invalid Requests',
  classifyInvalid: (): typeof RequestRunOutcomeKind.Skipped =>
    RequestRunOutcomeKind.Skipped,
  shouldStopAfter: stopOnCancelledOnly,
});

const POLICIES: Readonly<Record<FailurePolicyKind, FailurePolicy>> = Object.freeze({
  [FailurePolicyKind.StopOnFirstError]: STOP_ON_FIRST_ERROR,
  [FailurePolicyKind.ContinueOnError]: CONTINUE_ON_ERROR,
  [FailurePolicyKind.SkipInvalidRequests]: SKIP_INVALID,
});

/** Resolves a built-in failure policy by kind. */
export function resolveFailurePolicy(kind: FailurePolicyKind): FailurePolicy {
  return POLICIES[kind];
}

/** Lists built-in failure policies for UI pickers. */
export function listFailurePolicies(): readonly FailurePolicy[] {
  return [
    STOP_ON_FIRST_ERROR,
    CONTINUE_ON_ERROR,
    SKIP_INVALID,
  ];
}
