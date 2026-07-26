import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type {
  EnvironmentWritePorts,
  EnvironmentWriteState,
} from './environment-variable-writer';
import { WorkspaceVariableWriter } from './workspace-variable-writer';

function sampleState(
  overrides?: Partial<EnvironmentWriteState>,
): EnvironmentWriteState {
  return {
    environments: [],
    globalVariables: [],
    workspaceVariables: [
      { name: 'existing', value: 'old', sensitive: false },
    ],
    ...overrides,
  };
}

function fakePorts(options?: {
  readonly state?: EnvironmentWriteState;
  readonly failPersist?: boolean;
}): EnvironmentWritePorts & {
  readonly refreshes: number;
  readonly written: EnvironmentWriteState[];
} {
  let state = options?.state ?? sampleState();
  const written: EnvironmentWriteState[] = [];
  let refreshes = 0;
  return {
    written,
    get refreshes() {
      return refreshes;
    },
    getActiveEnvironmentId: () => state.activeEnvironmentId,
    getState: () => state,
    writeState: async (next) => {
      if (options?.failPersist === true) {
        throw new Error('disk full');
      }
      state = next;
      written.push(next);
    },
    refresh: () => {
      refreshes += 1;
    },
  };
}

describe('WorkspaceVariableWriter', () => {
  test('upserts workspace variable, replaces same name, persists and refreshes', async () => {
    const ports = fakePorts();
    const writer = new WorkspaceVariableWriter(ports);

    const first = await writer.write({
      name: 'existing',
      value: 'new',
      scope: 'workspace',
      sensitive: true,
    });
    assert.deepEqual(first, { ok: true });

    const second = await writer.write({
      name: 'added',
      value: '2',
      scope: 'workspace',
      sensitive: false,
    });
    assert.deepEqual(second, { ok: true });

    assert.equal(ports.written.length, 2);
    assert.equal(ports.refreshes, 2);
    assert.deepEqual(ports.written[1]?.workspaceVariables, [
      { name: 'existing', value: 'new', sensitive: true },
      { name: 'added', value: '2', sensitive: false },
    ]);
  });

  test('rejects non-workspace scopes', async () => {
    const ports = fakePorts();
    const writer = new WorkspaceVariableWriter(ports);
    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'environment',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'UNSUPPORTED_SCOPE');
    }
    assert.equal(ports.written.length, 0);
  });

  test('INVALID_NAME for bad names', async () => {
    const ports = fakePorts();
    const writer = new WorkspaceVariableWriter(ports);
    const result = await writer.write({
      name: '1bad',
      value: '1',
      scope: 'workspace',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'INVALID_NAME');
    }
  });

  test('PERSIST_FAILED when writeState throws', async () => {
    const ports = fakePorts({ failPersist: true });
    const writer = new WorkspaceVariableWriter(ports);
    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'workspace',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERSIST_FAILED');
      assert.match(result.message, /disk full/);
    }
    assert.equal(ports.refreshes, 0);
  });
});
