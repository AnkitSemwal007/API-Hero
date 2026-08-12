import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RequestFailureCategories,
  RequestRunOutcomeKinds,
  type RequestRunResult,
} from './index';
import {
  COLLECTION_NON_RETRYABLE_STATUS_CODES,
  COLLECTION_RETRYABLE_STATUS_CODES,
  assertionsPassedSuccessfully,
  computeRetryDelayMs,
  delay,
  isCollectionRetryEligible,
  isCollectionRetryEligibleFromSideEffectContext,
} from './retry-eligibility';
import { COLLECTION_RETRY_MAX_DELAY_MS_CAP } from './run-options';

function result(
  overrides: Partial<RequestRunResult> &
    Pick<RequestRunResult, 'outcome'>,
): RequestRunResult {
  return {
    requestId: 'r1',
    ordinal: 0,
    label: 'r1',
    ...overrides,
  };
}

test('retryable HTTP status codes on Failed+Transport', () => {
  for (const statusCode of COLLECTION_RETRYABLE_STATUS_CODES) {
    assert.equal(
      isCollectionRetryEligible(
        result({
          outcome: RequestRunOutcomeKinds.Failed,
          statusCode,
          failureDiagnostics: {
            category: RequestFailureCategories.Transport,
            reason: `HTTP ${statusCode}`,
            httpRequestSent: true,
          },
        }),
      ),
      true,
      `expected ${statusCode} retryable`,
    );
  }
});

test('Passed + retryable status without assertions is retryable', () => {
  for (const statusCode of COLLECTION_RETRYABLE_STATUS_CODES) {
    assert.equal(
      isCollectionRetryEligible(
        result({
          outcome: RequestRunOutcomeKinds.Passed,
          statusCode,
        }),
      ),
      true,
      `expected Passed+${statusCode} retryable`,
    );
  }
});

test('Passed + retryable status with assertions all passed is not retryable', () => {
  assert.equal(
    assertionsPassedSuccessfully({
      assertionsTotal: 1,
      assertionsFailed: 0,
    }),
    true,
  );
  assert.equal(
    assertionsPassedSuccessfully({
      assertionsTotal: 0,
      assertionsFailed: 0,
    }),
    false,
  );
  assert.equal(
    assertionsPassedSuccessfully({}),
    false,
  );

  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Passed,
        statusCode: 503,
        assertionsPassed: 1,
        assertionsFailed: 0,
        assertionsTotal: 1,
      }),
    ),
    false,
  );
});

test('Failed + Assertion + retryable status is retryable', () => {
  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Failed,
        statusCode: 503,
        assertionsPassed: 0,
        assertionsFailed: 1,
        assertionsTotal: 1,
        failureDiagnostics: {
          category: RequestFailureCategories.Assertion,
          reason: 'expect status == 200',
          httpRequestSent: true,
        },
      }),
    ),
    true,
  );
});

test('non-retryable HTTP status codes', () => {
  for (const statusCode of COLLECTION_NON_RETRYABLE_STATUS_CODES) {
    assert.equal(
      isCollectionRetryEligible(
        result({
          outcome: RequestRunOutcomeKinds.Failed,
          statusCode,
          failureDiagnostics: {
            category: RequestFailureCategories.Transport,
            reason: `HTTP ${statusCode}`,
            httpRequestSent: true,
          },
        }),
      ),
      false,
      `expected ${statusCode} not retryable`,
    );
  }
});

test('Failed + Assertion + non-retryable status is not retryable', () => {
  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Failed,
        statusCode: 400,
        assertionsPassed: 0,
        assertionsFailed: 1,
        assertionsTotal: 1,
        failureDiagnostics: {
          category: RequestFailureCategories.Assertion,
          reason: 'failed',
          httpRequestSent: true,
        },
      }),
    ),
    false,
  );
});

test('transport without status uses presentation.retryable when present', () => {
  const basePresentation = {
    success: false,
    requestId: 'r1',
    method: 'GET',
    requestUrl: 'https://example.test',
    headers: [],
    cookies: { available: false as const, setCookieHeaderCount: 0 },
    statistics: {
      durationMs: 1,
      startedAt: '2020-01-01T00:00:00.000Z',
      completedAt: '2020-01-01T00:00:00.001Z',
      headerCount: 0,
      redirected: false,
      redirectCount: 0,
    },
    summary: 'failed',
  };

  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Failed,
        failureDiagnostics: {
          category: RequestFailureCategories.Transport,
          reason: 'timeout',
          httpRequestSent: false,
        },
        presentation: {
          ...basePresentation,
          failure: {
            title: 'Timeout',
            message: 'timed out',
            retryable: true,
            code: 'TIMEOUT',
          },
        },
      }),
    ),
    true,
  );
  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Failed,
        failureDiagnostics: {
          category: RequestFailureCategories.Transport,
          reason: 'ssl',
          httpRequestSent: false,
        },
        presentation: {
          ...basePresentation,
          failure: {
            title: 'TLS',
            message: 'bad cert',
            retryable: false,
            code: 'SSL_TLS',
          },
        },
      }),
    ),
    false,
  );
});

test('transport without status defaults to retryable', () => {
  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Failed,
        failureDiagnostics: {
          category: RequestFailureCategories.Transport,
          reason: 'network',
          httpRequestSent: false,
        },
      }),
    ),
    true,
  );
});

test('precondition / extraction / unread / cancelled are not retryable', () => {
  const categories = [
    RequestFailureCategories.Precondition,
    RequestFailureCategories.Extraction,
    RequestFailureCategories.Unread,
    RequestFailureCategories.Cancelled,
  ] as const;
  for (const category of categories) {
    assert.equal(
      isCollectionRetryEligible(
        result({
          outcome: RequestRunOutcomeKinds.Failed,
          statusCode: 503,
          failureDiagnostics: {
            category,
            reason: category,
            httpRequestSent: false,
          },
        }),
      ),
      false,
      category,
    );
  }
});

test('Passed without retryable status / skipped / cancelled are not retryable', () => {
  assert.equal(
    isCollectionRetryEligible(
      result({ outcome: RequestRunOutcomeKinds.Passed, statusCode: 200 }),
    ),
    false,
  );
  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Skipped,
        skipReason: 'dep',
      }),
    ),
    false,
  );
  assert.equal(
    isCollectionRetryEligible(
      result({
        outcome: RequestRunOutcomeKinds.Cancelled,
        failureDiagnostics: {
          category: RequestFailureCategories.Cancelled,
          reason: 'cancelled',
          httpRequestSent: false,
        },
      }),
    ),
    false,
  );
});

test('side-effect context mirrors result eligibility for success+503', () => {
  assert.equal(
    isCollectionRetryEligibleFromSideEffectContext({
      statusCode: 503,
      httpSuccess: true,
      assertionsEvaluated: false,
      assertionFailed: false,
      cancelledAtTransport: false,
    }),
    true,
  );
  assert.equal(
    isCollectionRetryEligibleFromSideEffectContext({
      statusCode: 503,
      httpSuccess: true,
      assertionsEvaluated: true,
      assertionFailed: false,
      cancelledAtTransport: false,
    }),
    false,
  );
  assert.equal(
    isCollectionRetryEligibleFromSideEffectContext({
      statusCode: 503,
      httpSuccess: true,
      assertionsEvaluated: true,
      assertionFailed: true,
      cancelledAtTransport: false,
    }),
    true,
  );
  assert.equal(
    isCollectionRetryEligibleFromSideEffectContext({
      httpSuccess: false,
      assertionsEvaluated: false,
      assertionFailed: false,
      cancelledAtTransport: false,
      transportRetryable: true,
    }),
    true,
  );
});

test('computeRetryDelayMs fixed and exponential', () => {
  assert.equal(computeRetryDelayMs(1, 500, 'fixed'), 500);
  assert.equal(computeRetryDelayMs(3, 500, 'fixed'), 500);
  assert.equal(computeRetryDelayMs(1, 500, 'exponential'), 500);
  assert.equal(computeRetryDelayMs(2, 500, 'exponential'), 1_000);
  assert.equal(computeRetryDelayMs(3, 500, 'exponential'), 2_000);
  assert.equal(
    computeRetryDelayMs(20, 10_000, 'exponential'),
    COLLECTION_RETRY_MAX_DELAY_MS_CAP,
  );
});

test('delay resolves and aborts with AbortSignal', async () => {
  await delay(0);
  const controller = new AbortController();
  const pending = delay(60_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'AbortError');
    return true;
  });
});
