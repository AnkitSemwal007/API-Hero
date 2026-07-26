import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { collectionIdForRoot } from '../collections/models';
import {
  FilesystemCollectionVariableStore,
  collectionVariablesDocumentPath,
  type CollectionVariableStorePorts,
} from './collection-variable-store';

class FakeCollectionVariableStorePorts implements CollectionVariableStorePorts {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();
  private collections: Record<string, Record<string, string>> = {};

  public constructor(private readonly overlayWritable: boolean = true) {}

  public seedFile(path: string, text: string): void {
    this.files.set(path, text);
  }

  public async readText(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`Not found: ${path}`);
    }
    return text;
  }

  public async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  public async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  public async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  public async readLocalOverlay(): Promise<{
    readonly collections: Readonly<Record<string, Readonly<Record<string, string>>>>;
  }> {
    return { collections: this.collections };
  }

  public async writeLocalOverlay(
    collections: Readonly<Record<string, Readonly<Record<string, string>>>>,
  ): Promise<boolean> {
    if (!this.overlayWritable) {
      return false;
    }
    this.collections = collections as Record<string, Record<string, string>>;
    return true;
  }

  public readFile(path: string): string | undefined {
    return this.files.get(path);
  }

  public get overlay(): Readonly<Record<string, Readonly<Record<string, string>>>> {
    return this.collections;
  }
}

const ROOT = 'Collections/Checkout';

describe('FilesystemCollectionVariableStore', () => {
  test('load returns [] when the variables file is missing', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    assert.deepEqual(await store.load(ROOT), []);
  });

  test('load returns [] and does not throw on corrupt JSON', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    ports.seedFile(collectionVariablesDocumentPath(ROOT), '{not json');
    const store = new FilesystemCollectionVariableStore(ports);
    assert.deepEqual(await store.load(ROOT), []);
  });

  test('upsert writes a non-sensitive value into the tracked file', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);

    await store.upsert(ROOT, collectionId, {
      name: 'baseUrl',
      value: 'https://api.example.test',
      sensitive: false,
    });

    const definitions = await store.load(ROOT);
    assert.deepEqual(definitions, [
      {
        name: 'baseUrl',
        value: 'https://api.example.test',
        scope: 'collection',
        sensitive: false,
      },
    ]);
    const trackedText = ports.readFile(collectionVariablesDocumentPath(ROOT));
    assert.match(trackedText ?? '', /https:\/\/api\.example\.test/u);
  });

  test('upsert redacts sensitive values in the tracked file and stores them in the overlay', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);

    await store.upsert(ROOT, collectionId, {
      name: 'apiKey',
      value: 'super-secret',
      sensitive: true,
    });

    const trackedText = ports.readFile(collectionVariablesDocumentPath(ROOT)) ?? '';
    assert.doesNotMatch(trackedText, /super-secret/u);
    assert.match(trackedText, /"sensitive": true/u);
    assert.deepEqual(ports.overlay, {
      [collectionId]: { apiKey: 'super-secret' },
    });

    const definitions = await store.load(ROOT);
    assert.deepEqual(definitions, [
      {
        name: 'apiKey',
        value: 'super-secret',
        scope: 'collection',
        sensitive: true,
      },
    ]);
  });

  test('upsert replaces an existing variable by name', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);

    await store.upsert(ROOT, collectionId, {
      name: 'token',
      value: 'first',
      sensitive: false,
    });
    await store.upsert(ROOT, collectionId, {
      name: 'token',
      value: 'second',
      sensitive: false,
    });

    const definitions = await store.load(ROOT);
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0]?.value, 'second');
  });

  test('switching a variable from sensitive to non-sensitive clears the overlay entry', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);

    await store.upsert(ROOT, collectionId, {
      name: 'token',
      value: 'secret-value',
      sensitive: true,
    });
    await store.upsert(ROOT, collectionId, {
      name: 'token',
      value: 'plain-value',
      sensitive: false,
    });

    assert.deepEqual(ports.overlay, {});
    const definitions = await store.load(ROOT);
    assert.deepEqual(definitions, [
      { name: 'token', value: 'plain-value', scope: 'collection', sensitive: false },
    ]);
  });

  test('overlay values are scoped by collectionId', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const otherRoot = 'Collections/Other';
    const otherId = collectionIdForRoot(otherRoot);
    const thisId = collectionIdForRoot(ROOT);

    await store.upsert(otherRoot, otherId, {
      name: 'token',
      value: 'other-secret',
      sensitive: true,
    });
    ports.seedFile(
      collectionVariablesDocumentPath(ROOT),
      JSON.stringify({
        schemaVersion: 1,
        variables: [{ name: 'token', value: '', sensitive: true }],
      }),
    );

    const definitions = await store.load(ROOT);
    assert.equal(definitions[0]?.value, '');
    assert.notEqual(thisId, otherId);
  });

  test('load accepts an explicit collectionId for legacy (workspace-root) overlay reads', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const legacyId = 'collection:legacy:/ws';

    await store.upsert(ROOT, legacyId, {
      name: 'apiKey',
      value: 'legacy-secret',
      sensitive: true,
    });

    // Without the explicit id, load falls back to collectionIdForRoot(ROOT)
    // and misses the overlay entry written under the legacy id.
    const withoutId = await store.load(ROOT);
    assert.equal(withoutId[0]?.value, '');

    const withId = await store.load(ROOT, legacyId);
    assert.equal(withId[0]?.value, 'legacy-secret');

    const refreshedWithId = await store.refresh(ROOT, legacyId);
    assert.equal(refreshedWithId[0]?.value, 'legacy-secret');
  });

  test('upsert of a sensitive value fails rather than silently redacting the tracked file when the overlay cannot be written', async () => {
    const ports = new FakeCollectionVariableStorePorts(false);
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);

    await assert.rejects(
      store.upsert(ROOT, collectionId, {
        name: 'apiKey',
        value: 'super-secret',
        sensitive: true,
      }),
    );

    // The tracked file must remain untouched — no redacted entry without the
    // cleartext value safely persisted somewhere.
    assert.equal(ports.readFile(collectionVariablesDocumentPath(ROOT)), undefined);
  });

  test('upsert of a non-sensitive value still succeeds when the overlay cannot be written', async () => {
    const ports = new FakeCollectionVariableStorePorts(false);
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);

    await store.upsert(ROOT, collectionId, {
      name: 'baseUrl',
      value: 'https://api.example.test',
      sensitive: false,
    });

    const definitions = await store.load(ROOT);
    assert.equal(definitions[0]?.value, 'https://api.example.test');
  });

  test('refresh behaves like load', async () => {
    const ports = new FakeCollectionVariableStorePorts();
    const store = new FilesystemCollectionVariableStore(ports);
    const collectionId = collectionIdForRoot(ROOT);
    await store.upsert(ROOT, collectionId, {
      name: 'x',
      value: '1',
      sensitive: false,
    });
    assert.deepEqual(await store.refresh(ROOT), await store.load(ROOT));
  });
});
