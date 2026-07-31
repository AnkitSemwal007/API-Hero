/**
 * Unit tests for {@link resetWorkspaceStore}.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLECTIONS_DIRECTORY_NAME } from '../collections/constants';
import { joinPathKey } from '../collections/models';
import type {
  CollectionDirectoryEntry,
  CollectionFilesystem,
} from '../collections/mutation/ports';
import {
  authProfilesPath,
  projectStoreRootPath,
  resetWorkspaceStore,
  scenariosDirectoryPath,
} from './index';

const ROOT = '/workspace';

class MemoryFs implements CollectionFilesystem {
  public readonly files = new Map<string, string>();
  public readonly directories = new Set<string>();
  public failDeletePaths = new Set<string>();
  public lastDeleteOptions:
    | { recursive?: boolean; useTrash?: boolean }
    | undefined;

  public async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  public async createDirectory(path: string): Promise<void> {
    this.directories.add(path.replace(/\/+$/, ''));
    const parts = path.replace(/\/+$/, '').split('/');
    for (let i = 1; i < parts.length; i += 1) {
      this.directories.add(parts.slice(0, i + 1).join('/'));
    }
  }

  public async readText(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return text;
  }

  public async writeText(path: string, content: string): Promise<void> {
    await this.createDirectory(path.replace(/\/[^/]+$/, ''));
    this.files.set(path, content);
  }

  public async delete(
    path: string,
    options?: { recursive?: boolean; useTrash?: boolean },
  ): Promise<void> {
    this.lastDeleteOptions = options;
    const normalized = path.replace(/\/+$/, '');
    if (this.failDeletePaths.has(normalized) || this.failDeletePaths.has(path)) {
      throw new Error(`Mock delete failure: ${path}`);
    }
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }
    if (options?.recursive === true) {
      const prefix = `${normalized}/`;
      for (const key of [...this.files.keys()]) {
        if (key === path || key.startsWith(prefix)) {
          this.files.delete(key);
        }
      }
      for (const key of [...this.directories]) {
        if (key === path || key === normalized || key.startsWith(prefix)) {
          this.directories.delete(key);
        }
      }
      this.directories.delete(normalized);
    }
  }

  public async rename(): Promise<void> {
    throw new Error('not implemented');
  }

  public async copy(): Promise<void> {
    throw new Error('not implemented');
  }

  public async readDirectory(
    path: string,
  ): Promise<readonly CollectionDirectoryEntry[]> {
    const prefix = `${path.replace(/\/+$/, '')}/`;
    const names = new Set<string>();
    const result: CollectionDirectoryEntry[] = [];
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) {
        continue;
      }
      const rest = file.slice(prefix.length);
      const name = rest.split('/')[0];
      if (name === undefined || names.has(name)) {
        continue;
      }
      names.add(name);
      result.push({
        name,
        type: rest.includes('/') ? 'directory' : 'file',
      });
    }
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix)) {
        continue;
      }
      const rest = directory.slice(prefix.length);
      if (rest.includes('/') || rest.length === 0) {
        continue;
      }
      if (names.has(rest)) {
        continue;
      }
      names.add(rest);
      result.push({ name: rest, type: 'directory' });
    }
    return result;
  }
}

async function seedProjectStore(fs: MemoryFs): Promise<void> {
  await fs.writeText(
    joinPathKey(projectStoreRootPath(ROOT), 'config/project.json'),
    JSON.stringify({ schemaVersion: 1, projectId: 'p1', collectionsDirectory: 'Collections' }),
  );
  await fs.writeText(
    authProfilesPath(ROOT),
    JSON.stringify({
      schemaVersion: 1,
      profiles: [{ id: 'bearer-1', providerId: 'bearer', label: 'Demo' }],
    }),
  );
  await fs.writeText(
    joinPathKey(scenariosDirectoryPath(ROOT), 'demo.scenario.json'),
    '{"schemaVersion":1,"id":"demo","name":"Demo","steps":[]}',
  );
}

async function seedCollectionsPreserved(fs: MemoryFs): Promise<void> {
  const collectionRoot = joinPathKey(ROOT, COLLECTIONS_DIRECTORY_NAME, 'Demo');
  await fs.writeText(
    joinPathKey(collectionRoot, 'Get Users.api'),
    'GET https://example.com/users',
  );
  await fs.writeText(
    joinPathKey(collectionRoot, 'api-hero.variables.json'),
    JSON.stringify({ schemaVersion: 1, variables: [] }),
  );
}

test('resetWorkspaceStore removes .apihero including scenarios', async () => {
  const fs = new MemoryFs();
  await seedProjectStore(fs);
  await seedCollectionsPreserved(fs);

  const result = await resetWorkspaceStore(ROOT, fs);

  assert.equal(result.deletedSomething, true);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(fs.lastDeleteOptions, {
    recursive: true,
    useTrash: false,
  });
  assert.equal(await fs.exists(projectStoreRootPath(ROOT)), false);
  assert.equal(await fs.exists(scenariosDirectoryPath(ROOT)), false);
  assert.equal(
    await fs.exists(
      joinPathKey(ROOT, COLLECTIONS_DIRECTORY_NAME, 'Demo', 'Get Users.api'),
    ),
    true,
  );
  assert.equal(
    await fs.exists(
      joinPathKey(
        ROOT,
        COLLECTIONS_DIRECTORY_NAME,
        'Demo',
        'api-hero.variables.json',
      ),
    ),
    true,
  );
});

test('resetWorkspaceStore is idempotent when .apihero is missing', async () => {
  const fs = new MemoryFs();
  await seedCollectionsPreserved(fs);

  const first = await resetWorkspaceStore(ROOT, fs);
  const second = await resetWorkspaceStore(ROOT, fs);

  assert.equal(first.deletedSomething, false);
  assert.equal(second.deletedSomething, false);
  assert.equal(first.failures.length, 0);
  assert.equal(second.failures.length, 0);
  assert.equal(
    await fs.exists(
      joinPathKey(ROOT, COLLECTIONS_DIRECTORY_NAME, 'Demo', 'Get Users.api'),
    ),
    true,
  );
});

test('resetWorkspaceStore repeated after a normal reset stays clean', async () => {
  const fs = new MemoryFs();
  await seedProjectStore(fs);

  const first = await resetWorkspaceStore(ROOT, fs);
  const second = await resetWorkspaceStore(ROOT, fs);

  assert.equal(first.deletedSomething, true);
  assert.equal(second.deletedSomething, false);
  assert.equal(await fs.exists(projectStoreRootPath(ROOT)), false);
});

test('resetWorkspaceStore removes legacy .api-hero/scenarios and empty parent', async () => {
  const fs = new MemoryFs();
  const legacyScenario = joinPathKey(
    ROOT,
    '.api-hero',
    'scenarios',
    'old.scenario.json',
  );
  await fs.writeText(legacyScenario, '{"schemaVersion":1}');

  const result = await resetWorkspaceStore(ROOT, fs);

  assert.equal(result.deletedSomething, true);
  assert.equal(result.failures.length, 0);
  assert.equal(await fs.exists(joinPathKey(ROOT, '.api-hero', 'scenarios')), false);
  assert.equal(await fs.exists(joinPathKey(ROOT, '.api-hero')), false);
});

test('resetWorkspaceStore leaves non-empty .api-hero parent alone', async () => {
  const fs = new MemoryFs();
  await fs.writeText(
    joinPathKey(ROOT, '.api-hero', 'scenarios', 'old.scenario.json'),
    '{}',
  );
  await fs.writeText(joinPathKey(ROOT, '.api-hero', 'other.txt'), 'keep');

  const result = await resetWorkspaceStore(ROOT, fs);

  assert.equal(result.deletedSomething, true);
  assert.equal(await fs.exists(joinPathKey(ROOT, '.api-hero', 'scenarios')), false);
  assert.equal(await fs.exists(joinPathKey(ROOT, '.api-hero', 'other.txt')), true);
  assert.equal(await fs.exists(joinPathKey(ROOT, '.api-hero')), true);
});

test('resetWorkspaceStore reports partial failure when project-store delete throws', async () => {
  const fs = new MemoryFs();
  await seedProjectStore(fs);
  await fs.writeText(
    joinPathKey(ROOT, '.api-hero', 'scenarios', 'legacy.scenario.json'),
    '{}',
  );
  fs.failDeletePaths.add(projectStoreRootPath(ROOT));

  const result = await resetWorkspaceStore(ROOT, fs);

  assert.equal(result.failures.length >= 1, true);
  assert.equal(
    result.failures.some((entry) => entry.component === 'project-store'),
    true,
  );
  assert.equal(await fs.exists(projectStoreRootPath(ROOT)), true);
  assert.equal(await fs.exists(joinPathKey(ROOT, '.api-hero', 'scenarios')), false);
});

test('resetWorkspaceStore does not touch Collections when store is present', async () => {
  const fs = new MemoryFs();
  await seedProjectStore(fs);
  await seedCollectionsPreserved(fs);
  const otherProjectFile = joinPathKey(ROOT, 'src', 'app.ts');
  await fs.writeText(otherProjectFile, 'export {}');

  await resetWorkspaceStore(ROOT, fs);

  assert.equal(await fs.exists(otherProjectFile), true);
  assert.equal(
    await fs.exists(
      joinPathKey(ROOT, COLLECTIONS_DIRECTORY_NAME, 'Demo', 'Get Users.api'),
    ),
    true,
  );
});
