import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EnvironmentVariableWriter,
  type EnvironmentWritePorts,
  type EnvironmentWriteState,
} from './environment-variable-writer';

function sampleState(
  overrides?: Partial<EnvironmentWriteState>,
): EnvironmentWriteState {
  return {
    environments: [
      {
        id: 'env-1',
        name: 'Dev',
        variables: [{ name: 'existing', value: 'old', sensitive: false }],
      },
    ],
    globalVariables: [],
    workspaceVariables: [],
    activeEnvironmentId: 'env-1',
    ...overrides,
  };
}

function fakePorts(options?: {
  readonly activeId?: string | undefined;
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
    getActiveEnvironmentId: () =>
      options !== undefined && 'activeId' in options
        ? options.activeId
        : state.activeEnvironmentId,
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

describe('EnvironmentVariableWriter', () => {
  test('upserts variable, replaces same name, persists and refreshes', async () => {
    const ports = fakePorts();
    const writer = new EnvironmentVariableWriter(ports);

    const first = await writer.write({
      name: 'existing',
      value: 'new',
      scope: 'environment',
      sensitive: true,
    });
    assert.deepEqual(first, { ok: true });

    const second = await writer.write({
      name: 'added',
      value: '2',
      scope: 'environment',
      sensitive: false,
    });
    assert.deepEqual(second, { ok: true });

    assert.equal(ports.written.length, 2);
    assert.equal(ports.refreshes, 2);
    const last = ports.written[1]!;
    assert.deepEqual(last.environments[0]?.variables, [
      { name: 'existing', value: 'new', sensitive: true },
      { name: 'added', value: '2', sensitive: false },
    ]);
  });

  test('NO_ACTIVE_ENVIRONMENT when none selected', async () => {
    const ports = fakePorts({ activeId: undefined });
    const writer = new EnvironmentVariableWriter(ports);
    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'environment',
      sensitive: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'NO_ACTIVE_ENVIRONMENT');
    }
    assert.equal(ports.written.length, 0);
    assert.equal(ports.refreshes, 0);
  });

  test('PERSIST_FAILED when writeState throws', async () => {
    const ports = fakePorts({ failPersist: true });
    const writer = new EnvironmentVariableWriter(ports);
    const result = await writer.write({
      name: 'x',
      value: '1',
      scope: 'environment',
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
