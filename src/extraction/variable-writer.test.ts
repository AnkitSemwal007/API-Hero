import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { InMemoryRuntimeVariableOverlay } from './runtime-overlay';
import { NoOpVariableWriter } from './variable-writer';

describe('NoOpVariableWriter', () => {
  test('write always returns NOT_IMPLEMENTED', async () => {
    const writer = new NoOpVariableWriter();
    const result = await writer.write({
      name: 'token',
      value: 'abc',
      scope: 'document',
      sensitive: false,
    });
    assert.deepEqual(result, {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: 'VariableWriter persistence is not implemented in Phase 0.',
    });
  });
});

describe('InMemoryRuntimeVariableOverlay', () => {
  test('set/get stores document-scoped definitions by request identity', () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const identity = { requestKey: 'request:a#0' };

    overlay.set(identity, {
      name: 'token',
      value: 'abc',
      scope: 'document',
      sensitive: true,
    });
    overlay.set(identity, {
      name: 'userId',
      value: '42',
      scope: 'document',
      sensitive: false,
    });

    assert.deepEqual(overlay.getDefinitions(identity), [
      { name: 'token', value: 'abc', scope: 'document', sensitive: true },
      { name: 'userId', value: '42', scope: 'document', sensitive: false },
    ]);
  });

  test('set ignores non-document scopes', () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const identity = { requestKey: 'request:a#0' };

    overlay.set(identity, {
      name: 'envVar',
      value: 'x',
      scope: 'environment',
      sensitive: false,
    });

    assert.deepEqual(overlay.getDefinitions(identity), []);
  });

  test('set overwrites an existing name for the same identity', () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const identity = { requestKey: 'request:a#0' };

    overlay.set(identity, {
      name: 'token',
      value: 'old',
      scope: 'document',
      sensitive: false,
    });
    overlay.set(identity, {
      name: 'token',
      value: 'new',
      scope: 'document',
      sensitive: true,
    });

    assert.deepEqual(overlay.getDefinitions(identity), [
      { name: 'token', value: 'new', scope: 'document', sensitive: true },
    ]);
  });

  test('clear one identity leaves others intact', () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const a = { requestKey: 'request:a#0' };
    const b = { requestKey: 'request:b#0' };

    overlay.set(a, {
      name: 'a',
      value: '1',
      scope: 'document',
      sensitive: false,
    });
    overlay.set(b, {
      name: 'b',
      value: '2',
      scope: 'document',
      sensitive: false,
    });

    overlay.clear(a);

    assert.deepEqual(overlay.getDefinitions(a), []);
    assert.deepEqual(overlay.getDefinitions(b), [
      { name: 'b', value: '2', scope: 'document', sensitive: false },
    ]);
  });

  test('clear with no identity clears all', () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const a = { requestKey: 'request:a#0' };
    const b = { requestKey: 'request:b#0' };

    overlay.set(a, {
      name: 'a',
      value: '1',
      scope: 'document',
      sensitive: false,
    });
    overlay.set(b, {
      name: 'b',
      value: '2',
      scope: 'document',
      sensitive: false,
    });

    overlay.clear();

    assert.deepEqual(overlay.getDefinitions(a), []);
    assert.deepEqual(overlay.getDefinitions(b), []);
  });
});
