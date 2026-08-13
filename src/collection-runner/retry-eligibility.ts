/**
 * Centralized retry classification for collection runs.
 * Pure helpers — no VS Code / orchestrator imports beyond result models.
 */

import {
  RequestFailureCategory,
  RequestRunOutcomeKind,
  type RequestRunResult,
} from './models';
import {
  COLLECTION_RETRY_MAX_DELAY_MS_CAP,
  type CollectionRetryBackoff,
} from './run-options';

/** HTTP status codes eligible for collection-run retry. */
export const COLLECTION_RETRYABLE_STATUS_CODES: ReadonlySet<number> =
  new Set([408, 429, 502, 503, 504]);

/**
 * HTTP client / semantic errors that must never be retried when a status
 * code is present (even if the failure category is transport).
 */
export const COLLECTION_NON_RETRYABLE_STATUS_CODES: ReadonlySet<number> =
  new Set([400, 401, 403, 404, 409, 422]);

/**
 * Slim attempt view used by the orchestrator side-effect callback and by
 * {@link isCollectionRetryEligible} when mapping from a completed result.
 */
export interface CollectionRetryAttemptView {
  readonly outcome: RequestRunOutcomeKind;
  readonly statusCode?: number;
  /**
   * True when assertions were evaluated (totals present / report existed).
   * Prefer {@link assertionsTotal} when mapping from {@link RequestRunResult}.
   */
  readonly assertionsEvaluated: boolean;
  /** True when evaluated assertions had at least one failure/malformed. */
  readonly assertionFailed: boolean;
  readonly failureCategory?: RequestFailureCategory;
  /**
   * When transport failed without a status code, mirrors
   * `presentation.failure.retryable` when known.
   */
  readonly presentationRetryable?: boolean;
}

/**
 * Assertions blocked retry only when they were evaluated and none failed.
 * Missing / zero totals do **not** count as "passed successfully".
 */
export function assertionsPassedSuccessfully(
  result: Pick<
    RequestRunResult,
    'assertionsTotal' | 'assertionsFailed'
  >,
): boolean {
  const total = result.assertionsTotal;
  if (total === undefined || total <= 0) {
    return false;
  }
  return (result.assertionsFailed ?? 0) === 0;
}

/**
 * Whether the mapped request result may be retried under collection run
 * options. Dependency skips and cancelled outcomes are never eligible.
 *
 * Retryable HTTP statuses (`408` / `429` / `502` / `503` / `504`) are eligible
 * even when the orchestrator outcome is {@link RequestRunOutcomeKind.Passed},
 * unless assertions were evaluated and all passed. The same statuses remain
 * eligible when the failure category is {@link RequestFailureCategory.Protocol}
 * (GraphQL uses HTTP transport; a 503 is not fundamentally non-retryable).
 * Protocol failures without a retryable status (HTTP 200 + GraphQL `errors`,
 * HTTP 500, invalid envelope) stay non-retryable.
 *
 * WebSocket attempts have no HTTP status. Connect / DNS / timeout stay
 * retryable through `presentation.failure.retryable` (a new bounded session).
 * Send and receive failures set retryable false so a half-open session is
 * not retried as if it were an HTTP GET.
 */
export function isCollectionRetryEligible(result: RequestRunResult): boolean {
  return isCollectionRetryEligibleFromAttempt(toAttemptView(result));
}

/** Alias matching the product decision name used by the collection runner. */
export function shouldRetryCollectionAttempt(
  result: RequestRunResult,
): boolean {
  return isCollectionRetryEligible(result);
}

/**
 * Eligibility from a slim attempt view (orchestrator side-effect callback /
 * unit tests). Same rules as {@link isCollectionRetryEligible}.
 *
 * Design note (2.8.4): {@link isCollectionRetryEligible} and
 * {@link isCollectionRetryEligibleFromSideEffectContext} both funnel through
 * this helper. Side-effect context maps HTTP/assertion facts onto the same
 * attempt shape that {@link toAttemptView} builds from a completed
 * {@link RequestRunResult}, so real orchestrator outcomes (success+503,
 * failed transport, assertion+503, assertion+400) cannot disagree. Keep both
 * entry points if facts arrive before vs after result mapping — do not fork
 * the rule tables.
 */
export function isCollectionRetryEligibleFromAttempt(
  attempt: CollectionRetryAttemptView,
): boolean {
  if (
    attempt.outcome === RequestRunOutcomeKind.Cancelled ||
    attempt.outcome === RequestRunOutcomeKind.Skipped
  ) {
    return false;
  }

  if (attempt.outcome === RequestRunOutcomeKind.Failed) {
    const category = attempt.failureCategory;
    if (
      category === RequestFailureCategory.Precondition ||
      category === RequestFailureCategory.Unread ||
      category === RequestFailureCategory.Extraction ||
      category === RequestFailureCategory.Cancelled
    ) {
      return false;
    }
  }

  const statusCode = attempt.statusCode;
  if (statusCode !== undefined) {
    if (COLLECTION_NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
      return false;
    }
    if (COLLECTION_RETRYABLE_STATUS_CODES.has(statusCode)) {
      if (
        attempt.assertionsEvaluated &&
        !attempt.assertionFailed
      ) {
        return false;
      }
      return true;
    }
  }

  if (attempt.outcome !== RequestRunOutcomeKind.Failed) {
    return false;
  }

  const category = attempt.failureCategory;
  if (category === RequestFailureCategory.Assertion) {
    return false;
  }
  if (category === RequestFailureCategory.Protocol) {
    return false;
  }
  if (category === RequestFailureCategory.Transport) {
    return isTransportRetryable(attempt);
  }
  if (category === undefined) {
    return false;
  }
  return false;
}

/**
 * Delay before the next attempt.
 * @param attemptIndex — 1-based retry number about to wait for (after the
 *   first failure, before attempt 2, pass `1`).
 */
export function computeRetryDelayMs(
  attemptIndex: number,
  delayMs: number,
  backoff: CollectionRetryBackoff,
): number {
  if (delayMs <= 0 || attemptIndex < 1) {
    return 0;
  }
  const raw =
    backoff === 'fixed'
      ? delayMs
      : delayMs * 2 ** (attemptIndex - 1);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(Math.floor(raw), COLLECTION_RETRY_MAX_DELAY_MS_CAP);
}

/**
 * Cancellable delay used between retry attempts.
 * Resolves normally when the timer fires; rejects with an `AbortError` when
 * `signal` aborts (or is already aborted).
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    return Promise.resolve();
  }
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function toAttemptView(result: RequestRunResult): CollectionRetryAttemptView {
  const assertionsTotal = result.assertionsTotal;
  return {
    outcome: result.outcome,
    ...(result.statusCode === undefined
      ? {}
      : { statusCode: result.statusCode }),
    assertionsEvaluated:
      assertionsTotal !== undefined && assertionsTotal > 0,
    assertionFailed: (result.assertionsFailed ?? 0) > 0,
    ...(result.failureDiagnostics?.category === undefined
      ? {}
      : { failureCategory: result.failureDiagnostics.category }),
    ...(result.presentation?.failure?.retryable === undefined
      ? {}
      : { presentationRetryable: result.presentation.failure.retryable }),
  };
}

function isTransportRetryable(attempt: CollectionRetryAttemptView): boolean {
  const statusCode = attempt.statusCode;
  if (statusCode !== undefined) {
    if (COLLECTION_NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
      return false;
    }
    return COLLECTION_RETRYABLE_STATUS_CODES.has(statusCode);
  }

  if (attempt.presentationRetryable !== undefined) {
    return attempt.presentationRetryable;
  }

  // Transport without a status code is typically a network / timeout failure.
  return true;
}

/**
 * Eligibility from orchestrator {@link SideEffectCommitContext}-shaped facts
 * (before {@link RequestRunResult} mapping). Keeps the commit decision in the
 * collection layer without importing orchestration types here.
 */
export function isCollectionRetryEligibleFromSideEffectContext(ctx: {
  readonly statusCode?: number;
  readonly httpSuccess: boolean;
  readonly assertionsEvaluated: boolean;
  readonly assertionFailed: boolean;
  readonly graphqlFailed?: boolean;
  readonly cancelledAtTransport: boolean;
  readonly transportRetryable?: boolean;
}): boolean {
  if (ctx.cancelledAtTransport) {
    return false;
  }

  let outcome: RequestRunOutcomeKind;
  let failureCategory: RequestFailureCategory | undefined;
  if (!ctx.httpSuccess) {
    outcome = RequestRunOutcomeKind.Failed;
    failureCategory = RequestFailureCategory.Transport;
  } else if (ctx.assertionFailed) {
    outcome = RequestRunOutcomeKind.Failed;
    failureCategory = RequestFailureCategory.Assertion;
  } else if (ctx.graphqlFailed === true) {
    outcome = RequestRunOutcomeKind.Failed;
    failureCategory = RequestFailureCategory.Protocol;
  } else {
    outcome = RequestRunOutcomeKind.Passed;
  }

  return isCollectionRetryEligibleFromAttempt({
    outcome,
    ...(ctx.statusCode === undefined ? {} : { statusCode: ctx.statusCode }),
    assertionsEvaluated: ctx.assertionsEvaluated,
    assertionFailed: ctx.assertionFailed,
    ...(failureCategory === undefined ? {} : { failureCategory }),
    ...(ctx.transportRetryable === undefined
      ? {}
      : { presentationRetryable: ctx.transportRetryable }),
  });
}

function abortError(): Error {
  const error = new Error('cancelled');
  error.name = 'AbortError';
  return error;
}
