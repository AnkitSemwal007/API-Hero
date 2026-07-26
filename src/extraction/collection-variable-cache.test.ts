import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { planCollectionVariablePersistRefresh } from './collection-variable-cache';

describe('planCollectionVariablePersistRefresh', () => {
  const normalizeKey = (path: string): string => path.replace(/\\/gu, '/').toLowerCase();
  const definitions = [
    { name: 'token', value: 'abc', scope: 'collection' as const, sensitive: true },
  ];

  test('always returns a cache key for the persisted root', () => {
    const plan = planCollectionVariablePersistRefresh({
      persistedRootPath: 'C:\\Collections\\Auth',
      definitions,
      isCollectionRunActive: false,
      activeRootPath: undefined,
      normalizeKey,
    });
    assert.equal(plan.cacheKey, 'c:/collections/auth');
    assert.equal(plan.updateActiveRunSnapshot, false);
    assert.equal(plan.definitions, definitions);
  });

  test('updates active-run snapshot when persist matches active root', () => {
    const plan = planCollectionVariablePersistRefresh({
      persistedRootPath: '/ws/col',
      definitions,
      isCollectionRunActive: true,
      activeRootPath: '/ws/col',
      normalizeKey,
    });
    assert.equal(plan.updateActiveRunSnapshot, true);
  });

  test('does not update active-run snapshot for a different collection root', () => {
    const plan = planCollectionVariablePersistRefresh({
      persistedRootPath: '/ws/other',
      definitions,
      isCollectionRunActive: true,
      activeRootPath: '/ws/col',
      normalizeKey,
    });
    assert.equal(plan.updateActiveRunSnapshot, false);
  });

  test('does not update active-run snapshot when no run is active', () => {
    const plan = planCollectionVariablePersistRefresh({
      persistedRootPath: '/ws/col',
      definitions,
      isCollectionRunActive: false,
      activeRootPath: '/ws/col',
      normalizeKey,
    });
    assert.equal(plan.updateActiveRunSnapshot, false);
  });
});
