/**
 * One-shot migration of User / Workspace / WorkspaceFolder settings from the
 * legacy `apiRunner` configuration section to canonical `apiHero`.
 *
 * Lives at the VS Code / storage edge — not in core, parser, or orchestration.
 * Runtime `vscode` is loaded only via {@link createVsCodeNamespaceMigrationPorts}
 * so unit tests can exercise the migrator without the VS Code module.
 */

import {
  flattenConfigurationKeys,
  CONFIGURATION_SECTION,
  LEGACY_CONFIGURATION_SECTION,
} from '../constants';

/** globalState flag set after a successful (or no-op) configuration migration. */
export const CONFIGURATION_MIGRATION_FLAG =
  'apiHero.migration.configuration.v1';

/**
 * Mirrors `vscode.ConfigurationTarget` numeric values so this module stays
 * free of a hard `vscode` import (required for Node unit tests).
 */
export const MigrationConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

export type MigrationConfigurationTarget =
  (typeof MigrationConfigurationTarget)[keyof typeof MigrationConfigurationTarget];

export interface NamespaceMigrationResult {
  readonly skipped: boolean;
  readonly copiedKeys: number;
  readonly clearedKeys: number;
}

/** Minimal configuration surface used by the migrator (and unit tests). */
export interface MigratableConfiguration {
  inspect(key: string):
    | {
        readonly globalValue?: unknown;
        readonly workspaceValue?: unknown;
        readonly workspaceFolderValue?: unknown;
      }
    | undefined;
  update(
    key: string,
    value: unknown,
    target: MigrationConfigurationTarget,
  ): Thenable<void>;
}

export interface NamespaceMigrationPorts {
  readonly getConfiguration: (
    section: string,
    resource?: unknown,
  ) => MigratableConfiguration;
  readonly workspaceFolders: readonly { readonly uri: unknown }[] | undefined;
}

export interface NamespaceMigrationState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/**
 * Copies inspected legacy `apiRunner.*` settings into `apiHero.*` when the
 * new key has no value at that target, then clears the legacy value.
 *
 * Always scans (does not skip solely because {@link CONFIGURATION_MIGRATION_FLAG}
 * is set) so Settings Sync can deliver legacy keys after a prior no-op pass.
 * The flag records that at least one successful scan completed.
 */
export async function migrateConfigurationNamespace(
  globalState: NamespaceMigrationState,
  ports: NamespaceMigrationPorts,
): Promise<NamespaceMigrationResult> {
  const keys = flattenConfigurationKeys();
  let copiedKeys = 0;
  let clearedKeys = 0;

  const targets: readonly {
    readonly target: MigrationConfigurationTarget;
    readonly folderUri?: unknown;
  }[] = [
    { target: MigrationConfigurationTarget.Global },
    { target: MigrationConfigurationTarget.Workspace },
    ...(ports.workspaceFolders ?? []).map((folder) => ({
      target: MigrationConfigurationTarget.WorkspaceFolder,
      folderUri: folder.uri,
    })),
  ];

  for (const { target, folderUri } of targets) {
    const legacy = ports.getConfiguration(
      LEGACY_CONFIGURATION_SECTION,
      folderUri,
    );
    const canonical = ports.getConfiguration(
      CONFIGURATION_SECTION,
      folderUri,
    );

    for (const key of keys) {
      const result = await migrateKeyAtTarget(legacy, canonical, key, target);
      copiedKeys += result.copied ? 1 : 0;
      clearedKeys += result.cleared ? 1 : 0;
    }
  }

  await globalState.update(CONFIGURATION_MIGRATION_FLAG, true);
  return {
    skipped: false,
    copiedKeys,
    clearedKeys,
  };
}

/**
 * Builds ports backed by the live VS Code workspace APIs. Call from activate
 * only — keeps this module loadable under Node unit tests.
 */
export function createVsCodeNamespaceMigrationPorts(): NamespaceMigrationPorts {
  // Lazy require: unit tests never call this helper.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require('vscode') as typeof import('vscode');
  return {
    getConfiguration: (section, resource) =>
      vscode.workspace.getConfiguration(
        section,
        resource as import('vscode').Uri | undefined,
      ),
    workspaceFolders: vscode.workspace.workspaceFolders,
  };
}

async function migrateKeyAtTarget(
  legacy: MigratableConfiguration,
  canonical: MigratableConfiguration,
  key: string,
  target: MigrationConfigurationTarget,
): Promise<{ readonly copied: boolean; readonly cleared: boolean }> {
  const legacyInspect = legacy.inspect(key);
  if (legacyInspect === undefined) {
    return { copied: false, cleared: false };
  }

  const legacyValue = valueAtTarget(legacyInspect, target);
  if (legacyValue === undefined) {
    return { copied: false, cleared: false };
  }

  const canonicalInspect = canonical.inspect(key);
  const canonicalValue =
    canonicalInspect === undefined
      ? undefined
      : valueAtTarget(canonicalInspect, target);

  let copied = false;
  if (canonicalValue === undefined) {
    await canonical.update(key, legacyValue, target);
    copied = true;
  }

  await legacy.update(key, undefined, target);
  return { copied, cleared: true };
}

function valueAtTarget(
  inspect: {
    readonly globalValue?: unknown;
    readonly workspaceValue?: unknown;
    readonly workspaceFolderValue?: unknown;
  },
  target: MigrationConfigurationTarget,
): unknown {
  switch (target) {
    case MigrationConfigurationTarget.Global:
      return inspect.globalValue;
    case MigrationConfigurationTarget.Workspace:
      return inspect.workspaceValue;
    case MigrationConfigurationTarget.WorkspaceFolder:
      return inspect.workspaceFolderValue;
    default:
      return undefined;
  }
}
