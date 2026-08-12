import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTION_RETRY_DEFAULT_BACKOFF,
  COLLECTION_RETRY_DEFAULT_DELAY_MS,
  COLLECTION_RETRY_DEFAULT_MAX_RETRIES,
  COLLECTION_RETRY_MAX_DELAY_MS_CAP,
  COLLECTION_RETRY_MAX_RETRIES_CAP,
  defaultCollectionRunOptions,
  isDestructiveHttpMethod,
  normalizeCollectionRunOptions,
  validateCollectionRunOptions,
} from './run-options';

test('normalizeCollectionRunOptions defaults match historical behavior', () => {
  const defaults = defaultCollectionRunOptions();
  assert.equal(defaults.retry.enabled, false);
  assert.equal(defaults.skipDestructiveRequests, false);
  assert.deepEqual(normalizeCollectionRunOptions(undefined), defaults);
  assert.deepEqual(normalizeCollectionRunOptions({}), defaults);
});

test('normalizeCollectionRunOptions clamps caps and enables retry', () => {
  const options = normalizeCollectionRunOptions({
    retry: {
      enabled: true,
      maxRetries: 99,
      delayMs: 120_000,
      backoff: 'fixed',
    },
    skipDestructiveRequests: true,
  });
  assert.equal(options.retry.enabled, true);
  assert.equal(options.retry.maxRetries, COLLECTION_RETRY_MAX_RETRIES_CAP);
  assert.equal(options.retry.delayMs, COLLECTION_RETRY_MAX_DELAY_MS_CAP);
  assert.equal(options.retry.backoff, 'fixed');
  assert.equal(options.skipDestructiveRequests, true);
});

test('normalizeCollectionRunOptions uses documented defaults when enabled fields omitted', () => {
  const options = normalizeCollectionRunOptions({
    retry: { enabled: true },
  });
  assert.equal(options.retry.maxRetries, COLLECTION_RETRY_DEFAULT_MAX_RETRIES);
  assert.equal(options.retry.delayMs, COLLECTION_RETRY_DEFAULT_DELAY_MS);
  assert.equal(options.retry.backoff, COLLECTION_RETRY_DEFAULT_BACKOFF);
});

test('validateCollectionRunOptions rejects invalid shapes', () => {
  assert.equal(validateCollectionRunOptions('x').ok, false);
  assert.equal(validateCollectionRunOptions({ retry: [] }).ok, false);
  assert.equal(
    validateCollectionRunOptions({ retry: { maxRetries: -1 } }).ok,
    false,
  );
  assert.equal(
    validateCollectionRunOptions({ retry: { delayMs: -5 } }).ok,
    false,
  );
  assert.equal(
    validateCollectionRunOptions({ retry: { backoff: 'linear' } }).ok,
    false,
  );
});

test('validateCollectionRunOptions accepts and clamps valid input', () => {
  const result = validateCollectionRunOptions({
    retry: { enabled: true, maxRetries: 20, delayMs: 90_000 },
    skipDestructiveRequests: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.options.retry.maxRetries, COLLECTION_RETRY_MAX_RETRIES_CAP);
  assert.equal(result.options.retry.delayMs, COLLECTION_RETRY_MAX_DELAY_MS_CAP);
  assert.equal(result.options.skipDestructiveRequests, true);
});

test('isDestructiveHttpMethod is DELETE-only', () => {
  assert.equal(isDestructiveHttpMethod('DELETE'), true);
  assert.equal(isDestructiveHttpMethod('delete'), true);
  assert.equal(isDestructiveHttpMethod(' POST '), false);
  assert.equal(isDestructiveHttpMethod('PUT'), false);
  assert.equal(isDestructiveHttpMethod('PATCH'), false);
  assert.equal(isDestructiveHttpMethod('GET'), false);
});
