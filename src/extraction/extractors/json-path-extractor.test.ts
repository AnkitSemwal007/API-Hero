import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExecutionResult } from '../../execution';
import { freezeDetachedBytes } from '../../shared';
import type { ExtractionContext } from '../models';
import { JsonPathExtractor } from './json-path-extractor';

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

function successContext(
  body: { readonly json?: unknown; readonly text?: string },
): ExtractionContext {
  const result: ExecutionResult = {
    success: true,
    requestId: 'r1',
    response: {
      requestId: 'r1',
      statusCode: 200,
      statusText: 'OK',
      headers: [],
      body: {
        bytes: freezeDetachedBytes(new Uint8Array(0)),
        ...(body.json === undefined ? {} : { json: body.json as never }),
        ...(body.text === undefined ? {} : { text: body.text }),
      },
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

describe('JsonPathExtractor', () => {
  const extractor = new JsonPathExtractor();

  test('resolves nested paths from body.json', () => {
    const found = extractor.extract(
      { kind: 'json-path', path: 'body.data.token' },
      successContext({ json: { data: { token: 'abc' } } }),
    );
    assert.deepEqual(found, { found: true, value: 'abc' });
  });

  test('parses body.text when json is absent', () => {
    const found = extractor.extract(
      { kind: 'json-path', path: 'body.id' },
      successContext({ text: '{"id":7}' }),
    );
    assert.deepEqual(found, { found: true, value: 7 });
  });

  test('missing path returns not found', () => {
    const found = extractor.extract(
      { kind: 'json-path', path: 'body.missing' },
      successContext({ json: { other: 1 } }),
    );
    assert.equal(found.found, false);
  });

  test('failed transport has no response body', () => {
    const context: ExtractionContext = {
      result: {
        success: false,
        requestId: 'r1',
        error: { code: 'NETWORK', message: 'down', retryable: true },
        timing: TIMING,
      },
      requestKey: 'request:test#0',
    };
    const found = extractor.extract(
      { kind: 'json-path', path: 'body.id' },
      context,
    );
    assert.equal(found.found, false);
  });
});
