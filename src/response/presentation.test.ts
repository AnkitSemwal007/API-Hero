import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ExecutionErrorCode,
  ExecutionResult,
  RuntimeResponse,
} from '../execution';
import { freezeDetachedBytes } from '../shared';
import {
  MASKED_HEADER_VALUE,
  presentExecutionResult,
  RESPONSE_BINARY_PREVIEW_LIMIT,
  RESPONSE_TEXT_PREVIEW_LIMIT,
} from './presentation';

const EMPTY_BYTES = freezeDetachedBytes(new Uint8Array(0));

function success(
  overrides: Partial<RuntimeResponse> = {},
): ExecutionResult {
  const timing = Object.freeze({
    startedAt: '2026-07-19T10:00:00.000Z',
    completedAt: '2026-07-19T10:00:00.025Z',
    durationMs: 25,
  });
  const response: RuntimeResponse = Object.freeze({
    requestId: 'request-1',
    statusCode: 200,
    statusText: 'OK',
    headers: Object.freeze([]),
    body: Object.freeze({ bytes: EMPTY_BYTES, text: '' }),
    bodySizeBytes: 0,
    url: 'https://example.test/final',
    redirected: false,
    redirectCount: 0,
    timing,
    ...overrides,
  });
  return Object.freeze({
    success: true,
    requestId: 'request-1',
    request: Object.freeze({
      method: 'GET' as const,
      url: 'https://example.test/start',
    }),
    response,
    timing,
  });
}

test('presents JSON pretty and raw forms with detached metadata', () => {
  const json = Object.freeze({ ok: true, nested: Object.freeze([1, 2]) });
  const source = success({
    statusCode: 201,
    statusText: 'Created',
    headers: Object.freeze([
      Object.freeze({ name: 'Content-Type', value: 'application/json; charset=utf-16' }),
      Object.freeze({ name: 'X-Test', value: 'value' }),
    ]),
    body: Object.freeze({
      bytes: freezeDetachedBytes(new TextEncoder().encode('{"ok":true,"nested":[1,2]}')),
      text: '{"ok":true,"nested":[1,2]}',
      json,
    }),
    bodySizeBytes: 28,
    contentType: 'application/json; charset=utf-16',
    redirected: true,
    redirectCount: 1,
  });

  const model = presentExecutionResult(source);

  assert.equal(model.body?.raw, '{"ok":true,"nested":[1,2]}');
  assert.equal(model.body?.pretty, '{\n  "ok": true,\n  "nested": [\n    1,\n    2\n  ]\n}');
  assert.equal(model.body?.language, 'json');
  assert.equal(model.statistics.encoding, 'utf-16');
  assert.equal(model.statistics.headerCount, 2);
  assert.equal(model.statistics.redirectCount, 1);
  assert.equal(model.requestUrl, 'https://example.test/start');
  assert.ok((model.statistics.responseSizeBytes ?? 0) > 28);
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.body));
  assert.equal(source.success && source.response.body.text, '{"ok":true,"nested":[1,2]}');
});

test('masks sensitive headers and exposes only a cookie placeholder', () => {
  const base = success({
    headers: Object.freeze([
      { name: 'Authorization', value: 'Bearer secret' },
      { name: 'proxy-authorization', value: 'Basic secret' },
      { name: 'Cookie', value: 'session=secret' },
      { name: 'Set-Cookie', value: 'session=secret' },
      { name: 'X-Safe', value: 'visible' },
    ]),
  });
  assert.equal(base.success, true);
  const model = presentExecutionResult(base.success
    ? {
      ...base,
      request: { method: 'GET', url: 'https://user:password@example.test/start' },
      response: {
        ...base.response,
        url: 'https://token:secret@example.test/final',
      },
    }
    : base);

  assert.deepEqual(
    model.headers.map((header) => header.value),
    [
      MASKED_HEADER_VALUE,
      MASKED_HEADER_VALUE,
      MASKED_HEADER_VALUE,
      MASKED_HEADER_VALUE,
      'visible',
    ],
  );
  assert.equal(model.cookies.available, false);
  assert.equal(model.cookies.setCookieHeaderCount, 1);
  assert.equal(model.requestUrl.includes('password'), false);
  assert.equal(model.statistics.finalUrl?.includes('secret'), false);
});

test('selects text, HTML, XML, and malformed JSON source presentations', () => {
  const cases = [
    ['text/plain', 'hello', 'text'],
    ['text/html', '<script>alert(1)</script>', 'html'],
    ['application/xml', '<?xml version="1.0"?><root/>', 'xml'],
    ['application/json', '{"broken":', 'json'],
  ] as const;
  for (const [contentType, text, language] of cases) {
    const model = presentExecutionResult(success({
      contentType,
      body: Object.freeze({
        bytes: freezeDetachedBytes(new TextEncoder().encode(text)),
        text,
      }),
      bodySizeBytes: new TextEncoder().encode(text).byteLength,
    }));
    assert.equal(model.body?.language, language);
    assert.equal(model.body?.raw, text);
    assert.equal(model.body?.pretty, text);
    assert.equal(model.body?.prettyAvailable, false);
  }
});

test('sniffs safe text formats when content type is generic', () => {
  for (const [text, expected] of [
    [' {"sniffed":true}', 'json'],
    [' <!doctype html><html></html>', 'html'],
    [' <root/>', 'xml'],
  ] as const) {
    const model = presentExecutionResult(success({
      contentType: 'text/plain',
      body: Object.freeze({ bytes: EMPTY_BYTES, text }),
    }));
    assert.equal(model.body?.language, expected);
  }
});

test('truncates text and binary previews without changing source', () => {
  const largeText = 'x'.repeat(RESPONSE_TEXT_PREVIEW_LIMIT + 7);
  const textResult = success({
    contentType: 'text/plain',
    body: Object.freeze({ bytes: EMPTY_BYTES, text: largeText }),
    bodySizeBytes: largeText.length,
  });
  const textModel = presentExecutionResult(textResult);
  assert.equal(textModel.body?.raw.length, RESPONSE_TEXT_PREVIEW_LIMIT);
  assert.equal(textModel.body?.truncated, true);
  assert.equal(textResult.success && textResult.response.body.text, largeText);

  const sourceBytes = Uint8Array.from(
    { length: RESPONSE_BINARY_PREVIEW_LIMIT + 2 },
    (_, index) => index % 256,
  );
  const bytes = freezeDetachedBytes(sourceBytes);
  const binaryResult = success({
    contentType: 'application/octet-stream',
    body: Object.freeze({ bytes }),
    bodySizeBytes: bytes.byteLength,
  });
  const binaryModel = presentExecutionResult(binaryResult);
  assert.equal(binaryModel.body?.language, 'binary');
  assert.equal(binaryModel.body?.displayedUnits, RESPONSE_BINARY_PREVIEW_LIMIT);
  assert.equal(binaryModel.body?.totalUnits, bytes.byteLength);
  assert.equal(binaryModel.body?.truncated, true);
  assert.equal(
    binaryResult.success && binaryResult.response.body.bytes.byteLength,
    bytes.byteLength,
  );
});

test('defaults encoding to UTF-8 only for renderable text-like bodies', () => {
  const textLike: readonly [string, string][] = [
    ['application/json', '{"ok":true}'],
    ['text/plain', 'hello'],
    ['text/html', '<p>hi</p>'],
    ['application/xml', '<root/>'],
  ];
  for (const [contentType, text] of textLike) {
    const model = presentExecutionResult(success({
      contentType,
      body: Object.freeze({
        bytes: freezeDetachedBytes(new TextEncoder().encode(text)),
        text,
      }),
      bodySizeBytes: new TextEncoder().encode(text).byteLength,
    }));
    assert.equal(model.statistics.encoding, 'UTF-8');
  }
});

test('omits encoding for binary/unknown bodies without an explicit charset', () => {
  const bytes = freezeDetachedBytes(Uint8Array.from([0, 1, 2, 255]));
  for (const contentType of [
    'application/octet-stream',
    'image/png',
    undefined,
  ]) {
    const model = presentExecutionResult(success({
      ...(contentType === undefined ? {} : { contentType }),
      body: Object.freeze({ bytes }),
      bodySizeBytes: bytes.byteLength,
    }));
    assert.equal(model.body?.language, 'binary');
    assert.equal(model.statistics.encoding, undefined);
  }
});

test('preserves an explicit charset for both text and binary content types', () => {
  const textModel = presentExecutionResult(success({
    contentType: 'text/plain; charset=iso-8859-1',
    body: Object.freeze({ bytes: EMPTY_BYTES, text: 'hi' }),
  }));
  assert.equal(textModel.statistics.encoding, 'iso-8859-1');

  const binaryModel = presentExecutionResult(success({
    contentType: 'application/octet-stream; charset=utf-16',
    body: Object.freeze({
      bytes: freezeDetachedBytes(Uint8Array.from([0, 1])),
    }),
    bodySizeBytes: 2,
  }));
  assert.equal(binaryModel.statistics.encoding, 'utf-16');
});

test('presents every structured execution failure', async (t) => {
  const codes: readonly ExecutionErrorCode[] = [
    'MALFORMED_URL',
    'UNSUPPORTED_BODY',
    'TIMEOUT',
    'CANCELLED',
    'DNS',
    'SSL_TLS',
    'CONNECTION_REFUSED',
    'NETWORK',
    'REDIRECT',
    'RESPONSE_TOO_LARGE',
    'UNEXPECTED',
  ];
  for (const code of codes) {
    await t.test(code, () => {
      const result: ExecutionResult = Object.freeze({
        success: false,
        requestId: 'request-1',
        request: Object.freeze({ method: 'POST', url: 'https://example.test' }),
        timing: Object.freeze({
          startedAt: '2026-07-19T10:00:00.000Z',
          completedAt: '2026-07-19T10:00:01.000Z',
          durationMs: 1_000,
        }),
        error: Object.freeze({
          code,
          message: '<failure & detail>',
          retryable: code === 'TIMEOUT',
          cause: Object.freeze({ name: 'Cause', code: 'E_TEST', message: 'detail' }),
        }),
      });
      const model = presentExecutionResult(result);
      assert.equal(model.success, false);
      assert.equal(model.failure?.code, code);
      assert.equal(model.failure?.message, '<failure & detail>');
      assert.equal(model.method, 'POST');
      assert.ok(Object.isFrozen(model.failure?.cause));
    });
  }
});

test('masks Bearer tokens in passed assertion text for the viewer model', () => {
  const model = presentExecutionResult(success({
    headers: Object.freeze([
      Object.freeze({ name: 'Authorization', value: 'Bearer live-token-value' }),
    ]),
  }), {
    suite: { assertions: [], requestId: 'request-1' },
    results: [
      {
        outcome: 'passed',
        durationMs: 0,
        assertion: {
          id: 'a1',
          text: 'expect header Authorization == "Bearer live-token-value"',
          subject: { kind: 'header', headerName: 'Authorization' },
          operator: '==',
          expected: 'Bearer live-token-value',
        },
      },
      {
        outcome: 'skipped',
        durationMs: 0,
        assertion: {
          id: 'a2',
          text: 'expect header Authorization contains "Bearer skip-secret"',
          subject: { kind: 'header', headerName: 'Authorization' },
          operator: 'contains',
          expected: 'Bearer skip-secret',
        },
        failure: {
          assertionText: 'expect header Authorization contains "Bearer skip-secret"',
          reason: 'Assertion evaluation skipped for this run.',
        },
      },
    ],
    summary: {
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      malformed: 0,
      durationMs: 0,
      passPercent: 50,
    },
    context: {
      requestId: 'request-1',
      success: true,
      headers: [],
      responseTimeMs: 25,
    },
  });

  assert.ok(model.assertions);
  assert.equal(model.assertions.assertions[0]?.outcome, 'passed');
  assert.doesNotMatch(
    model.assertions.assertions[0]?.text ?? '',
    /live-token-value/u,
  );
  assert.doesNotMatch(
    model.assertions.assertions[0]?.text ?? '',
    /Bearer\s+live-token-value/iu,
  );
  assert.match(model.assertions.assertions[0]?.text ?? '', /Authorization/u);
  assert.equal(model.assertions.assertions[1]?.outcome, 'skipped');
  assert.doesNotMatch(
    model.assertions.assertions[1]?.text ?? '',
    /skip-secret/u,
  );
  assert.doesNotMatch(
    model.assertions.assertions[1]?.failure?.assertionText ?? '',
    /skip-secret/u,
  );
  assert.doesNotMatch(JSON.stringify(model.assertions), /live-token-value/u);
  assert.doesNotMatch(JSON.stringify(model.assertions), /skip-secret/u);
});
