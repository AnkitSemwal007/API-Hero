import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExecutionResult } from '../../execution';
import { freezeDetachedBytes } from '../../shared';
import type { ExtractionContext } from '../models';
import { HeaderExtractor } from './header-extractor';

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

function contextWithHeaders(
  headers: readonly { readonly name: string; readonly value: string }[],
): ExtractionContext {
  const result: ExecutionResult = {
    success: true,
    requestId: 'r1',
    response: {
      requestId: 'r1',
      statusCode: 200,
      statusText: 'OK',
      headers: [...headers],
      body: { bytes: freezeDetachedBytes(new Uint8Array(0)) },
      bodySizeBytes: 0,
      url: 'https://example.test/',
      redirected: false,
      redirectCount: 0,
      timing: TIMING,
    },
    timing: TIMING,
  };
  return { result, requestKey: 'request:test#0' };
}

describe('HeaderExtractor', () => {
  const extractor = new HeaderExtractor();

  test('matches header names case-insensitively', () => {
    const found = extractor.extract(
      { kind: 'header', name: 'x-request-id' },
      contextWithHeaders([{ name: 'X-Request-Id', value: 'abc-123' }]),
    );
    assert.deepEqual(found, { found: true, value: 'abc-123' });
  });

  test('joins duplicate header values with comma-space', () => {
    const found = extractor.extract(
      { kind: 'header', name: 'Set-Cookie' },
      contextWithHeaders([
        { name: 'Set-Cookie', value: 'a=1' },
        { name: 'set-cookie', value: 'b=2' },
      ]),
    );
    assert.deepEqual(found, { found: true, value: 'a=1, b=2' });
  });

  test('missing header returns not found', () => {
    const found = extractor.extract(
      { kind: 'header', name: 'X-Missing' },
      contextWithHeaders([{ name: 'Content-Type', value: 'text/plain' }]),
    );
    assert.equal(found.found, false);
  });
});
