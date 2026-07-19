import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  HISTORY_SCHEMA_VERSION,
  HistoryExecutionStatus,
  createFileHistoryStore,
  type HistoryEntry,
  type HistoryStorageFs,
} from './index';

function sampleEntry(id: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    schemaVersion: HISTORY_SCHEMA_VERSION,
    summary: {
      method: 'GET',
      url: `http://example.test/${id}`,
      durationMs: 10,
      timestamp: '2026-07-20T12:00:00.000Z',
      status: HistoryExecutionStatus.Success,
      statusCode: 200,
      ...overrides.summary,
    },
    metadata: {
      requestName: id,
      ...overrides.metadata,
    },
    ...(overrides.extensions === undefined
      ? {}
      : { extensions: overrides.extensions }),
  };
}

function createNodeHistoryFs(): HistoryStorageFs {
  return {
    async readFile(path: string): Promise<Uint8Array> {
      return new Uint8Array(await readFile(path));
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      await writeFile(path, data);
    },
    async createDirectory(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },
    joinPath(...parts: string[]): string {
      return join(...parts);
    },
    isMissingFileError(error: unknown): boolean {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'ENOENT'
      );
    },
  };
}

test('file history store appends lists gets deletes clears and retains', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-history-'));
  try {
    const store = createFileHistoryStore({
      storageRoot: root,
      fs: createNodeHistoryFs(),
      maxEntries: 2,
    });

    await store.append(sampleEntry('a'));
    await store.append(sampleEntry('b'));
    await store.append(sampleEntry('c'));

    assert.deepEqual(
      (await store.list()).map((entry) => entry.id),
      ['c', 'b'],
    );
    assert.equal((await store.get('a'))?.id, undefined);
    assert.equal((await store.get('b'))?.id, 'b');

    assert.equal(await store.delete('b'), true);
    assert.deepEqual(
      (await store.list()).map((entry) => entry.id),
      ['c'],
    );

    await store.clear();
    assert.equal((await store.list()).length, 0);

    await store.setMaxEntries(1);
    await store.append(sampleEntry('d'));
    await store.append(sampleEntry('e'));
    assert.deepEqual(
      (await store.list()).map((entry) => entry.id),
      ['e'],
    );

    const onDisk = JSON.parse(
      await readFile(store.storageUri, 'utf8'),
    ) as { schemaVersion: number; entries: { id: string }[] };
    assert.equal(onDisk.schemaVersion, HISTORY_SCHEMA_VERSION);
    assert.deepEqual(
      onDisk.entries.map((entry) => entry.id),
      ['e'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing file yields an empty document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-history-empty-'));
  try {
    const store = createFileHistoryStore({
      storageRoot: root,
      fs: createNodeHistoryFs(),
    });
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('corrupt JSON yields an empty document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-history-corrupt-'));
  try {
    const store = createFileHistoryStore({
      storageRoot: root,
      fs: createNodeHistoryFs(),
    });
    await mkdir(root, { recursive: true });
    await writeFile(store.storageUri, '{not-json');
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('permission and I/O failures reject without caching empty', async () => {
  const permissionError = { code: 'EACCES', message: 'permission denied' };
  let failRead = true;
  let readCount = 0;
  const entries = [sampleEntry('recovered')];
  const document = JSON.stringify({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    entries,
  });

  const fs: HistoryStorageFs = {
    async readFile(): Promise<Uint8Array> {
      readCount += 1;
      if (failRead) {
        throw permissionError;
      }
      return new Uint8Array(Buffer.from(document, 'utf8'));
    },
    async writeFile(): Promise<void> {
      // unused in this test
    },
    async createDirectory(): Promise<void> {
      // unused in this test
    },
    joinPath(...parts: string[]): string {
      return join(...parts);
    },
    isMissingFileError(): boolean {
      return false;
    },
  };

  const store = createFileHistoryStore({
    storageRoot: '/virtual-history',
    fs,
  });

  await assert.rejects(() => store.list(), (error: unknown) => {
    assert.equal(error, permissionError);
    return true;
  });
  await assert.rejects(() => store.get('recovered'), (error: unknown) => {
    assert.equal(error, permissionError);
    return true;
  });
  assert.equal(readCount, 2);

  failRead = false;
  assert.deepEqual(
    (await store.list()).map((entry) => entry.id),
    ['recovered'],
  );
  assert.equal(readCount, 3);

  failRead = true;
  assert.deepEqual(
    (await store.list()).map((entry) => entry.id),
    ['recovered'],
  );
  assert.equal(readCount, 3);
});

test('unknown schema version migrates to empty document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-history-migrate-'));
  try {
    const fs = createNodeHistoryFs();
    const store = createFileHistoryStore({ storageRoot: root, fs });
    await mkdir(root, { recursive: true });
    await writeFile(
      store.storageUri,
      JSON.stringify({
        schemaVersion: 999,
        entries: [sampleEntry('legacy')],
      }),
    );
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent appends serialize through the write queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-history-concurrent-'));
  try {
    const store = createFileHistoryStore({
      storageRoot: root,
      fs: createNodeHistoryFs(),
      maxEntries: 100,
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.append(sampleEntry(`id-${index}`)),
      ),
    );

    const listed = await store.list();
    assert.equal(listed.length, 20);
    const ids = new Set(listed.map((entry) => entry.id));
    assert.equal(ids.size, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
