import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { InMemoryRunVariableStore } from '../variables';
import { CompositeVariableWriter } from './composite-variable-writer';
import type { VariableWriteRequest, VariableWriteResult } from './models';
import { InMemoryRuntimeVariableOverlay } from './runtime-overlay';
import type { VariableWriter } from './variable-writer';

class FakeEnvironmentWriter implements VariableWriter {
  public readonly writes: VariableWriteRequest[] = [];
  public result: VariableWriteResult = { ok: true };

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    this.writes.push(request);
    return this.result;
  }
}

describe('CompositeVariableWriter', () => {
  test('routes document writes to the overlay', async () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const runStore = new InMemoryRunVariableStore();
    const environment = new FakeEnvironmentWriter();
    const writer = new CompositeVariableWriter({ overlay, runStore, environment });

    const result = await writer.write({
      name: 'token',
      value: 'abc',
      scope: 'document',
      sensitive: true,
      requestKey: 'request:a#0',
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(overlay.getDefinitions({ requestKey: 'request:a#0' }), [
      { name: 'token', value: 'abc', scope: 'document', sensitive: true },
    ]);
    assert.equal(runStore.toDefinitions().length, 0);
    assert.equal(environment.writes.length, 0);
  });

  test('routes run writes to the run store', async () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const runStore = new InMemoryRunVariableStore();
    const environment = new FakeEnvironmentWriter();
    const writer = new CompositeVariableWriter({ overlay, runStore, environment });

    const result = await writer.write({
      name: 'runToken',
      value: 'xyz',
      scope: 'run',
      sensitive: false,
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(runStore.toDefinitions(), [
      { name: 'runToken', value: 'xyz', scope: 'run', sensitive: false },
    ]);
  });

  test('routes environment writes to the environment writer', async () => {
    const overlay = new InMemoryRuntimeVariableOverlay();
    const runStore = new InMemoryRunVariableStore();
    const environment = new FakeEnvironmentWriter();
    const writer = new CompositeVariableWriter({ overlay, runStore, environment });

    const request: VariableWriteRequest = {
      name: 'envToken',
      value: 'e1',
      scope: 'environment',
      sensitive: true,
    };
    const result = await writer.write(request);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(environment.writes, [request]);
  });

  test('collection returns UNSUPPORTED_SCOPE when no collection writer is configured', async () => {
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
    });

    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'collection',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'UNSUPPORTED_SCOPE');
    }
  });

  test('workspace returns UNSUPPORTED_SCOPE', async () => {
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
    });

    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'workspace',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'UNSUPPORTED_SCOPE');
    }
  });

  test('routes collection writes to the configured collection writer', async () => {
    const collection = new FakeEnvironmentWriter();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
      collection,
    });

    const request: VariableWriteRequest = {
      name: 'collectionToken',
      value: 'c1',
      scope: 'collection',
      sensitive: true,
    };
    const result = await writer.write(request);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(collection.writes, [request]);
  });

  test('propagates a failed collection writer result', async () => {
    const collection = new FakeEnvironmentWriter();
    collection.result = {
      ok: false,
      code: 'PERSIST_FAILED',
      message: 'no collection context',
    };
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
      collection,
    });

    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'collection',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERSIST_FAILED');
    }
  });

  test('resolveRunStore routes run writes to the active collection run store', async () => {
    const sessionStore = new InMemoryRunVariableStore();
    const collectionRunStore = new InMemoryRunVariableStore();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: sessionStore,
      environment: new FakeEnvironmentWriter(),
      resolveRunStore: () => collectionRunStore,
    });

    const result = await writer.write({
      name: 'accessToken',
      value: 'xyz',
      scope: 'run',
      sensitive: false,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(sessionStore.toDefinitions().length, 0);
    assert.deepEqual(collectionRunStore.toDefinitions(), [
      { name: 'accessToken', value: 'xyz', scope: 'run', sensitive: false },
    ]);
  });

  test('resolveRunStore returning undefined falls back to the session run store', async () => {
    const sessionStore = new InMemoryRunVariableStore();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: sessionStore,
      environment: new FakeEnvironmentWriter(),
      resolveRunStore: () => undefined,
    });

    const result = await writer.write({
      name: 'accessToken',
      value: 'xyz',
      scope: 'run',
      sensitive: false,
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(sessionStore.toDefinitions(), [
      { name: 'accessToken', value: 'xyz', scope: 'run', sensitive: false },
    ]);
  });

  test('invalid names return INVALID_NAME', async () => {
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
    });
    const result = await writer.write({
      name: '1bad',
      value: 'x',
      scope: 'run',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'INVALID_NAME');
    }
  });

  test('document write without requestKey fails', async () => {
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
    });
    const result = await writer.write({
      name: 'token',
      value: 'abc',
      scope: 'document',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERSIST_FAILED');
    }
  });
});
