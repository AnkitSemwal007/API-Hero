import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExecutionResult } from '../execution';
import { parseApiDocument } from '../parser';
import { freezeDetachedBytes } from '../shared';
import {
  AssertionOutcome,
  buildAssertionDiagnostics,
  buildAssertionSummary,
  evaluateAssertions,
  extractAssertionsForDocument,
  extractAssertionsForOffset,
  formatHeaderValueForReport,
  hasAssertionFailures,
  MASKED_ASSERTION_VALUE,
  maskAssertionText,
  parseExpectLine,
  resolveJsonPath,
  toAssertionHistoryCounts,
} from './index';

function successResult(options: {
  readonly statusCode?: number;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly body?: string;
  readonly json?: unknown;
  readonly contentType?: string;
  readonly durationMs?: number;
  readonly bodySizeBytes?: number;
  readonly url?: string;
  /** When true, leave body.json unset so the engine parses from text. */
  readonly omitParsedJson?: boolean;
}): ExecutionResult {
  const bodyText = options.body;
  const bytes = freezeDetachedBytes(
    Buffer.from(bodyText ?? (options.json === undefined ? '' : JSON.stringify(options.json))),
  );
  const contentType =
    options.contentType ??
    (options.json !== undefined || (bodyText !== undefined && bodyText.startsWith('{'))
      ? 'application/json'
      : 'text/plain');
  let parsedJson: unknown | undefined = options.json;
  if (
    !options.omitParsedJson &&
    parsedJson === undefined &&
    bodyText !== undefined &&
    contentType.includes('json')
  ) {
    try {
      parsedJson = JSON.parse(bodyText) as unknown;
    } catch {
      parsedJson = undefined;
    }
  }
  return {
    success: true,
    requestId: 'req_1',
    request: { method: 'GET', url: options.url ?? 'https://example.com/api' },
    response: {
      requestId: 'req_1',
      statusCode: options.statusCode ?? 200,
      statusText: 'OK',
      headers: options.headers ?? [
        { name: 'Content-Type', value: contentType },
      ],
      body: {
        bytes,
        ...(bodyText === undefined && options.json === undefined
          ? {}
          : {
              text:
                bodyText ??
                JSON.stringify(options.json),
            }),
        ...(parsedJson === undefined || options.omitParsedJson
          ? {}
          : { json: parsedJson as never }),
      },
      bodySizeBytes: options.bodySizeBytes ?? bytes.byteLength,
      contentType,
      url: options.url ?? 'https://example.com/api',
      redirected: false,
      redirectCount: 0,
      timing: {
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:00.120Z',
        durationMs: options.durationMs ?? 120,
      },
    },
    timing: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.120Z',
      durationMs: options.durationMs ?? 120,
    },
  };
}

function failedResult(code: 'TIMEOUT' | 'CANCELLED' | 'NETWORK' = 'NETWORK'): ExecutionResult {
  return {
    success: false,
    requestId: 'req_1',
    request: { method: 'GET', url: 'https://example.com/api' },
    error: {
      code,
      message: 'failed',
      retryable: code !== 'CANCELLED',
    },
    timing: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
    },
  };
}

describe('parseExpectLine', () => {
  test('parses status, header, body, timing, and unary operators', () => {
    const status = parseExpectLine('expect status == 200');
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.assertion.subject.kind, 'status');
      assert.equal(status.assertion.operator, '==');
      assert.equal(status.assertion.expected, 200);
    }

    const statusIn = parseExpectLine('expect status in [200,201]');
    assert.equal(statusIn.ok, true);
    if (statusIn.ok) {
      assert.equal(statusIn.assertion.operator, 'in');
      assert.deepEqual(statusIn.assertion.expected, [200, 201]);
    }

    const header = parseExpectLine('expect header Content-Type contains "json"');
    assert.equal(header.ok, true);
    if (header.ok) {
      assert.equal(header.assertion.subject.kind, 'header');
      assert.equal(header.assertion.subject.headerName, 'Content-Type');
      assert.equal(header.assertion.operator, 'contains');
      assert.equal(header.assertion.expected, 'json');
    }

    const bodyId = parseExpectLine('expect body.id exists');
    assert.equal(bodyId.ok, true);
    if (bodyId.ok) {
      assert.equal(bodyId.assertion.subject.kind, 'body');
      assert.equal(bodyId.assertion.subject.path, 'id');
      assert.equal(bodyId.assertion.operator, 'exists');
      assert.equal(bodyId.assertion.expected, undefined);
    }

    const nested = parseExpectLine('expect body.user.name == "John"');
    assert.equal(nested.ok, true);
    if (nested.ok) {
      assert.equal(nested.assertion.subject.path, 'user.name');
      assert.equal(nested.assertion.expected, 'John');
    }

    const length = parseExpectLine('expect body.items.length > 0');
    assert.equal(length.ok, true);
    if (length.ok) {
      assert.equal(length.assertion.subject.path, 'items.length');
      assert.equal(length.assertion.operator, '>');
      assert.equal(length.assertion.expected, 0);
    }

    const timing = parseExpectLine('expect responseTime < 500');
    assert.equal(timing.ok, true);
    if (timing.ok) {
      assert.equal(timing.assertion.subject.kind, 'responseTime');
      assert.equal(timing.assertion.operator, '<');
      assert.equal(timing.assertion.expected, 500);
    }

    const bool = parseExpectLine('expect body.success == true');
    assert.equal(bool.ok, true);
    if (bool.ok) {
      assert.equal(bool.assertion.expected, true);
    }

    const empty = parseExpectLine('expect body.errors isEmpty');
    assert.equal(empty.ok, true);
    if (empty.ok) {
      assert.equal(empty.assertion.operator, 'isEmpty');
    }

    const isNull = parseExpectLine('expect body.value isNull');
    assert.equal(isNull.ok, true);
    if (isNull.ok) {
      assert.equal(isNull.assertion.operator, 'isNull');
    }

    const contentType = parseExpectLine('expect content-type contains json');
    assert.equal(contentType.ok, true);
    if (contentType.ok) {
      assert.equal(contentType.assertion.subject.kind, 'contentType');
      assert.equal(contentType.assertion.expected, 'json');
    }

    const size = parseExpectLine('expect responseSize >= 10');
    assert.equal(size.ok, true);
    if (size.ok) {
      assert.equal(size.assertion.subject.kind, 'responseSize');
      assert.equal(size.assertion.operator, '>=');
      assert.equal(size.assertion.expected, 10);
    }
  });

  test('returns structured failure for malformed lines', () => {
    const missing = parseExpectLine('expect');
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.failure.malformed, true);
      assert.match(missing.failure.reason, /subject|operator|expect/i);
    }
    const badOp = parseExpectLine('expect status ~~ 200');
    assert.equal(badOp.ok, false);
  });
});

describe('buildAssertionSummary and history counts', () => {
  test('aggregates outcomes and maps secret-free history counts', () => {
    const summary = buildAssertionSummary(
      [
        { outcome: AssertionOutcome.Passed, durationMs: 1 },
        { outcome: AssertionOutcome.Failed, durationMs: 2 },
        { outcome: AssertionOutcome.Skipped, durationMs: 0 },
        { outcome: AssertionOutcome.Malformed, durationMs: 0 },
        { outcome: AssertionOutcome.Passed, durationMs: 3 },
      ],
      12,
    );
    assert.deepEqual(summary, {
      total: 5,
      passed: 2,
      failed: 1,
      skipped: 1,
      malformed: 1,
      durationMs: 12,
      passPercent: 40,
    });
    assert.deepEqual(toAssertionHistoryCounts(summary), {
      total: 5,
      passed: 2,
      failed: 1,
      skipped: 1,
      malformed: 1,
      passPercent: 40,
    });
    assert.equal(buildAssertionSummary([], 0).passPercent, 100);
  });
});

describe('buildAssertionDiagnostics', () => {
  test('maps failed and malformed results and clears empty reports', () => {
    assert.deepEqual(buildAssertionDiagnostics(undefined), { kind: 'clear' });

    const empty = evaluateAssertions({
      result: successResult({ statusCode: 200 }),
      suite: { assertions: [] },
    });
    assert.deepEqual(buildAssertionDiagnostics(empty), { kind: 'clear' });

    const report = evaluateAssertions({
      result: successResult({
        statusCode: 500,
        headers: [
          { name: 'Authorization', value: 'Bearer sekrit-token-value' },
        ],
      }),
      suite: {
        assertions: [
          {
            id: 'pass',
            text: 'expect responseTime < 5000',
            subject: { kind: 'responseTime' },
            operator: '<',
            expected: 5000,
          },
          {
            id: 'fail',
            text: 'expect status == 200',
            subject: { kind: 'status' },
            operator: '==',
            expected: 200,
            source: {
              range: {
                start: { line: 3, column: 0, offset: 10 },
                end: { line: 3, column: 20, offset: 30 },
              },
            },
          },
          {
            id: 'auth',
            text: 'expect header Authorization == "Bearer no"',
            subject: { kind: 'header', headerName: 'Authorization' },
            operator: '==',
            expected: 'Bearer no',
          },
        ],
      },
      malformed: [
        {
          assertionText: 'expect status ~~ 200',
          reason: 'Unknown assertion operator "~~".',
          malformed: true,
        },
      ],
      skip: false,
    });

    // Mark one as skipped via a dedicated report
    const skipped = evaluateAssertions({
      result: successResult({ statusCode: 200 }),
      suite: {
        assertions: [
          {
            id: 's1',
            text: 'expect status == 200',
            subject: { kind: 'status' },
            operator: '==',
            expected: 200,
          },
        ],
      },
      skip: true,
    });
    const skippedMapped = buildAssertionDiagnostics(skipped);
    assert.equal(skippedMapped.kind, 'set');
    if (skippedMapped.kind === 'set') {
      assert.equal(skippedMapped.diagnostics.length, 0);
    }

    const mapped = buildAssertionDiagnostics(report);
    assert.equal(mapped.kind, 'set');
    if (mapped.kind !== 'set') {
      throw new Error('expected diagnostics');
    }
    assert.ok(mapped.diagnostics.length >= 2);
    assert.ok(
      mapped.diagnostics.some((item) => item.code === 'assertion.failed'),
    );
    assert.ok(
      mapped.diagnostics.some((item) => item.code === 'assertion.malformed'),
    );
    assert.ok(
      !mapped.diagnostics.some((item) =>
        item.message.includes('expect responseTime'),
      ),
    );
    const joined = mapped.diagnostics.map((item) => item.message).join('\n');
    assert.doesNotMatch(joined, /sekrit-token-value/u);
    const authDiag = mapped.diagnostics.find((item) =>
      item.message.includes('Authorization'),
    );
    assert.ok(authDiag, 'expected an Authorization failure diagnostic');
    assert.match(authDiag.message, new RegExp(MASKED_ASSERTION_VALUE, 'u'));
    assert.doesNotMatch(authDiag.message, /sekrit-token-value/u);
    const statusDiag = mapped.diagnostics.find((item) =>
      item.message.includes('expect status == 200'),
    );
    assert.deepEqual(statusDiag?.range, {
      start: { line: 3, column: 0 },
      end: { line: 3, column: 20 },
    });
  });
});

describe('resolveJsonPath', () => {
  test('resolves nested paths, indexes, and length', () => {
    const root = {
      user: { name: 'John', id: 1 },
      data: { items: [{ name: 'a' }, { name: 'b' }] },
      orders: [1, 2, 3],
    };
    assert.deepEqual(resolveJsonPath(root, 'user.id'), {
      found: true,
      value: 1,
    });
    assert.deepEqual(resolveJsonPath(root, 'data.items[0].name'), {
      found: true,
      value: 'a',
    });
    assert.deepEqual(resolveJsonPath(root, 'orders.length'), {
      found: true,
      value: 3,
    });
    assert.equal(resolveJsonPath(root, 'missing.path').found, false);
  });
});

describe('extractAssertionsForDocument', () => {
  test('associates expect lines with the preceding request gap', () => {
    const source = [
      'GET /one',
      'expect status == 200',
      'expect body.ok == true',
      '###',
      'POST /two',
      'expect status in [201,202]',
      'not an expect',
      '# expect status == 500',
    ].join('\n');
    const document = parseApiDocument(source).ast;
    const extracted = extractAssertionsForDocument(document, source, {
      sourceId: 'file.api',
    });
    assert.equal(extracted.length, 2);
    assert.equal(extracted[0]!.suite.assertions.length, 2);
    assert.equal(extracted[1]!.suite.assertions.length, 1);
    assert.equal(extracted[0]!.suite.assertions[0]!.text, 'expect status == 200');
    assert.equal(
      extracted[1]!.suite.assertions[0]!.text,
      'expect status in [201,202]',
    );
  });

  test('extractAssertionsForOffset selects the owning request', () => {
    const source = ['GET /one', 'expect status == 200', '###', 'POST /two'].join(
      '\n',
    );
    const document = parseApiDocument(source).ast;
    const first = extractAssertionsForOffset(document, source, 0);
    assert.equal(first?.suite.assertions.length, 1);
    const secondOffset = document.requests[1]!.range.start.offset;
    const second = extractAssertionsForOffset(document, source, secondOffset);
    assert.equal(second?.suite.assertions.length, 0);
  });
});

describe('evaluateAssertions', () => {
  test('passes status, header, body, array, timing, size, and content-type', () => {
    const result = successResult({
      statusCode: 200,
      headers: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'X-Count', value: '3' },
      ],
      json: {
        id: 1,
        user: { name: 'John' },
        items: [1, 2],
        success: true,
        errors: [],
        flag: null,
      },
      durationMs: 80,
      bodySizeBytes: 128,
      contentType: 'application/json; charset=utf-8',
    });
    const lines = [
      'expect status == 200',
      'expect status in [200,201]',
      'expect header Content-Type contains "json"',
      'expect body.id exists',
      'expect body.user.name == "John"',
      'expect body.items.length > 0',
      'expect responseTime < 500',
      'expect body.success == true',
      'expect body.errors isEmpty',
      'expect body.flag isNull',
      'expect content-type contains json',
      'expect responseSize >= 10',
      'expect body.success != false',
      'expect header X-Count == "3"',
    ];
    const assertions = lines.map((text, index) => {
      const parsed = parseExpectLine(text);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        throw new Error('parse failed');
      }
      return { ...parsed.assertion, id: `a${index}` };
    });
    const report = evaluateAssertions({
      result,
      suite: { assertions, requestId: 'req_1' },
    });
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.malformed, 0);
    assert.equal(report.summary.passed, lines.length);
    assert.equal(hasAssertionFailures(report), false);
    assert.ok(report.summary.passPercent === 100);
  });

  test('fails missing paths gracefully', () => {
    const report = evaluateAssertions({
      result: successResult({ json: { id: 1 } }),
      suite: {
        assertions: [
          {
            id: 'a1',
            text: 'expect body.missing == 1',
            subject: { kind: 'body', path: 'missing' },
            operator: '==',
            expected: 1,
          },
        ],
      },
    });
    assert.equal(report.summary.failed, 1);
    assert.equal(report.results[0]!.failure?.reason.includes('exist') ||
      report.results[0]!.failure?.reason.includes('Property'), true);
  });

  test('records malformed expect lines without throwing', () => {
    const report = evaluateAssertions({
      result: successResult({ statusCode: 200 }),
      suite: { assertions: [] },
      malformed: [
        {
          assertionText: 'expect status ~~ 200',
          reason: 'Unknown assertion operator "~~".',
          malformed: true,
        },
      ],
    });
    assert.equal(report.summary.malformed, 1);
    assert.equal(report.results[0]!.outcome, AssertionOutcome.Malformed);
  });

  test('parses large JSON body once for many path assertions', () => {
    const items = Array.from({ length: 2000 }, (_, index) => ({
      id: index,
      name: `item-${index}`,
    }));
    const body = JSON.stringify({ items, ok: true });
    // Provide text only (no pre-parsed json) so the engine parses once.
    const result = successResult({
      body,
      contentType: 'application/json',
      omitParsedJson: true,
    });
    const assertions = Array.from({ length: 50 }, (_, index) => {
      const parsed = parseExpectLine(`expect body.items[${index}].id == ${index}`);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        throw new Error('parse failed');
      }
      return { ...parsed.assertion, id: `a${index}` };
    });
    const report = evaluateAssertions({
      result,
      suite: { assertions },
    });
    assert.equal(report.summary.passed, 50);
    assert.equal(report.context.bodyJson !== undefined, true);
  });

  test('masks secrets in failure reports and never dumps Authorization', () => {
    const report = evaluateAssertions({
      result: successResult({
        headers: [
          { name: 'Authorization', value: 'Bearer super-secret-token' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        json: { token: 'secret' },
        url: 'https://user:pass@example.com/api',
      }),
      suite: {
        assertions: [
          {
            id: 'a1',
            text: 'expect header Authorization == "Bearer no"',
            subject: { kind: 'header', headerName: 'Authorization' },
            operator: '==',
            expected: 'Bearer no',
          },
        ],
      },
    });
    const failure = report.results[0]!.failure;
    assert.ok(failure);
    assert.equal(failure.actual, MASKED_ASSERTION_VALUE);
    assert.doesNotMatch(failure.assertionText, /Bearer\s+no/iu);
    assert.match(failure.assertionText, /Authorization/u);
    assert.equal(
      formatHeaderValueForReport('Authorization', 'Bearer x'),
      MASKED_ASSERTION_VALUE,
    );
    assert.match(maskAssertionText('https://user:pass@example.com'), /example\.com/);
    assert.doesNotMatch(
      JSON.stringify(failure),
      /super-secret-token/u,
    );
    assert.doesNotMatch(JSON.stringify(failure), /Bearer no/iu);
  });

  test('skips evaluation when skip flag is set', () => {
    const report = evaluateAssertions({
      result: failedResult('CANCELLED'),
      suite: {
        assertions: [
          {
            id: 'a1',
            text: 'expect status == 200',
            subject: { kind: 'status' },
            operator: '==',
            expected: 200,
          },
        ],
      },
      skip: true,
    });
    assert.equal(report.summary.skipped, 1);
    assert.equal(report.summary.failed, 0);
  });

  test('fails status assertion when there is no HTTP response', () => {
    const report = evaluateAssertions({
      result: failedResult('TIMEOUT'),
      suite: {
        assertions: [
          {
            id: 'a1',
            text: 'expect status == 200',
            subject: { kind: 'status' },
            operator: '==',
            expected: 200,
          },
        ],
      },
    });
    assert.equal(report.summary.failed, 1);
    assert.match(report.results[0]!.failure?.reason ?? '', /No HTTP response/u);
  });
});
