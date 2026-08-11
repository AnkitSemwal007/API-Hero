/**
 * ProcessEnvSecretStore + environment selector tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { authenticationSecretKey } from '../auth';
import {
  ProcessEnvSecretStore,
  resolveEnvironmentSelector,
  toApiHeroSecretEnvName,
} from './composition';

describe('ProcessEnvSecretStore', () => {
  test('reads exact key then APIHERO_SECRET_* alias', async () => {
    const key = authenticationSecretKey('demo', 'token');
    const store = new ProcessEnvSecretStore({
      [key]: 'exact-value',
    });
    assert.equal(await store.get(key), 'exact-value');

    const aliased = new ProcessEnvSecretStore({
      [toApiHeroSecretEnvName(key)]: 'alias-value',
    });
    assert.equal(await aliased.get(key), 'alias-value');
  });

  test('set/delete are in-memory only', async () => {
    const store = new ProcessEnvSecretStore({});
    await store.set('k', 'v');
    assert.equal(await store.get('k'), 'v');
    await store.delete('k');
    assert.equal(await store.get('k'), undefined);
  });
});

describe('resolveEnvironmentSelector', () => {
  const environments = [
    { id: 'env-prod', name: 'Production', variables: [] },
    { id: 'env-stg', name: 'staging', variables: [] },
  ] as const;

  test('matches id then name', () => {
    assert.equal(resolveEnvironmentSelector(environments, 'env-prod'), 'env-prod');
    assert.equal(resolveEnvironmentSelector(environments, 'staging'), 'env-stg');
  });

  test('throws clear error when unknown', () => {
    assert.throws(
      () => resolveEnvironmentSelector(environments, 'missing'),
      /Unknown environment "missing"/,
    );
  });
});
