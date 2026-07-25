import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExecutionResult } from '../../execution';
import { freezeDetachedBytes } from '../../shared';
import type { ExtractionContext } from '../models';
import { StatusExtractor } from './status-extractor';

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

describe('StatusExtractor', () => {
  const extractor = new StatusExtractor();

  test('stringifies status code from successful response', () => {
    const result: ExecutionResult = {
      success: true,
      requestId: 'r1',
      response: {
        requestId: 'r1',
        statusCode: 201,
        statusText: 'Created',
        headers: [],
        body: { bytes: freezeDetachedBytes(new Uint8Array(0)) },
        bodySizeBytes: 0,
        url: 'https://example.test/',
        redirected: false,
        redirectCount: 0,
        timing: TIMING,
      },
      timing: TIMING,
    };
    const found = extractor.extract(
      { kind: 'status' },
      { result, requestKey: 'request:test#0' },
    );
    assert.deepEqual(found, { found: true, value: '201' });
  });

  test('failed result has no status', () => {
    const context: ExtractionContext = {
      result: {
        success: false,
        requestId: 'r1',
        error: { code: 'TIMEOUT', message: 'timed out', retryable: true },
        timing: TIMING,
      },
      requestKey: 'request:test#0',
    };
    const found = extractor.extract({ kind: 'status' }, context);
    assert.equal(found.found, false);
  });
});
