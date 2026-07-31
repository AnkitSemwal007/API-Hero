/**
 * Unit tests for `.apihero` project store migration and helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLECTIONS_DIRECTORY_NAME } from '../collections/constants';
import type {
  CollectionDirectoryEntry,
  CollectionFilesystem,
} from '../collections/mutation/ports';
import {
  APIHERO_DIRECTORY_NAME,
  PROJECT_STORE_GITIGNORE_LINES,
  ProjectStoreService,
  authProfilesPath,
  configPath,
  ensureProjectStoreGitignore,
  environmentDocumentPath,
  environmentsDirectoryPath,
  migrateIfNeeded,
  migrationBackupPath,
  parseConfigDocument,
  projectStoreRootPath,
  variablesLocalPath,
  workspaceDocumentPath,
} from './index';

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
    options?: { recursive?: boolean; useTrash?: boolean },
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
    const oldNormalized = oldPath.replace(/\/+$/, '');
    const newNormalized = newPath.replace(/\/+$/, '');
    const oldPrefix = `${oldNormalized}/`;
    const newPrefix = `${newNormalized}/`;
    const fileMoves: Array<[string, string]> = [];
    for (const key of this.files.keys()) {
      if (key === oldNormalized || key.startsWith(oldPrefix)) {
        fileMoves.push([
          key,
          key === oldNormalized
            ? newNormalized
            : `${newPrefix}${key.slice(oldPrefix.length)}`,
        ]);
      }
    }
    if (fileMoves.length === 0 && !this.directories.has(oldNormalized)) {
      throw new Error(`Missing path for rename: ${oldPath}`);
    }
    for (const [from, to] of fileMoves) {
      const text = this.files.get(from)!;
      this.files.delete(from);
      await this.writeText(to, text);
    }
    const dirMoves = [...this.directories].filter(
      (key) => key === oldNormalized || key.startsWith(oldPrefix),
    );
    for (const key of dirMoves) {
      this.directories.delete(key);
      const next =
        key === oldNormalized
          ? newNormalized
          : `${newPrefix}${key.slice(oldPrefix.length)}`;
      this.directories.add(next.replace(/\/+$/, ''));
    }
    this.directories.add(newNormalized);
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

/** Fails the first rename whose destination matches a predicate. */
class FlakyRenameFs extends MemoryFs {
  public constructor(
    private readonly shouldFail: (oldPath: string, newPath: string) => boolean,
  ) {
    super();
  }

  public override async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.shouldFail(oldPath, newPath)) {
      throw new Error(`Injected rename failure: ${oldPath} -> ${newPath}`);
    }
    return super.rename(oldPath, newPath);
  }
}

const ROOT = '/workspace';
const SECONDARY = '/secondary';

function sampleSettings() {
  return {
    environments: [
      {
        id: 'dev',
        name: 'Development',
        variables: [
          {
            name: 'baseUrl',
            value: 'https://api.example.com',
            sensitive: false,
            scope: 'environment' as const,
          },
        ],
      },
    ],
    workspaceVariables: [
      {
        name: 'team',
        value: 'platform',
        sensitive: false,
        scope: 'workspace' as const,
      },
    ],
    activeEnvironmentId: 'dev',
    authenticationProfiles: [
      {
        id: 'bearer-prod',
        providerId: 'bearer' as const,
        label: 'Prod',
        token: { kind: 'secret' as const },
      },
    ],
  };
}

function settingsWithSecrets() {
  return {
    environments: [
      {
        id: 'dev',
        name: 'Development',
        variables: [
          {
            name: 'baseUrl',
            value: 'https://api.example.com',
            sensitive: false,
            scope: 'environment' as const,
          },
          {
            name: 'apiKey',
            value: 'env-secret-value',
            sensitive: true,
            scope: 'environment' as const,
          },
        ],
      },
    ],
    workspaceVariables: [
      {
        name: 'team',
        value: 'platform',
        sensitive: false,
        scope: 'workspace' as const,
      },
      {
        name: 'token',
        value: 'workspace-secret-value',
        sensitive: true,
        scope: 'workspace' as const,
      },
    ],
    activeEnvironmentId: 'dev',
    authenticationProfiles: [
      {
        id: 'bearer-prod',
        providerId: 'bearer' as const,
        label: 'Prod',
        token: {
          kind: 'literal' as const,
          value: 'super-secret-bearer',
          unsafe: true as const,
        },
      },
    ],
  };
}

test('migrate creates expected .apihero files from settings', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);

  const result = await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: sampleSettings(),
    allowSettingsMigration: true,
    createProjectId: () => 'project-fixed-id',
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });

  assert.equal(result.outcome.status, 'migrated');
  assert.equal(result.backupWritten, true);

  const config = parseConfigDocument(await fs.readText(configPath(ROOT)));
  assert.deepEqual(config, {
    schemaVersion: 1,
    projectId: 'project-fixed-id',
    collectionsDirectory: COLLECTIONS_DIRECTORY_NAME,
  });

  const workspace = JSON.parse(await fs.readText(workspaceDocumentPath(ROOT)));
  assert.equal(workspace.activeEnvironmentId, 'dev');
  assert.equal(workspace.variables[0].name, 'team');

  const env = JSON.parse(
    await fs.readText(environmentDocumentPath(ROOT, 'dev')),
  );
  assert.equal(env.id, 'dev');
  assert.equal(env.variables[0].value, 'https://api.example.com');

  const auth = JSON.parse(await fs.readText(authProfilesPath(ROOT)));
  assert.equal(auth.profiles[0].token.kind, 'secret');
  assert.equal(
    (auth.profiles[0].token as { value?: unknown }).value,
    undefined,
  );

  const backup = JSON.parse(await fs.readText(migrationBackupPath(ROOT)));
  assert.equal(backup.source, 'workspace-settings');
  assert.equal(backup.migratedAt, '2026-07-23T00:00:00.000Z');
});

test('second migrate is idempotent and does not overwrite content', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);

  await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: sampleSettings(),
    allowSettingsMigration: true,
    createProjectId: () => 'first-id',
  });

  await fs.writeText(
    workspaceDocumentPath(ROOT),
    JSON.stringify({
      schemaVersion: 1,
      activeEnvironmentId: 'custom',
      variables: [{ name: 'kept', value: 'yes' }],
    }),
  );

  const second = await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: {
      ...sampleSettings(),
      activeEnvironmentId: 'should-not-apply',
    },
    allowSettingsMigration: true,
    createProjectId: () => 'second-id',
  });

  assert.equal(second.outcome.status, 'skipped-already-migrated');
  const workspace = JSON.parse(await fs.readText(workspaceDocumentPath(ROOT)));
  assert.equal(workspace.activeEnvironmentId, 'custom');
  assert.equal(workspace.variables[0].name, 'kept');
  const config = parseConfigDocument(await fs.readText(configPath(ROOT)));
  assert.equal(config?.projectId, 'first-id');
});

test('backup is written under .apihero/local/', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);
  await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: sampleSettings(),
    allowSettingsMigration: true,
    createProjectId: () => 'id',
  });
  assert.equal(await fs.exists(migrationBackupPath(ROOT)), true);
});

test('Collections directory is not touched during migration', async () => {
  const fs = new MemoryFs();
  const collectionsRoot = `${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`;
  const requestPath = `${collectionsRoot}/Demo/get.api`;
  await fs.createDirectory(collectionsRoot);
  await fs.writeText(requestPath, '### Get\nGET {{baseUrl}}/items\n');

  await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: sampleSettings(),
    allowSettingsMigration: true,
    createProjectId: () => 'id',
  });

  assert.equal(
    await fs.readText(requestPath),
    '### Get\nGET {{baseUrl}}/items\n',
  );
  assert.equal(await fs.exists(`${ROOT}/${APIHERO_DIRECTORY_NAME}`), true);
});

test('empty folder without legacy data is skipped', async () => {
  const fs = new MemoryFs();
  const result = await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: {
      environments: [],
      workspaceVariables: [],
      authenticationProfiles: [],
    },
    allowSettingsMigration: true,
    createProjectId: () => 'id',
  });
  assert.equal(result.outcome.status, 'skipped-empty');
  assert.equal(await fs.exists(configPath(ROOT)), false);
});

test('gitignore appends without duplicates', async () => {
  const fs = new MemoryFs();
  await fs.writeText(
    `${ROOT}/.gitignore`,
    'node_modules/\n.apihero/local/\n',
  );

  const first = await ensureProjectStoreGitignore(fs, ROOT);
  assert.equal(first.changed, true);
  const text = await fs.readText(`${ROOT}/.gitignore`);
  for (const line of PROJECT_STORE_GITIGNORE_LINES) {
    const occurrences = text.split('\n').filter((entry) => entry === line);
    assert.equal(occurrences.length, 1, line);
  }

  const second = await ensureProjectStoreGitignore(fs, ROOT);
  assert.equal(second.changed, false);
});

test('auth secret refs stay kind:secret only', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);
  await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: sampleSettings(),
    allowSettingsMigration: true,
    createProjectId: () => 'id',
  });
  const authText = await fs.readText(authProfilesPath(ROOT));
  assert.equal(authText.includes('"kind": "secret"'), true);
  assert.equal(authText.includes('password'), false);
  assert.equal(authText.includes('token-value'), false);
});

test('literal bearer token migrates to kind:secret without value on disk', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);
  await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: settingsWithSecrets(),
    allowSettingsMigration: true,
    createProjectId: () => 'id',
  });

  const auth = JSON.parse(await fs.readText(authProfilesPath(ROOT)));
  assert.equal(auth.profiles[0].token.kind, 'secret');
  assert.equal(Object.hasOwn(auth.profiles[0].token, 'value'), false);
  assert.equal(auth.profiles[0].token.unsafe, undefined);
  const authText = await fs.readText(authProfilesPath(ROOT));
  assert.equal(authText.includes('super-secret-bearer'), false);

  // Backup under local/ may retain full recovery values.
  const backup = JSON.parse(await fs.readText(migrationBackupPath(ROOT)));
  assert.equal(backup.authenticationProfiles[0].token.kind, 'literal');
  assert.equal(backup.authenticationProfiles[0].token.value, 'super-secret-bearer');
});

test('sensitive variables redact on disk and merge from local overlay', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);
  await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: settingsWithSecrets(),
    allowSettingsMigration: true,
    createProjectId: () => 'id',
  });

  const env = JSON.parse(
    await fs.readText(environmentDocumentPath(ROOT, 'dev')),
  );
  const apiKey = env.variables.find(
    (variable: { name: string }) => variable.name === 'apiKey',
  );
  assert.equal(apiKey.sensitive, true);
  assert.equal(apiKey.value, '');

  const workspace = JSON.parse(await fs.readText(workspaceDocumentPath(ROOT)));
  const token = workspace.variables.find(
    (variable: { name: string }) => variable.name === 'token',
  );
  assert.equal(token.sensitive, true);
  assert.equal(token.value, '');

  const overlay = JSON.parse(await fs.readText(variablesLocalPath(ROOT)));
  assert.equal(overlay.environments.dev.apiKey, 'env-secret-value');
  assert.equal(overlay.workspace.token, 'workspace-secret-value');

  const service = new ProjectStoreService({ filesystem: fs });
  const metadata = await service.readProjectMetadata(ROOT);
  assert.ok(metadata);
  const envVar = metadata.environments[0]?.variables.find(
    (variable) => variable.name === 'apiKey',
  );
  assert.equal(envVar?.value, 'env-secret-value');
  const workspaceVar = metadata.workspaceVariables.find(
    (variable) => variable.name === 'token',
  );
  assert.equal(workspaceVar?.value, 'workspace-secret-value');
});

test('ensureInitialized creates minimal store', async () => {
  const fs = new MemoryFs();
  const service = new ProjectStoreService({
    filesystem: fs,
    createProjectId: () => 'init-id',
  });
  const result = await service.ensureInitialized(ROOT);
  assert.equal(result.outcome.status, 'initialized');
  assert.equal(await fs.exists(configPath(ROOT)), true);
  assert.equal(await fs.exists(workspaceDocumentPath(ROOT)), true);
  assert.equal(await fs.exists(authProfilesPath(ROOT)), true);
});

test('ensureInitialized does not clone settings', async () => {
  const fs = new MemoryFs();
  const service = new ProjectStoreService({
    filesystem: fs,
    createProjectId: () => 'seeded-id',
  });
  const result = await service.ensureInitialized(ROOT, settingsWithSecrets());
  assert.equal(result.outcome.status, 'initialized');
  const auth = JSON.parse(await fs.readText(authProfilesPath(ROOT)));
  assert.deepEqual(auth.profiles, []);
  const workspace = JSON.parse(await fs.readText(workspaceDocumentPath(ROOT)));
  assert.deepEqual(workspace.variables, []);
  assert.equal(await fs.exists(variablesLocalPath(ROOT)), false);
});

test('folder with Collections but no settings still migrates/inits', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);
  const result = await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: {
      environments: [],
      workspaceVariables: [],
      authenticationProfiles: [],
    },
    allowSettingsMigration: false,
    createProjectId: () => 'collections-only',
  });
  assert.equal(result.outcome.status, 'initialized');
  assert.equal(await fs.exists(configPath(ROOT)), true);
});

test('settings migrate only when allowSettingsMigration is true', async () => {
  const fs = new MemoryFs();
  await fs.createDirectory(`${ROOT}/${COLLECTIONS_DIRECTORY_NAME}`);
  await fs.createDirectory(`${SECONDARY}/${COLLECTIONS_DIRECTORY_NAME}`);

  const primary = await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: ROOT,
    settings: settingsWithSecrets(),
    allowSettingsMigration: true,
    createProjectId: () => 'primary-id',
  });
  assert.equal(primary.outcome.status, 'migrated');

  const secondary = await migrateIfNeeded({
    filesystem: fs,
    workspaceRootPath: SECONDARY,
    settings: settingsWithSecrets(),
    allowSettingsMigration: false,
    createProjectId: () => 'secondary-id',
  });
  assert.equal(secondary.outcome.status, 'initialized');

  const primaryAuth = JSON.parse(await fs.readText(authProfilesPath(ROOT)));
  assert.equal(primaryAuth.profiles[0]?.id, 'bearer-prod');

  const secondaryAuth = JSON.parse(
    await fs.readText(authProfilesPath(SECONDARY)),
  );
  assert.deepEqual(secondaryAuth.profiles, []);

  const secondaryWorkspace = JSON.parse(
    await fs.readText(workspaceDocumentPath(SECONDARY)),
  );
  assert.deepEqual(secondaryWorkspace.variables, []);
  assert.equal(await fs.exists(variablesLocalPath(SECONDARY)), false);
});

test('writeEnvironments replaces atomically without staging leftovers', async () => {
  const fs = new MemoryFs();
  const service = new ProjectStoreService({
    filesystem: fs,
    createProjectId: () => 'atomic-id',
  });

  await service.writeEnvironments(ROOT, [
    {
      id: 'a',
      name: 'A',
      variables: [
        {
          name: 'x',
          value: '1',
          sensitive: false,
          scope: 'environment',
        },
      ],
    },
  ]);
  await service.writeEnvironments(ROOT, [
    {
      id: 'b',
      name: 'B',
      variables: [
        {
          name: 'y',
          value: '2',
          sensitive: false,
          scope: 'environment',
        },
      ],
    },
  ]);

  const live = environmentsDirectoryPath(ROOT);
  const entries = await fs.readDirectory(live);
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    ['b.json'],
  );
  assert.equal(await fs.exists(environmentDocumentPath(ROOT, 'a')), false);
  assert.equal(await fs.exists(environmentDocumentPath(ROOT, 'b')), true);

  const storeRoot = projectStoreRootPath(ROOT);
  const leftovers = [...fs.directories].filter(
    (path) =>
      path.startsWith(`${storeRoot}/environments.staging-`) ||
      path.startsWith(`${storeRoot}/environments.bak-`),
  );
  assert.deepEqual(leftovers, []);
});

test('writeEnvironments rolls back when rename to live fails', async () => {
  let failStagingToLive = false;
  const fs = new FlakyRenameFs((oldPath, newPath) => {
    if (!failStagingToLive) {
      return false;
    }
    // Fail only staging → live, never live → bak or bak → live rollback.
    return (
      oldPath.includes('/environments.staging-') &&
      newPath.endsWith('/environments')
    );
  });
  const service = new ProjectStoreService({
    filesystem: fs,
    createProjectId: () => 'rollback-id',
  });

  await service.writeEnvironments(ROOT, [
    {
      id: 'keep',
      name: 'Keep',
      variables: [
        {
          name: 'stable',
          value: 'yes',
          sensitive: false,
          scope: 'environment',
        },
      ],
    },
  ]);

  failStagingToLive = true;
  await assert.rejects(
    () =>
      service.writeEnvironments(ROOT, [
        {
          id: 'new',
          name: 'New',
          variables: [],
        },
      ]),
    /Injected rename failure/,
  );

  const keep = JSON.parse(
    await fs.readText(environmentDocumentPath(ROOT, 'keep')),
  );
  assert.equal(keep.id, 'keep');
  assert.equal(await fs.exists(environmentDocumentPath(ROOT, 'new')), false);

  const storeRoot = projectStoreRootPath(ROOT);
  const leftovers = [...fs.directories].filter(
    (path) =>
      path.startsWith(`${storeRoot}/environments.staging-`) ||
      path.startsWith(`${storeRoot}/environments.bak-`),
  );
  assert.deepEqual(leftovers, []);
});

test('writeAuthProfiles redacts literals on disk', async () => {
  const fs = new MemoryFs();
  const service = new ProjectStoreService({
    filesystem: fs,
    createProjectId: () => 'auth-write-id',
  });
  await service.writeAuthProfiles(ROOT, [
    {
      id: 'bearer-1',
      providerId: 'bearer',
      token: {
        kind: 'literal',
        value: 'disk-must-not-see',
        unsafe: true,
      },
    },
  ]);
  const auth = JSON.parse(await fs.readText(authProfilesPath(ROOT)));
  assert.equal(auth.profiles[0].token.kind, 'secret');
  assert.equal(Object.hasOwn(auth.profiles[0].token, 'value'), false);
  assert.equal(
    (await fs.readText(authProfilesPath(ROOT))).includes('disk-must-not-see'),
    false,
  );
});
