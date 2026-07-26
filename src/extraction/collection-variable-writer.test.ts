import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CollectionVariableStore } from '../variables';
import type { VariableDefinition } from '../models';
import { CollectionVariableWriter } from './collection-variable-writer';

class FakeCollectionVariableStore implements CollectionVariableStore {
  public readonly upserts: {
    readonly collectionRootPath: string;
    readonly collectionId: string;
    readonly variable: {
      readonly name: string;
      readonly value: string;
      readonly sensitive: boolean;
    };
  }[] = [];
  public shouldThrow = false;

  public async load(): Promise<readonly VariableDefinition[]> {
    return [];
  }

  public async refresh(): Promise<readonly VariableDefinition[]> {
    return [];
  }

  public async upsert(
    collectionRootPath: string,
    collectionId: string,
    variable: { readonly name: string; readonly value: string; readonly sensitive: boolean },
  ): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('boom');
    }
    this.upserts.push({ collectionRootPath, collectionId, variable });
  }
}

describe('CollectionVariableWriter', () => {
  test('upserts into the store when collection context is active', async () => {
    const store = new FakeCollectionVariableStore();
    const writer = new CollectionVariableWriter({
      store,
      getCollectionRootPath: () => 'Collections/Checkout',
      getCollectionId: () => 'collection:collections/checkout',
    });

    const result = await writer.write({
      name: 'accessToken',
      value: 'abc',
      scope: 'collection',
      sensitive: true,
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(store.upserts, [
      {
        collectionRootPath: 'Collections/Checkout',
        collectionId: 'collection:collections/checkout',
        variable: { name: 'accessToken', value: 'abc', sensitive: true },
      },
    ]);
  });

  test('fails with PERSIST_FAILED when no collection context is active', async () => {
    const store = new FakeCollectionVariableStore();
    const writer = new CollectionVariableWriter({
      store,
      getCollectionRootPath: () => undefined,
      getCollectionId: () => undefined,
    });

    const result = await writer.write({
      name: 'accessToken',
      value: 'abc',
      scope: 'collection',
      sensitive: false,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERSIST_FAILED');
    }
    assert.equal(store.upserts.length, 0);
  });

  test('fails with PERSIST_FAILED when only one of rootPath/collectionId is known', async () => {
    const store = new FakeCollectionVariableStore();
    const writer = new CollectionVariableWriter({
      store,
      getCollectionRootPath: () => 'Collections/Checkout',
      getCollectionId: () => undefined,
    });

    const result = await writer.write({
      name: 'accessToken',
      value: 'abc',
      scope: 'collection',
      sensitive: false,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERSIST_FAILED');
    }
  });

  test('rejects invalid names', async () => {
    const store = new FakeCollectionVariableStore();
    const writer = new CollectionVariableWriter({
      store,
      getCollectionRootPath: () => 'Collections/Checkout',
      getCollectionId: () => 'collection:collections/checkout',
    });

    const result = await writer.write({
      name: '1bad',
      value: 'abc',
      scope: 'collection',
      sensitive: false,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'INVALID_NAME');
    }
  });

  test('rejects non-collection scopes', async () => {
    const store = new FakeCollectionVariableStore();
    const writer = new CollectionVariableWriter({
      store,
      getCollectionRootPath: () => 'Collections/Checkout',
      getCollectionId: () => 'collection:collections/checkout',
    });

    const result = await writer.write({
      name: 'x',
      value: 'y',
      scope: 'run',
      sensitive: false,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'UNSUPPORTED_SCOPE');
    }
  });

  test('returns PERSIST_FAILED when the store throws', async () => {
    const store = new FakeCollectionVariableStore();
    store.shouldThrow = true;
    const writer = new CollectionVariableWriter({
      store,
      getCollectionRootPath: () => 'Collections/Checkout',
      getCollectionId: () => 'collection:collections/checkout',
    });

    const result = await writer.write({
      name: 'x',
      value: 'y',
      scope: 'collection',
      sensitive: false,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERSIST_FAILED');
    }
  });
});
