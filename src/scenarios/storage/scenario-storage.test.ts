import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { join } from 'node:path';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Dirent } from 'node:fs';

import { ScenarioSchemaVersion, ScenarioVariableScope, StepType, type Scenario } from '../models';
import {
  LEGACY_SCENARIOS_DIRECTORY_NAME,
  SCENARIOS_DIRECTORY_NAME,
  ScenarioStorageService,
  copyScenarioFileExclusive,
  discoverScenariosInDiscoveryRoots,
  discoverWorkspaceScenarios,
  ensureScenariosRoot,
  legacyScenariosRootPath,
  migrateLegacyScenariosIfNeeded,
  scenariosRootPath,
  type ScenarioStorageFs,
} from './scenario-storage';

function validScenarioJson(id: string, name: string): string {
  return JSON.stringify(
    {
      schemaVersion: ScenarioSchemaVersion,
      id,
      name,
      variables: [],
      steps: [{ id: 'D1', type: StepType.Delay, name: 'Delay', durationMs: 0 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    },
    null,
    2,
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function realFs(): ScenarioStorageFs {
  return {
    stat: (p) => stat(p),
    readdir: (p, o) => readdir(p, o) as Promise<Dirent[]>,
    mkdir: (p, o) => mkdir(p, o),
    rename: (s, d) => rename(s, d),
    copyFile: (s, d, m) =>
      m === undefined ? copyFile(s, d) : copyFile(s, d, m),
    unlink: (p) => unlink(p),
    rmdir: (p) => rmdir(p),
    readFile: (p) => readFile(p) as Promise<Buffer>,
    open: (p, flags) => open(p, flags),
    access: (p) => access(p),
  };
}

function errno(code: string, message = code): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('scenarios/storage/scenario-storage', () => {
  test('scenariosRootPath resolves under .apihero/scenarios', () => {
    const ws = join(tmpdir(), 'ws-root');
    const root = scenariosRootPath(ws);
    assert.ok(root.includes('.apihero'));
    assert.ok(root.replace(/\\/g, '/').endsWith('.apihero/scenarios'));
    assert.equal(SCENARIOS_DIRECTORY_NAME, 'scenarios');
    assert.equal(LEGACY_SCENARIOS_DIRECTORY_NAME, '.api-hero/scenarios');
  });

  test('legacyScenariosRootPath resolves under .api-hero/scenarios', () => {
    const ws = join(tmpdir(), 'ws-legacy');
    const root = legacyScenariosRootPath(ws);
    assert.ok(root.replace(/\\/g, '/').endsWith('.api-hero/scenarios'));
  });

  test('saves then loads a scenario', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-'));
    const filePath = join(root, 'a.scenario.json');

    const scenario: Scenario = {
      id: 'sid',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario A',
      variables: [
        { id: 'v1', name: 'varA', scope: ScenarioVariableScope.Scenario, sensitive: false },
      ],
      steps: [{ id: 'D1', type: StepType.Delay, name: 'Delay', durationMs: 0 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const service = new ScenarioStorageService();
    const saved = await service.save(scenario, filePath);
    assert.equal(saved.ok, true);

    const loaded = await service.load(filePath);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.scenario.name, 'Scenario A');
    assert.equal(loaded.scenario.schemaVersion, ScenarioSchemaVersion);
    assert.equal(loaded.scenario.id, 'sid');
  });

  test('save rejects documents that fail schema round-trip validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-invalid-save-'));
    const filePath = join(root, 'bad.scenario.json');
    const service = new ScenarioStorageService();
    const invalid = {
      id: 'sid',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Broken',
      variables: [],
      steps: [],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    } as unknown as Scenario;

    const saved = await service.save(invalid, filePath);
    assert.equal(saved.ok, false);
    if (!saved.ok) {
      assert.equal(saved.error.code, 'INVALID_DOCUMENT');
    }
  });

  test('rejects invalid schemaVersion on load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-b-'));
    const filePath = join(root, 'bad.scenario.json');

    await writeFile(
      filePath,
      JSON.stringify(
        {
          schemaVersion: '0.0.0',
          steps: [],
          connections: [],
          variables: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    const service = new ScenarioStorageService();
    const loaded = await service.load(filePath);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error.code, 'INVALID_SCHEMA_VERSION');
  });

  test('discovers valid scenarios recursively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-c-'));
    const nested = join(root, 'nested');
    await mkdir(nested, { recursive: true });

    await writeFile(
      join(root, 'a.scenario.json'),
      validScenarioJson('sidA', 'A'),
      'utf8',
    );

    await writeFile(
      join(nested, 'b.scenario.json'),
      validScenarioJson('sidB', 'B'),
      'utf8',
    );

    // invalid schema, still discoverable as file but not as scenario
    await writeFile(
      join(root, 'invalid.scenario.json'),
      JSON.stringify({ schemaVersion: '0.0.0', steps: [], connections: [], variables: [] }, null, 2),
      'utf8',
    );

    const service = new ScenarioStorageService();
    const discovered = await service.discover(root);

    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 2);
    assert.equal(discovered.files.length, 3);
  });
});

describe('scenarios/storage legacy migration', () => {
  test('legacy folder only → files end in .apihero/scenarios; legacy gone', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-legacy-only-'));
    const legacy = legacyScenariosRootPath(ws);
    const nested = join(legacy, 'nested');
    await mkdir(nested, { recursive: true });

    const rawA = validScenarioJson('a', 'A');
    const rawB = validScenarioJson('b', 'B');
    await writeFile(join(legacy, 'a.scenario.json'), rawA, 'utf8');
    await writeFile(join(nested, 'b.scenario.json'), rawB, 'utf8');

    const result = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(result.status, 'MigrationSucceeded');
    assert.deepEqual(result.discoveryRoots, [scenariosRootPath(ws)]);

    const canonical = scenariosRootPath(ws);
    assert.equal(await readFile(join(canonical, 'a.scenario.json'), 'utf8'), rawA);
    assert.equal(
      await readFile(join(canonical, 'nested', 'b.scenario.json'), 'utf8'),
      rawB,
    );
    assert.equal(await pathExists(legacy), false);
    assert.equal(await pathExists(join(ws, '.api-hero')), false);
  });

  test('new folder only → no-op', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-canonical-only-'));
    const canonical = scenariosRootPath(ws);
    await mkdir(canonical, { recursive: true });
    const raw = validScenarioJson('c', 'C');
    await writeFile(join(canonical, 'c.scenario.json'), raw, 'utf8');

    const result = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(result.status, 'NoMigrationNeeded');
    assert.deepEqual(result.discoveryRoots, [canonical]);

    assert.equal(await readFile(join(canonical, 'c.scenario.json'), 'utf8'), raw);
    assert.equal(await pathExists(legacyScenariosRootPath(ws)), false);
  });

  test('both folders → merge without overwrite of differing canonical', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-both-'));
    const legacy = legacyScenariosRootPath(ws);
    const canonical = scenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await mkdir(canonical, { recursive: true });

    const sharedCanonical = validScenarioJson('shared', 'Canonical Shared');
    const sharedLegacy = validScenarioJson('shared', 'Legacy Shared');
    const onlyLegacy = validScenarioJson('only-legacy', 'Only Legacy');

    await writeFile(join(canonical, 'shared.scenario.json'), sharedCanonical, 'utf8');
    await writeFile(join(legacy, 'shared.scenario.json'), sharedLegacy, 'utf8');
    await writeFile(join(legacy, 'only-legacy.scenario.json'), onlyLegacy, 'utf8');

    const result = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(result.status, 'MigrationSucceededWithConflicts');
    assert.ok(result.conflictFiles.includes('shared.scenario.json'));
    assert.ok(result.discoveryRoots.includes(legacy));

    assert.equal(
      await readFile(join(canonical, 'shared.scenario.json'), 'utf8'),
      sharedCanonical,
    );
    assert.equal(
      await readFile(join(canonical, 'only-legacy.scenario.json'), 'utf8'),
      onlyLegacy,
    );
    // Differing duplicate kept on legacy side (not overwritten / not deleted)
    assert.equal(
      await readFile(join(legacy, 'shared.scenario.json'), 'utf8'),
      sharedLegacy,
    );
  });

  test('identical duplicate removes legacy file after migrate', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-identical-'));
    const legacy = legacyScenariosRootPath(ws);
    const canonical = scenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await mkdir(canonical, { recursive: true });

    const same = validScenarioJson('same', 'Same');
    await writeFile(join(canonical, 'same.scenario.json'), same, 'utf8');
    await writeFile(join(legacy, 'same.scenario.json'), same, 'utf8');

    const result = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(result.status, 'MigrationSucceeded');

    assert.equal(await readFile(join(canonical, 'same.scenario.json'), 'utf8'), same);
    assert.equal(await pathExists(join(legacy, 'same.scenario.json')), false);
  });

  test('empty legacy folder → cleaned up', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-empty-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });

    const result = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(result.status, 'MigrationSucceeded');

    assert.equal(await pathExists(legacy), false);
    assert.equal(await pathExists(join(ws, '.api-hero')), false);
  });

  test('corrupted scenario file still moved as bytes', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-corrupt-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    const corrupt = '{ not valid json at all';
    await writeFile(join(legacy, 'broken.scenario.json'), corrupt, 'utf8');

    const result = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(result.status, 'MigrationSucceeded');

    const dest = join(scenariosRootPath(ws), 'broken.scenario.json');
    assert.equal(await readFile(dest, 'utf8'), corrupt);
    assert.equal(await pathExists(join(legacy, 'broken.scenario.json')), false);

    const service = new ScenarioStorageService();
    const discovered = await service.discover(scenariosRootPath(ws));
    assert.equal(discovered.ok, true);
    assert.equal(discovered.files.length, 1);
    assert.equal(discovered.scenarios.length, 0);
  });

  test('repeated migration is safe', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-repeat-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    const raw = validScenarioJson('r', 'Repeat');
    await writeFile(join(legacy, 'r.scenario.json'), raw, 'utf8');

    const r1 = await migrateLegacyScenariosIfNeeded(ws);
    const r2 = await migrateLegacyScenariosIfNeeded(ws);
    const r3 = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(r1.status, 'MigrationSucceeded');
    assert.equal(r2.status, 'NoMigrationNeeded');
    assert.equal(r3.status, 'NoMigrationNeeded');

    const canonical = scenariosRootPath(ws);
    assert.equal(await readFile(join(canonical, 'r.scenario.json'), 'utf8'), raw);
    assert.equal(await pathExists(legacy), false);
  });

  test('scenario creation after migration goes to new location only', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-create-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await writeFile(
      join(legacy, 'old.scenario.json'),
      validScenarioJson('old', 'Old'),
      'utf8',
    );

    const { root, migration } = await ensureScenariosRoot(ws);
    assert.equal(root, scenariosRootPath(ws));
    assert.equal(migration.status, 'MigrationSucceeded');

    const scenario: Scenario = {
      id: 'new',
      schemaVersion: ScenarioSchemaVersion,
      name: 'New',
      variables: [],
      steps: [{ id: 'D1', type: StepType.Delay, name: 'Delay', durationMs: 0 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const service = new ScenarioStorageService();
    const filePath = join(root, 'new.scenario.json');
    const saved = await service.save(scenario, filePath);
    assert.equal(saved.ok, true);

    assert.ok(filePath.replace(/\\/g, '/').includes('.apihero/scenarios/'));
    assert.equal(await pathExists(join(legacy, 'new.scenario.json')), false);
    assert.equal(await pathExists(filePath), true);

    // ensure does not recreate legacy tree
    const legacyParentEntries = await pathExists(join(ws, '.api-hero'))
      ? await readdir(join(ws, '.api-hero'))
      : [];
    assert.equal(legacyParentEntries.length, 0);
  });
});

describe('scenarios/storage migration failure visibility', () => {
  test('rename failure (non-EXDEV) → failedFiles, legacy remains, discoverable', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-rename-fail-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    const raw = validScenarioJson('fail-rename', 'Fail Rename');
    const src = join(legacy, 'fail-rename.scenario.json');
    await writeFile(src, raw, 'utf8');

    const base = realFs();
    const io: ScenarioStorageFs = {
      ...base,
      rename: async () => {
        throw errno('EIO', 'simulated rename failure');
      },
    };

    const result = await migrateLegacyScenariosIfNeeded(ws, { fs: io });
    assert.equal(result.status, 'MigrationFailed');
    assert.equal(result.failedFiles.length, 1);
    assert.equal(await pathExists(src), true);
    assert.ok(result.discoveryRoots.includes(legacy));

    const discovered = await discoverScenariosInDiscoveryRoots(
      result,
      new ScenarioStorageService(),
    );
    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 1);
    assert.equal(discovered.scenarios[0]?.id, 'fail-rename');
  });

  test('EXDEV then copy failure → same visibility guarantee', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-exdev-copy-fail-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    const raw = validScenarioJson('fail-exdev', 'Fail Exdev');
    const src = join(legacy, 'fail-exdev.scenario.json');
    await writeFile(src, raw, 'utf8');

    const base = realFs();
    const io: ScenarioStorageFs = {
      ...base,
      rename: async () => {
        throw errno('EXDEV', 'cross-device');
      },
      copyFile: async () => {
        throw errno('EIO', 'simulated copy failure');
      },
    };

    const result = await migrateLegacyScenariosIfNeeded(ws, { fs: io });
    assert.equal(result.status, 'MigrationFailed');
    assert.equal(result.failedFiles.length, 1);
    assert.equal(await pathExists(src), true);
    assert.ok(result.discoveryRoots.includes(legacy));

    const discovered = await discoverScenariosInDiscoveryRoots(
      result,
      new ScenarioStorageService(),
    );
    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 1);
    assert.equal(discovered.scenarios[0]?.id, 'fail-exdev');
  });

  test('copy fails after writing non-empty dest → failedFiles, legacy visible (not conflict)', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-copy-leftover-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    const good = validScenarioJson('leftover', 'Good Legacy');
    const src = join(legacy, 'leftover.scenario.json');
    await writeFile(src, good, 'utf8');

    const base = realFs();
    const io: ScenarioStorageFs = {
      ...base,
      rename: async () => {
        throw errno('EXDEV', 'cross-device');
      },
      copyFile: async (s, d) => {
        // Simulate a failed copy that left garbage at dest (must not become conflict_kept).
        await writeFile(d, '{ partial', 'utf8');
        throw errno('EIO', 'copy aborted after partial write');
      },
    };

    const result = await migrateLegacyScenariosIfNeeded(ws, { fs: io });
    assert.equal(result.status, 'MigrationFailed');
    assert.equal(result.failedFiles.length, 1);
    assert.equal(result.conflictFiles.length, 0);
    assert.equal(await pathExists(src), true);
    assert.equal(await readFile(src, 'utf8'), good);
    assert.ok(result.discoveryRoots.includes(legacy));

    // Partial dest must not remain as a preferred "conflict" winner.
    const dest = join(scenariosRootPath(ws), 'leftover.scenario.json');
    assert.equal(await pathExists(dest), false);

    const discovered = await discoverScenariosInDiscoveryRoots(result);
    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 1);
    assert.equal(discovered.scenarios[0]?.name, 'Good Legacy');
  });

  test('partial migration success (2 files, second fails)', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-partial-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    const rawA = validScenarioJson('a', 'A');
    const rawB = validScenarioJson('b', 'B');
    await writeFile(join(legacy, 'a.scenario.json'), rawA, 'utf8');
    await writeFile(join(legacy, 'b.scenario.json'), rawB, 'utf8');

    const base = realFs();
    let renameCount = 0;
    const io: ScenarioStorageFs = {
      ...base,
      rename: async (s, d) => {
        renameCount += 1;
        // discoverScenarioFiles sorts paths — a before b
        if (renameCount >= 2) {
          throw errno('EIO', 'fail second rename');
        }
        return base.rename(s, d);
      },
    };

    const result = await migrateLegacyScenariosIfNeeded(ws, { fs: io });
    assert.equal(result.status, 'MigrationPartiallySucceeded');
    assert.equal(result.migratedFiles.length, 1);
    assert.equal(result.failedFiles.length, 1);

    const canonical = scenariosRootPath(ws);
    assert.equal(await pathExists(join(canonical, 'a.scenario.json')), true);
    assert.equal(await pathExists(join(legacy, 'b.scenario.json')), true);
    assert.ok(result.discoveryRoots.includes(legacy));

    const discovered = await discoverScenariosInDiscoveryRoots(result);
    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 2);
    const ids = discovered.scenarios.map((s) => s.id).sort();
    assert.deepEqual(ids, ['a', 'b']);
  });

  test('failed migration keeps legacy scenarios visible end-to-end', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-visible-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await writeFile(
      join(legacy, 'kept.scenario.json'),
      validScenarioJson('kept', 'Kept'),
      'utf8',
    );

    const base = realFs();
    const result = await migrateLegacyScenariosIfNeeded(ws, {
      fs: {
        ...base,
        rename: async () => {
          throw errno('EIO', 'always fail');
        },
      },
    });
    assert.equal(result.status, 'MigrationFailed');

    const discovered = await discoverWorkspaceScenarios(
      ws,
      new ScenarioStorageService(),
      {
        fs: {
          ...base,
          rename: async () => {
            throw errno('EIO', 'still failing');
          },
        },
      },
    );
    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 1);
    assert.equal(discovered.scenarios[0]?.id, 'kept');
  });

  test('concurrent destination creation (open wx EEXIST) → never overwrite', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-race-'));
    const legacy = legacyScenariosRootPath(ws);
    const canonical = scenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await mkdir(canonical, { recursive: true });

    const legacyRaw = validScenarioJson('race', 'Legacy Race');
    const destRaw = validScenarioJson('race', 'Canonical Race');
    const src = join(legacy, 'race.scenario.json');
    const dest = join(canonical, 'race.scenario.json');
    await writeFile(src, legacyRaw, 'utf8');

    const base = realFs();
    const io: ScenarioStorageFs = {
      ...base,
      open: async (p, flags) => {
        if (flags === 'wx') {
          // Concurrent writer created differing dest between check and open.
          await writeFile(dest, destRaw, 'utf8');
          throw errno('EEXIST', 'file exists');
        }
        return base.open(p, flags);
      },
    };

    const result = await migrateLegacyScenariosIfNeeded(ws, { fs: io });
    assert.equal(result.status, 'MigrationSucceededWithConflicts');
    assert.equal(result.conflictFiles.length, 1);
    assert.equal(await readFile(dest, 'utf8'), destRaw);
    assert.equal(await readFile(src, 'utf8'), legacyRaw);
  });

  test('COPYFILE_EXCL conflict maps to conflict_kept', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-excl-'));
    const legacy = legacyScenariosRootPath(ws);
    const canonical = scenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await mkdir(canonical, { recursive: true });

    const legacyRaw = validScenarioJson('excl', 'Legacy Excl');
    const destRaw = validScenarioJson('excl', 'Dest Excl');
    const src = join(legacy, 'excl.scenario.json');
    const dest = join(canonical, 'excl.scenario.json');
    await writeFile(src, legacyRaw, 'utf8');
    await writeFile(dest, destRaw, 'utf8');

    const outcome = await copyScenarioFileExclusive(src, dest, realFs());
    assert.equal(outcome, 'conflict_kept');
    assert.equal(await readFile(dest, 'utf8'), destRaw);
    assert.equal(await readFile(src, 'utf8'), legacyRaw);
  });

  test('repeated migration after partial failure retries remaining', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-retry-'));
    const legacy = legacyScenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await writeFile(
      join(legacy, 'a.scenario.json'),
      validScenarioJson('a', 'A'),
      'utf8',
    );
    await writeFile(
      join(legacy, 'b.scenario.json'),
      validScenarioJson('b', 'B'),
      'utf8',
    );

    const base = realFs();
    let renameCount = 0;
    const failingIo: ScenarioStorageFs = {
      ...base,
      rename: async (s, d) => {
        renameCount += 1;
        if (renameCount >= 2) {
          throw errno('EIO', 'fail second');
        }
        return base.rename(s, d);
      },
    };

    const partial = await migrateLegacyScenariosIfNeeded(ws, { fs: failingIo });
    assert.equal(partial.status, 'MigrationPartiallySucceeded');
    assert.equal(await pathExists(join(legacy, 'b.scenario.json')), true);

    const recovered = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(recovered.status, 'MigrationSucceeded');
    assert.equal(await pathExists(legacy), false);
    assert.equal(
      await pathExists(join(scenariosRootPath(ws), 'b.scenario.json')),
      true,
    );
  });

  test('migration result states cover each status enum value', async () => {
    const seen = new Set<string>();

    // NoMigrationNeeded
    {
      const ws = await mkdtemp(join(tmpdir(), 'api-hero-status-none-'));
      const r = await migrateLegacyScenariosIfNeeded(ws);
      assert.equal(r.status, 'NoMigrationNeeded');
      seen.add(r.status);
    }

    // MigrationSucceeded
    {
      const ws = await mkdtemp(join(tmpdir(), 'api-hero-status-ok-'));
      const legacy = legacyScenariosRootPath(ws);
      await mkdir(legacy, { recursive: true });
      await writeFile(
        join(legacy, 'ok.scenario.json'),
        validScenarioJson('ok', 'Ok'),
        'utf8',
      );
      const r = await migrateLegacyScenariosIfNeeded(ws);
      assert.equal(r.status, 'MigrationSucceeded');
      seen.add(r.status);
    }

    // MigrationSucceededWithConflicts
    {
      const ws = await mkdtemp(join(tmpdir(), 'api-hero-status-conflict-'));
      const legacy = legacyScenariosRootPath(ws);
      const canonical = scenariosRootPath(ws);
      await mkdir(legacy, { recursive: true });
      await mkdir(canonical, { recursive: true });
      await writeFile(
        join(canonical, 'c.scenario.json'),
        validScenarioJson('c', 'Canon'),
        'utf8',
      );
      await writeFile(
        join(legacy, 'c.scenario.json'),
        validScenarioJson('c', 'Legacy'),
        'utf8',
      );
      const r = await migrateLegacyScenariosIfNeeded(ws);
      assert.equal(r.status, 'MigrationSucceededWithConflicts');
      seen.add(r.status);
    }

    // MigrationFailed
    {
      const ws = await mkdtemp(join(tmpdir(), 'api-hero-status-fail-'));
      const legacy = legacyScenariosRootPath(ws);
      await mkdir(legacy, { recursive: true });
      await writeFile(
        join(legacy, 'f.scenario.json'),
        validScenarioJson('f', 'F'),
        'utf8',
      );
      const base = realFs();
      const r = await migrateLegacyScenariosIfNeeded(ws, {
        fs: {
          ...base,
          rename: async () => {
            throw errno('EIO', 'fail');
          },
        },
      });
      assert.equal(r.status, 'MigrationFailed');
      seen.add(r.status);
    }

    // MigrationPartiallySucceeded
    {
      const ws = await mkdtemp(join(tmpdir(), 'api-hero-status-partial-'));
      const legacy = legacyScenariosRootPath(ws);
      await mkdir(legacy, { recursive: true });
      await writeFile(
        join(legacy, 'a.scenario.json'),
        validScenarioJson('a', 'A'),
        'utf8',
      );
      await writeFile(
        join(legacy, 'b.scenario.json'),
        validScenarioJson('b', 'B'),
        'utf8',
      );
      const base = realFs();
      let n = 0;
      const r = await migrateLegacyScenariosIfNeeded(ws, {
        fs: {
          ...base,
          rename: async (s, d) => {
            n += 1;
            if (n >= 2) throw errno('EIO', 'fail');
            return base.rename(s, d);
          },
        },
      });
      assert.equal(r.status, 'MigrationPartiallySucceeded');
      seen.add(r.status);
    }

    assert.deepEqual(
      [...seen].sort(),
      [
        'MigrationFailed',
        'MigrationPartiallySucceeded',
        'MigrationSucceeded',
        'MigrationSucceededWithConflicts',
        'NoMigrationNeeded',
      ],
    );
  });

  test('canonical wins when same relative path exists under both discovery roots', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'api-hero-mig-merge-prefer-'));
    const legacy = legacyScenariosRootPath(ws);
    const canonical = scenariosRootPath(ws);
    await mkdir(legacy, { recursive: true });
    await mkdir(canonical, { recursive: true });

    await writeFile(
      join(canonical, 'shared.scenario.json'),
      validScenarioJson('shared', 'From Canonical'),
      'utf8',
    );
    await writeFile(
      join(legacy, 'shared.scenario.json'),
      validScenarioJson('shared', 'From Legacy'),
      'utf8',
    );
    await writeFile(
      join(legacy, 'only-legacy.scenario.json'),
      validScenarioJson('only-legacy', 'Only Legacy'),
      'utf8',
    );

    const migration = await migrateLegacyScenariosIfNeeded(ws);
    assert.equal(migration.status, 'MigrationSucceededWithConflicts');

    const discovered = await discoverScenariosInDiscoveryRoots(migration);
    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 2);
    const shared = discovered.scenarios.find((s) => s.id === 'shared');
    assert.equal(shared?.name, 'From Canonical');
    assert.ok(
      discovered.files.some((f) =>
        f.replace(/\\/g, '/').includes('.apihero/scenarios/shared.scenario.json'),
      ),
    );
  });
});
