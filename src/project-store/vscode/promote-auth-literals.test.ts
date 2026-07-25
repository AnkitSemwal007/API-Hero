/**
 * Unit tests for auth literal promotion and fail-hard coordinator writes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CollectionDirectoryEntry,
  CollectionFilesystem,
} from '../../collections/mutation/ports';
import type { AuthenticationProfile } from '../../models';
import { Logger } from '../../shared';
import type { SecretStore } from '../../storage/stores';
import { authProfilesPath, configPath } from '../paths';
import { promoteAuthLiteralsToSecretStorage } from './promote-auth-literals';
import { ProjectStoreCoordinator } from './project-store-coordinator';

const ROOT = '/workspace';

const bearerWithLiteral: AuthenticationProfile = {
  id: 'bearer-1',
  providerId: 'bearer',
  token: {
    kind: 'literal',
    value: 'super-secret-token',
    unsafe: true,
  },
};

class MemoryFs implements CollectionFilesystem {
  public readonly files = new Map<string, string>();
  public readonly directories = new Set<string>();

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
    options?: { recursive?: boolean },
  ): Promise<void> {
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }
    if (options?.recursive === true) {
      const prefix = `${path.replace(/\/+$/, '')}/`;
      for (const key of [...this.files.keys()]) {
        if (key === path || key.startsWith(prefix)) {
          this.files.delete(key);
        }
      }
      for (const key of [...this.directories]) {
        if (key === path || key.startsWith(prefix)) {
          this.directories.delete(key);
        }
      }
      this.directories.delete(path.replace(/\/+$/, ''));
    }
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.files.has(oldPath)) {
      const text = this.files.get(oldPath)!;
      this.files.delete(oldPath);
      await this.writeText(newPath, text);
      return;
    }
    throw new Error(`Cannot rename: ${oldPath}`);
  }

  public async copy(): Promise<void> {
    throw new Error('not implemented');
  }

  public async readDirectory(
    path: string,
  ): Promise<readonly CollectionDirectoryEntry[]> {
    const normalized = path.replace(/\/+$/, '');
    const prefix = `${normalized}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name !== undefined && name.length > 0) {
          names.add(name);
        }
      }
    }
    for (const key of this.directories) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name !== undefined && name.length > 0) {
          names.add(name);
        }
      }
    }
    return [...names].map((name) => {
      const child = `${normalized}/${name}`;
      const isDir =
        this.directories.has(child) ||
        [...this.files.keys()].some((key) => key.startsWith(`${child}/`));
      return { name, type: isDir ? ('directory' as const) : ('file' as const) };
    });
  }
}

class MemorySecretStore implements SecretStore {
  public readonly values = new Map<string, string>();
  public failOnSet = false;

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    if (this.failOnSet) {
      throw new Error('SecretStorage unavailable');
    }
    this.values.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createLogger(): Logger {
  return new Logger({ appendLine: () => undefined });
}

test('promoteAuthLiteralsToSecretStorage throws when secretStore.set fails', async () => {
  const secrets = new MemorySecretStore();
  secrets.failOnSet = true;
  await assert.rejects(
    () => promoteAuthLiteralsToSecretStorage([bearerWithLiteral], secrets),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('Failed to promote auth literal') &&
      error.message.includes('bearer-1') &&
      error.message.includes('token'),
  );
  assert.equal(secrets.values.size, 0);
});

test('promoteAuthLiteralsToSecretStorage is fill-only for existing secrets', async () => {
  const secrets = new MemorySecretStore();
  const key =
    'apiRunner.auth.profile.bearer-1.token';
  await secrets.set(key, 'already-there');
  await promoteAuthLiteralsToSecretStorage([bearerWithLiteral], secrets);
  assert.equal(secrets.values.get(key), 'already-there');
});

test('writeAuthProfiles aborts when literal promotion fails', async () => {
  const fs = new MemoryFs();
  const secrets = new MemorySecretStore();
  secrets.failOnSet = true;
  const coordinator = new ProjectStoreCoordinator(
    fs,
    createLogger(),
    secrets,
  );

  await assert.rejects(
    () => coordinator.writeAuthProfiles(ROOT, [bearerWithLiteral]),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('Failed to promote auth literal'),
  );

  assert.equal(await fs.exists(authProfilesPath(ROOT)), false);
  assert.equal(await fs.exists(configPath(ROOT)), false);
  assert.equal(coordinator.isProjectMode(ROOT), false);
});

test('migrateFolder aborts before config when literal promotion fails', async () => {
  const fs = new MemoryFs();
  const secrets = new MemorySecretStore();
  secrets.failOnSet = true;
  const coordinator = new ProjectStoreCoordinator(
    fs,
    createLogger(),
    secrets,
  );

  await assert.rejects(
    () =>
      coordinator.migrateFolder({
        workspaceRootPath: ROOT,
        allowSettingsMigration: true,
        settings: {
          environments: [],
          workspaceVariables: [],
          authenticationProfiles: [bearerWithLiteral],
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('Failed to promote auth literal'),
  );

  assert.equal(await fs.exists(configPath(ROOT)), false);
  assert.equal(await fs.exists(authProfilesPath(ROOT)), false);
});
