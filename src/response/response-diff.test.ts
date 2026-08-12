/**
 * Unit tests for framework-free {@link responseDiff}.
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import type { ExecutionResult } from '../execution';
import type { RuntimeJsonValue } from '../models/request';
import { freezeDetachedBytes } from '../shared';
import { presentExecutionResult } from './presentation';
import { PresentationRing } from './presentation-ring';
import { responseDiff } from './response-diff';

function success(body: string, statusCode = 200): ExecutionResult {
  const bytes = freezeDetachedBytes(new TextEncoder().encode(body));
  const timing = Object.freeze({
    startedAt: '2026-08-12T10:00:00.000Z',
    completedAt: '2026-08-12T10:00:00.020Z',
    durationMs: 20,
  });
  let json: RuntimeJsonValue | undefined;
  try {
    json = JSON.parse(body) as RuntimeJsonValue;
  } catch {
    json = undefined;
  }
  return Object.freeze({
    success: true,
    requestId: 'req-1',
    request: Object.freeze({ method: 'GET', url: 'https://example.test/x' }),
    timing,
    response: Object.freeze({
      requestId: 'req-1',
      statusCode,
      statusText: statusCode === 200 ? 'OK' : 'Error',
      headers: Object.freeze([
        Object.freeze({ name: 'Content-Type', value: 'application/json' }),
        Object.freeze({ name: 'Authorization', value: 'Bearer secret-token-value' }),
        Object.freeze({ name: 'X-Request-Id', value: 'abc' }),
      ]),
      body: Object.freeze({
        bytes,
        text: body,
        ...(json === undefined ? {} : { json }),
      }),
      bodySizeBytes: bytes.byteLength,
      contentType: 'application/json',
      redirected: false,
      redirectCount: 0,
      url: 'https://example.test/x',
      timing,
    }),
  });
}

function textResult(body: string): ExecutionResult {
  const bytes = freezeDetachedBytes(new TextEncoder().encode(body));
  const timing = Object.freeze({
    startedAt: '2026-08-12T10:00:00.000Z',
    completedAt: '2026-08-12T10:00:00.020Z',
    durationMs: 20,
  });
  return Object.freeze({
    success: true,
    requestId: 'req-1',
    request: Object.freeze({ method: 'GET', url: 'https://example.test/text' }),
    timing,
    response: Object.freeze({
      requestId: 'req-1',
      statusCode: 200,
      statusText: 'OK',
      headers: Object.freeze([
        Object.freeze({ name: 'Content-Type', value: 'text/plain' }),
      ]),
      body: Object.freeze({ bytes, text: body }),
      bodySizeBytes: bytes.byteLength,
      contentType: 'text/plain',
      redirected: false,
      redirectCount: 0,
      url: 'https://example.test/text',
      timing,
    }),
  });
}

test('identical presentations report no differences', () => {
  const left = presentExecutionResult(success('{"ok":true,"user":{"active":true}}'));
  const right = presentExecutionResult(success('{"ok":true,"user":{"active":true}}'));
  const diff = responseDiff(left, right);
  assert.equal(diff.identical, true);
  assert.ok(diff.summaryLines.includes('No differences'));
});

test('changed JSON values use $.path summaries', () => {
  const left = presentExecutionResult(
    success('{"user":{"active":false,"name":"Ada"}}'),
  );
  const right = presentExecutionResult(
    success('{"user":{"active":true,"name":"Ada"}}'),
  );
  const diff = responseDiff(left, right, {
    leftLabel: 'Previous',
    rightLabel: 'Current',
  });
  assert.equal(diff.identical, false);
  assert.equal(diff.leftLabel, 'Previous');
  assert.equal(diff.rightLabel, 'Current');
  const change = diff.changes.find((entry) => entry.path === '$.user.active');
  assert.ok(change);
  assert.equal(change?.change, 'changed');
  assert.match(change?.summary ?? '', /Changed \$\.user\.active: false → true/u);
});

test('added and removed JSON fields', () => {
  const left = presentExecutionResult(
    success('{"user":{"active":true,"legacy_id":1}}'),
  );
  const right = presentExecutionResult(
    success('{"user":{"active":true,"email_verified":true}}'),
  );
  const diff = responseDiff(left, right);
  const added = diff.changes.find((entry) => entry.path === '$.user.email_verified');
  const removed = diff.changes.find((entry) => entry.path === '$.user.legacy_id');
  assert.equal(added?.change, 'added');
  assert.equal(added?.summary, 'Added $.user.email_verified');
  assert.equal(removed?.change, 'removed');
  assert.equal(removed?.summary, 'Removed $.user.legacy_id');
});

test('nested objects and arrays', () => {
  const left = presentExecutionResult(
    success('{"items":[{"id":1,"tag":"a"},{"id":2}]}'),
  );
  const right = presentExecutionResult(
    success('{"items":[{"id":1,"tag":"b"},{"id":2},{"id":3}]}'),
  );
  const diff = responseDiff(left, right);
  assert.ok(
    diff.changes.some(
      (entry) =>
        entry.path === '$.items[0].tag' && entry.change === 'changed',
    ),
  );
  assert.ok(
    diff.changes.some(
      (entry) => entry.path === '$.items[2]' && entry.change === 'added',
    ),
  );
});

test('status code changes', () => {
  const left = presentExecutionResult(success('{"ok":true}', 200));
  const right = presentExecutionResult(success('{"ok":true}', 500));
  const diff = responseDiff(left, right);
  const status = diff.changes.find((entry) => entry.kind === 'status');
  assert.equal(status?.change, 'changed');
  assert.match(status?.summary ?? '', /200.*→.*500/u);
});

test('header added removed and changed', () => {
  const leftBase = presentExecutionResult(success('{"ok":true}'));
  const rightBase = presentExecutionResult(success('{"ok":true}'));
  const left = {
    ...leftBase,
    headers: [
      { name: 'X-Request-Id', value: 'abc', masked: false },
      { name: 'X-Old', value: '1', masked: false },
    ],
  };
  const right = {
    ...rightBase,
    headers: [
      { name: 'X-Request-Id', value: 'xyz', masked: false },
      { name: 'X-New', value: '2', masked: false },
    ],
  };
  const diff = responseDiff(left, right);
  assert.ok(diff.changes.some((c) => c.path === 'header:x-request-id' && c.change === 'changed'));
  assert.ok(diff.changes.some((c) => c.path === 'header:x-old' && c.change === 'removed'));
  assert.ok(diff.changes.some((c) => c.path === 'header:x-new' && c.change === 'added'));
});

test('non-JSON text responses use line diff', () => {
  const left = presentExecutionResult(textResult('line1\nline2\nline3'));
  const right = presentExecutionResult(textResult('line1\nline2-changed\nline3\nline4'));
  const diff = responseDiff(left, right);
  assert.equal(diff.identical, false);
  assert.ok(diff.changes.some((c) => c.kind === 'text' && c.change === 'changed'));
  assert.ok(diff.changes.some((c) => c.kind === 'text' && c.change === 'added'));
});

test('secret masking keeps tokens out of diff output', () => {
  const left = presentExecutionResult(
    success('{"accessToken":"eyJhbGciOiJIUzI1NiJ9.aaa.bbb","user":{"active":false}}'),
  );
  const right = presentExecutionResult(
    success('{"accessToken":"eyJhbGciOiJIUzI1NiJ9.ccc.ddd","user":{"active":true}}'),
  );
  const diff = responseDiff(left, right);
  const serialized = JSON.stringify(diff);
  assert.doesNotMatch(serialized, /eyJhbGciOiJIUzI1NiJ9/u);
  assert.doesNotMatch(serialized, /secret-token-value/u);
  // Token-only differences scrub to the same mask and must not appear as cleartext changes.
  assert.equal(
    diff.changes.some((entry) => entry.path === '$.accessToken'),
    false,
  );
  const authHeader = left.headers.find((h) => h.name.toLowerCase() === 'authorization');
  assert.equal(authHeader?.masked, true);
  assert.match(authHeader?.value ?? '', /•/u);
});

test('large JSON performance sanity', () => {
  const build = (seed: number): string => {
    const items = [];
    for (let i = 0; i < 2_000; i += 1) {
      items.push({ id: i, value: `v-${i}-${seed}`, nested: { ok: i % 2 === 0 } });
    }
    return JSON.stringify({ items, meta: { seed } });
  };
  const left = presentExecutionResult(success(build(1)));
  const right = presentExecutionResult(success(build(2)));
  const started = performance.now();
  const diff = responseDiff(left, right);
  const elapsed = performance.now() - started;
  assert.equal(diff.identical, false);
  assert.ok(elapsed < 2_000, `diff took ${elapsed}ms`);
});

test('presentation ring keeps previous per requestKey', () => {
  const ring = new PresentationRing({ capacity: 3 });
  const a = presentExecutionResult(success('{"n":1}'));
  const b = presentExecutionResult(success('{"n":2}'));
  const c = presentExecutionResult(success('{"n":3}'));
  ring.push('key-1', a);
  ring.push('key-1', b);
  assert.equal(ring.previous('key-1'), a);
  assert.equal(ring.latest('key-1'), b);
  ring.push('key-1', c);
  assert.equal(ring.previous('key-1'), b);
  assert.equal(ring.list('key-1').length, 3);
  ring.push('key-1', presentExecutionResult(success('{"n":4}')));
  assert.equal(ring.list('key-1').length, 3);
  assert.equal(ring.hasPrevious('key-1'), true);
  assert.equal(ring.hasPrevious('missing'), false);
});
