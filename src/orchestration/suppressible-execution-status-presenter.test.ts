import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ExecutionStatus,
  ExecutionStatusPresenter,
} from './execution-orchestrator';
import { SuppressibleExecutionStatusPresenter } from './suppressible-execution-status-presenter';

class FakeStatusPresenter implements ExecutionStatusPresenter {
  public readonly updates: ExecutionStatus[] = [];
  public disposed = false;

  public update(status: ExecutionStatus): void {
    this.updates.push(status);
  }

  public dispose(): void {
    this.disposed = true;
  }
}

test('forwards updates while not suppressed', () => {
  const inner = new FakeStatusPresenter();
  const gate = new SuppressibleExecutionStatusPresenter(inner);

  gate.update({ kind: 'running' });
  gate.update({ kind: 'success', statusCode: 200 });

  assert.deepEqual(inner.updates, [
    { kind: 'running' },
    { kind: 'success', statusCode: 200 },
  ]);
});

test('setSuppressed(true) forces idle and ignores further updates', () => {
  const inner = new FakeStatusPresenter();
  const gate = new SuppressibleExecutionStatusPresenter(inner);

  gate.update({ kind: 'running' });
  gate.setSuppressed(true);
  gate.update({ kind: 'success', statusCode: 201 });
  gate.update({ kind: 'failed' });

  assert.deepEqual(inner.updates, [
    { kind: 'running' },
    { kind: 'idle' },
  ]);
});

test('setSuppressed(false) resumes forwarding', () => {
  const inner = new FakeStatusPresenter();
  const gate = new SuppressibleExecutionStatusPresenter(inner);

  gate.setSuppressed(true);
  gate.update({ kind: 'running' });
  gate.setSuppressed(false);
  gate.update({ kind: 'cancelled' });

  assert.deepEqual(inner.updates, [
    { kind: 'idle' },
    { kind: 'cancelled' },
  ]);
});

test('dispose delegates to the inner presenter', () => {
  const inner = new FakeStatusPresenter();
  const gate = new SuppressibleExecutionStatusPresenter(inner);

  gate.dispose();
  assert.equal(inner.disposed, true);
});
