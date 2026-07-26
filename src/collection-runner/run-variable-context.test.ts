import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { InMemoryRunVariableStore } from '../variables';
import { createCollectionRunVariableContext } from './run-variable-context';

describe('CollectionRunVariableContext', () => {
  test('starts inactive with no run store or identity', () => {
    const context = createCollectionRunVariableContext();
    assert.equal(context.isActive(), false);
    assert.equal(context.getRunStore(), undefined);
    assert.equal(context.getCollectionId(), undefined);
    assert.equal(context.getCollectionRootPath(), undefined);
  });

  test('begin activates the context with the given run store and identity', () => {
    const context = createCollectionRunVariableContext();
    const runStore = new InMemoryRunVariableStore();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore,
    });
    assert.equal(context.isActive(), true);
    assert.equal(context.getRunStore(), runStore);
    assert.equal(context.getCollectionId(), 'collection:a');
    assert.equal(context.getCollectionRootPath(), 'file:///a');
  });

  test('end deactivates a matching run id', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
    });
    context.end('run_1');
    assert.equal(context.isActive(), false);
  });

  test('end ignores a stale run id from a superseded run', () => {
    const context = createCollectionRunVariableContext();
    const runStore = new InMemoryRunVariableStore();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore,
    });
    // A second run begins (e.g. a new collection run started) before the
    // first run's `finally` block calls `end` with the stale id.
    const runStore2 = new InMemoryRunVariableStore();
    context.begin({
      runId: 'run_2',
      collectionId: 'collection:b',
      collectionRootPath: 'file:///b',
      runStore: runStore2,
    });
    context.end('run_1');
    assert.equal(context.isActive(), true);
    assert.equal(context.getRunStore(), runStore2);
    assert.equal(context.getCollectionId(), 'collection:b');
  });

  test('begin can be called again after end for a fresh run', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
    });
    context.end('run_1');
    const runStore2 = new InMemoryRunVariableStore();
    context.begin({
      runId: 'run_2',
      collectionId: 'collection:b',
      collectionRootPath: 'file:///b',
      runStore: runStore2,
    });
    assert.equal(context.isActive(), true);
    assert.equal(context.getRunStore(), runStore2);
  });
});
