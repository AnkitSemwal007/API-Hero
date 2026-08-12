/**
 * Collection run options: retry + skip-destructive controls.
 * Validated options freeze onto {@link RunPlan} as first-class fields.
 */

/** Cap for `maxRetries` (retries after the initial attempt). */
export const COLLECTION_RETRY_MAX_RETRIES_CAP = 10;

/** Cap for retry delay in milliseconds. */
export const COLLECTION_RETRY_MAX_DELAY_MS_CAP = 60_000;

/** Default max retries when retry is enabled and the value is omitted. */
export const COLLECTION_RETRY_DEFAULT_MAX_RETRIES = 2;

/** Default base delay (ms) when retry is enabled and the value is omitted. */
export const COLLECTION_RETRY_DEFAULT_DELAY_MS = 500;

/** Default backoff when retry is enabled and the value is omitted. */
export const COLLECTION_RETRY_DEFAULT_BACKOFF = 'exponential' as const;

/** Skip reason when DELETE is blocked by skip-destructive. */
export const DESTRUCTIVE_REQUEST_SKIP_REASON =
  'Destructive requests are disabled for this run.';

export type CollectionRetryBackoff = 'fixed' | 'exponential';

/** Retry controls for one collection run. */
export interface CollectionRetryOptions {
  readonly enabled: boolean;
  /**
   * Max retries AFTER the initial attempt.
   * Total attempts = {@link maxRetries} + 1 when enabled.
   */
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly backoff: CollectionRetryBackoff;
}

/** First-class run options frozen onto {@link RunPlan}. */
export interface CollectionRunOptions {
  readonly retry: CollectionRetryOptions;
  readonly skipDestructiveRequests: boolean;
}

/** Partial / host input before normalization. */
export interface CollectionRunOptionsInput {
  readonly retry?: Partial<CollectionRetryOptions> | CollectionRetryOptions;
  readonly skipDestructiveRequests?: boolean;
}

export type CollectionRunOptionsValidationResult =
  | { readonly ok: true; readonly options: CollectionRunOptions }
  | { readonly ok: false; readonly message: string };

const DISABLED_RETRY: CollectionRetryOptions = Object.freeze({
  enabled: false,
  maxRetries: COLLECTION_RETRY_DEFAULT_MAX_RETRIES,
  delayMs: COLLECTION_RETRY_DEFAULT_DELAY_MS,
  backoff: COLLECTION_RETRY_DEFAULT_BACKOFF,
});

const DEFAULT_RUN_OPTIONS: CollectionRunOptions = Object.freeze({
  retry: DISABLED_RETRY,
  skipDestructiveRequests: false,
});

/**
 * Safe defaults when options are omitted — identical to historical behavior
 * (no retries, no destructive skip).
 */
export function defaultCollectionRunOptions(): CollectionRunOptions {
  return DEFAULT_RUN_OPTIONS;
}

/**
 * Normalizes optional run options: clamps caps, applies defaults, freezes.
 * Invalid types fall back to defaults rather than throwing.
 */
export function normalizeCollectionRunOptions(
  input?: CollectionRunOptionsInput | CollectionRunOptions,
): CollectionRunOptions {
  if (input === undefined) {
    return DEFAULT_RUN_OPTIONS;
  }

  const skipDestructiveRequests =
    input.skipDestructiveRequests === true;

  const retryInput = input.retry;
  if (retryInput === undefined) {
    return Object.freeze({
      retry: DISABLED_RETRY,
      skipDestructiveRequests,
    });
  }

  const enabled = retryInput.enabled === true;
  const maxRetries = clampInt(
    retryInput.maxRetries,
    COLLECTION_RETRY_DEFAULT_MAX_RETRIES,
    0,
    COLLECTION_RETRY_MAX_RETRIES_CAP,
  );
  const delayMs = clampInt(
    retryInput.delayMs,
    COLLECTION_RETRY_DEFAULT_DELAY_MS,
    0,
    COLLECTION_RETRY_MAX_DELAY_MS_CAP,
  );
  const backoff =
    retryInput.backoff === 'fixed' || retryInput.backoff === 'exponential'
      ? retryInput.backoff
      : COLLECTION_RETRY_DEFAULT_BACKOFF;

  return Object.freeze({
    retry: Object.freeze({
      enabled,
      maxRetries,
      delayMs,
      backoff,
    }),
    skipDestructiveRequests,
  });
}

/**
 * Strict validation for MCP / host inputs. Rejects negatives and unknown
 * backoff; clamps values above caps.
 */
export function validateCollectionRunOptions(
  input: unknown,
): CollectionRunOptionsValidationResult {
  if (input === undefined || input === null) {
    return { ok: true, options: DEFAULT_RUN_OPTIONS };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      message: 'runOptions must be an object when provided.',
    };
  }

  const record = input as Record<string, unknown>;
  if (
    record.skipDestructiveRequests !== undefined &&
    typeof record.skipDestructiveRequests !== 'boolean'
  ) {
    return {
      ok: false,
      message: 'skipDestructiveRequests must be a boolean when provided.',
    };
  }

  let retryPartial: Partial<CollectionRetryOptions> | undefined;
  if (record.retry !== undefined) {
    if (
      typeof record.retry !== 'object' ||
      record.retry === null ||
      Array.isArray(record.retry)
    ) {
      return { ok: false, message: 'retry must be an object when provided.' };
    }
    const retry = record.retry as Record<string, unknown>;
    if (retry.enabled !== undefined && typeof retry.enabled !== 'boolean') {
      return { ok: false, message: 'retry.enabled must be a boolean.' };
    }
    if (retry.maxRetries !== undefined) {
      if (
        typeof retry.maxRetries !== 'number' ||
        !Number.isSafeInteger(retry.maxRetries) ||
        retry.maxRetries < 0
      ) {
        return {
          ok: false,
          message: `retry.maxRetries must be a non-negative integer (≤ ${COLLECTION_RETRY_MAX_RETRIES_CAP}).`,
        };
      }
    }
    if (retry.delayMs !== undefined) {
      if (
        typeof retry.delayMs !== 'number' ||
        !Number.isSafeInteger(retry.delayMs) ||
        retry.delayMs < 0
      ) {
        return {
          ok: false,
          message: `retry.delayMs must be a non-negative integer (≤ ${COLLECTION_RETRY_MAX_DELAY_MS_CAP}).`,
        };
      }
    }
    if (
      retry.backoff !== undefined &&
      retry.backoff !== 'fixed' &&
      retry.backoff !== 'exponential'
    ) {
      return {
        ok: false,
        message: 'retry.backoff must be "fixed" or "exponential".',
      };
    }
    retryPartial = {
      ...(retry.enabled === undefined ? {} : { enabled: retry.enabled }),
      ...(retry.maxRetries === undefined
        ? {}
        : {
            maxRetries: Math.min(
              retry.maxRetries,
              COLLECTION_RETRY_MAX_RETRIES_CAP,
            ),
          }),
      ...(retry.delayMs === undefined
        ? {}
        : {
            delayMs: Math.min(
              retry.delayMs,
              COLLECTION_RETRY_MAX_DELAY_MS_CAP,
            ),
          }),
      ...(retry.backoff === undefined
        ? {}
        : { backoff: retry.backoff as CollectionRetryBackoff }),
    };
  }

  return {
    ok: true,
    options: normalizeCollectionRunOptions({
      ...(retryPartial === undefined ? {} : { retry: retryPartial }),
      ...(record.skipDestructiveRequests === undefined
        ? {}
        : {
            skipDestructiveRequests: record.skipDestructiveRequests as boolean,
          }),
    }),
  };
}

/** True when the HTTP method is treated as destructive (DELETE only for now). */
export function isDestructiveHttpMethod(method: string): boolean {
  return method.trim().toUpperCase() === 'DELETE';
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    return fallback;
  }
  return Math.min(value, max);
}
