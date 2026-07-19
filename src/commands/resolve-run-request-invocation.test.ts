import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveRunRequestInvocation } from './resolve-run-request-invocation';

function document(overrides: {
  readonly uri?: string;
  readonly languageId?: string;
  readonly offset?: number;
} = {}) {
  return {
    uri: overrides.uri ?? 'file:///requests.api',
    languageId: overrides.languageId ?? 'api',
    offsetAt: () => overrides.offset ?? 42,
    validatePosition: (position: { line: number; character: number }) => position,
  };
}

test('resolveRunRequestInvocation accepts caret-based runs', () => {
  const result = resolveRunRequestInvocation({
    suppliedArgument: undefined,
    activeDocument: document({ offset: 17 }),
    activeSelection: { line: 2, character: 0 },
    apiLanguageId: 'api',
  });
  assert.deepEqual(result, { ok: true, offset: 17 });
});

test('resolveRunRequestInvocation accepts a valid CodeLens argument', () => {
  const result = resolveRunRequestInvocation({
    suppliedArgument: {
      uri: 'file:///requests.api',
      position: { line: 4, character: 1 },
    },
    activeDocument: document({ offset: 99 }),
    apiLanguageId: 'api',
  });
  assert.deepEqual(result, { ok: true, offset: 99 });
});

test('resolveRunRequestInvocation rejects invalid argument payloads', () => {
  const result = resolveRunRequestInvocation({
    suppliedArgument: { uri: '', position: { line: 0, character: 0 } },
    activeDocument: document(),
    apiLanguageId: 'api',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errorMessage, /invalid request location/i);
  }
});

test('resolveRunRequestInvocation requires an active API document', () => {
  assert.match(
    (
      resolveRunRequestInvocation({
        suppliedArgument: undefined,
        activeDocument: undefined,
        apiLanguageId: 'api',
      }) as { errorMessage: string }
    ).errorMessage,
    /Open an API Runner/i,
  );
  assert.match(
    (
      resolveRunRequestInvocation({
        suppliedArgument: undefined,
        activeDocument: document({ languageId: 'json' }),
        apiLanguageId: 'api',
      }) as { errorMessage: string }
    ).errorMessage,
    /\.api/i,
  );
});

test('resolveRunRequestInvocation rejects stale CodeLens URIs', () => {
  const result = resolveRunRequestInvocation({
    suppliedArgument: {
      uri: 'file:///other.api',
      position: { line: 0, character: 0 },
    },
    activeDocument: document({ uri: 'file:///requests.api' }),
    apiLanguageId: 'api',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errorMessage, /no longer belongs/i);
  }
});
