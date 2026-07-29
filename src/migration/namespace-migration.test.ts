import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONFIGURATION_SECTION,
  LEGACY_CONFIGURATION_SECTION,
} from '../constants';
import {
  CONFIGURATION_MIGRATION_FLAG,
  migrateConfigurationNamespace,
  MigrationConfigurationTarget,
  type MigratableConfiguration,
  type NamespaceMigrationPorts,
} from './namespace-migration';

interface InspectRecord {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

class FakeMemento {
  private readonly store = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }
}

class FakeConfiguration implements MigratableConfiguration {
  public constructor(private readonly values: Map<string, InspectRecord>) {}

  public inspect(key: string): InspectRecord | undefined {
    return this.values.get(key);
  }

  public async update(
    key: string,
    value: unknown,
    target: MigrationConfigurationTarget,
  ): Promise<void> {
    const field =
      target === MigrationConfigurationTarget.Workspace
        ? 'workspaceValue'
        : target === MigrationConfigurationTarget.WorkspaceFolder
          ? 'workspaceFolderValue'
          : 'globalValue';
    const current = this.values.get(key) ?? {};
    if (value === undefined) {
      const next = { ...current };
      delete next[field];
      if (
        next.globalValue === undefined &&
        next.workspaceValue === undefined &&
        next.workspaceFolderValue === undefined
      ) {
        this.values.delete(key);
      } else {
        this.values.set(key, next);
      }
      return;
    }
    this.values.set(key, { ...current, [field]: value });
  }
}

function createPorts(
  legacyValues: Map<string, InspectRecord>,
  canonicalValues: Map<string, InspectRecord>,
): NamespaceMigrationPorts {
  const legacy = new FakeConfiguration(legacyValues);
  const canonical = new FakeConfiguration(canonicalValues);
  return {
    getConfiguration: (section: string) => {
      if (section === LEGACY_CONFIGURATION_SECTION) {
        return legacy;
      }
      assert.equal(section, CONFIGURATION_SECTION);
      return canonical;
    },
    workspaceFolders: undefined,
  };
}

test('migrateConfigurationNamespace copies legacy values then clears them', async () => {
  const legacyValues = new Map<string, InspectRecord>([
    ['logLevel', { globalValue: 'debug' }],
    ['requestTimeout', { workspaceValue: 12_000 }],
  ]);
  const canonicalValues = new Map<string, InspectRecord>();
  const globalState = new FakeMemento();

  const first = await migrateConfigurationNamespace(
    globalState,
    createPorts(legacyValues, canonicalValues),
  );
  assert.equal(first.skipped, false);
  assert.equal(first.copiedKeys, 2);
  assert.equal(first.clearedKeys, 2);
  assert.equal(canonicalValues.get('logLevel')?.globalValue, 'debug');
  assert.equal(canonicalValues.get('requestTimeout')?.workspaceValue, 12_000);
  assert.equal(legacyValues.has('logLevel'), false);
  assert.equal(legacyValues.has('requestTimeout'), false);
  assert.equal(globalState.get(CONFIGURATION_MIGRATION_FLAG), true);

  const second = await migrateConfigurationNamespace(
    globalState,
    createPorts(legacyValues, canonicalValues),
  );
  assert.equal(second.skipped, false);
  assert.equal(second.copiedKeys, 0);
  assert.equal(second.clearedKeys, 0);
});

test('migrateConfigurationNamespace still copies when flag was set earlier', async () => {
  const legacyValues = new Map<string, InspectRecord>([
    ['logLevel', { globalValue: 'warn' }],
  ]);
  const canonicalValues = new Map<string, InspectRecord>();
  const globalState = new FakeMemento();
  await globalState.update(CONFIGURATION_MIGRATION_FLAG, true);

  const result = await migrateConfigurationNamespace(
    globalState,
    createPorts(legacyValues, canonicalValues),
  );
  assert.equal(result.copiedKeys, 1);
  assert.equal(canonicalValues.get('logLevel')?.globalValue, 'warn');
  assert.equal(legacyValues.has('logLevel'), false);
});

test('migrateConfigurationNamespace does not overwrite existing canonical values', async () => {
  const legacyValues = new Map<string, InspectRecord>([
    ['logLevel', { globalValue: 'debug' }],
  ]);
  const canonicalValues = new Map<string, InspectRecord>([
    ['logLevel', { globalValue: 'error' }],
  ]);
  const globalState = new FakeMemento();

  const result = await migrateConfigurationNamespace(
    globalState,
    createPorts(legacyValues, canonicalValues),
  );
  assert.equal(result.copiedKeys, 0);
  assert.equal(result.clearedKeys, 1);
  assert.equal(canonicalValues.get('logLevel')?.globalValue, 'error');
  assert.equal(legacyValues.has('logLevel'), false);
});
