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

  test('collection and workspace return UNSUPPORTED_SCOPE', async () => {
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new FakeEnvironmentWriter(),
    });

    for (const scope of ['collection', 'workspace'] as const) {
      const result = await writer.write({
        name: 'x',
        value: '1',
        scope,
        sensitive: false,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, 'UNSUPPORTED_SCOPE');
      }
    }
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
