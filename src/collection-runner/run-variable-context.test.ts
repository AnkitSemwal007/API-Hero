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
    assert.equal(context.getEnvironmentOverride(), undefined);
    assert.equal(context.getAuthenticationPreference(), undefined);
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
    assert.equal(context.getEnvironmentOverride(), undefined);
    assert.equal(context.getAuthenticationPreference(), undefined);
  });

  test('environment override absent leaves getter undefined', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
    });
    assert.equal(context.getEnvironmentOverride(), undefined);
  });

  test('environment override with no id means explicit No Environment', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
      environmentOverride: {},
    });
    const override = context.getEnvironmentOverride();
    assert.ok(override !== undefined);
    assert.equal(override.environmentId, undefined);
  });

  test('environment override with a specific id is returned', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
      environmentOverride: { environmentId: 'env-staging' },
    });
    assert.deepEqual(context.getEnvironmentOverride(), {
      environmentId: 'env-staging',
    });
  });

  test('authenticationPreference is undefined unless begin supplies it', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
    });
    assert.equal(context.getAuthenticationPreference(), undefined);
  });

  test('authenticationPreference collection-default is stored', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
      authenticationPreference: 'collection-default',
    });
    assert.equal(context.getAuthenticationPreference(), 'collection-default');
  });

  test('authenticationPreference resolved is stored', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
      authenticationPreference: 'resolved',
    });
    assert.equal(context.getAuthenticationPreference(), 'resolved');
  });

  test('end clears override getters', () => {
    const context = createCollectionRunVariableContext();
    context.begin({
      runId: 'run_1',
      collectionId: 'collection:a',
      collectionRootPath: 'file:///a',
      runStore: new InMemoryRunVariableStore(),
      environmentOverride: { environmentId: 'env-1' },
      authenticationPreference: 'resolved',
    });
    context.end('run_1');
    assert.equal(context.getEnvironmentOverride(), undefined);
    assert.equal(context.getAuthenticationPreference(), undefined);
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
