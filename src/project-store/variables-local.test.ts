/**
 * Unit tests for the optional `collections` key on `VariablesLocalDocument`
 * (P2). Verifies backward compatibility: missing key reads as `{}` and the
 * schema version is not bumped.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type {
  CollectionDirectoryEntry,
  CollectionFilesystem,
} from '../collections/mutation/ports';
import { PROJECT_STORE_SCHEMA_VERSION } from './constants';
import {
  emptyVariablesLocalDocument,
  parseVariablesLocalDocument,
  readVariablesLocalOverlay,
  writeVariablesLocalOverlay,
} from './variables-local';

class MemoryFs implements CollectionFilesystem {
  public readonly files = new Map<string, string>();
  public readonly directories = new Set<string>();

  public async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  public async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  public async readText(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return text;
  }

  public async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  public async delete(): Promise<void> {
    throw new Error('not implemented');
  }

  public async rename(): Promise<void> {
    throw new Error('not implemented');
  }

  public async copy(): Promise<void> {
    throw new Error('not implemented');
  }

  public async readDirectory(): Promise<readonly CollectionDirectoryEntry[]> {
    return [];
  }
}

describe('VariablesLocalDocument collections key', () => {
  test('empty document omits collections', () => {
    const document = emptyVariablesLocalDocument();
    assert.equal(document.collections, undefined);
    assert.equal(document.schemaVersion, PROJECT_STORE_SCHEMA_VERSION);
  });

  test('parsing a document without collections leaves it undefined (⇒ {} for callers)', () => {
    const parsed = parseVariablesLocalDocument(
      JSON.stringify({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        workspace: {},
        environments: {},
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed?.collections, undefined);
    assert.equal(parsed?.schemaVersion, PROJECT_STORE_SCHEMA_VERSION);
  });

  test('parses collections map keyed by collectionId', () => {
    const parsed = parseVariablesLocalDocument(
      JSON.stringify({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        workspace: {},
        environments: {},
        collections: {
          'collection:/workspace/collections/checkout': { token: 'secret' },
        },
      }),
    );
    assert.deepEqual(parsed?.collections, {
      'collection:/workspace/collections/checkout': { token: 'secret' },
    });
  });

  test('ignores a malformed collections value without throwing', () => {
    const parsed = parseVariablesLocalDocument(
      JSON.stringify({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        workspace: {},
        environments: {},
        collections: 'not-an-object',
      }),
    );
    assert.deepEqual(parsed?.collections, {});
  });

  test('does not require a schema version bump for the optional key', () => {
    // The schema version stays 1 regardless of whether `collections` is present.
    const withCollections = parseVariablesLocalDocument(
      JSON.stringify({
        schemaVersion: 1,
        workspace: {},
        environments: {},
        collections: { a: { b: 'c' } },
      }),
    );
    const withoutCollections = parseVariablesLocalDocument(
      JSON.stringify({ schemaVersion: 1, workspace: {}, environments: {} }),
    );
    assert.equal(withCollections?.schemaVersion, 1);
    assert.equal(withoutCollections?.schemaVersion, 1);
  });

  test('round-trips collections through read/write overlay helpers', async () => {
    const fs = new MemoryFs();
    const workspaceRootPath = '/workspace';
    const initial = await readVariablesLocalOverlay(fs, workspaceRootPath);
    assert.equal(initial.collections, undefined);

    await writeVariablesLocalOverlay(fs, workspaceRootPath, {
      ...initial,
      collections: {
        'collection:/workspace/collections/checkout': { token: 'secret' },
      },
    });

    const reloaded = await readVariablesLocalOverlay(fs, workspaceRootPath);
    assert.deepEqual(reloaded.collections, {
      'collection:/workspace/collections/checkout': { token: 'secret' },
    });
  });

  test('write without collections omits the key entirely', async () => {
    const fs = new MemoryFs();
    const workspaceRootPath = '/workspace';
    await writeVariablesLocalOverlay(
      fs,
      workspaceRootPath,
      emptyVariablesLocalDocument(),
    );
    const path = [...fs.files.keys()][0]!;
    const raw = JSON.parse(fs.files.get(path)!) as Record<string, unknown>;
    assert.equal('collections' in raw, false);
  });
});
