/**
 * Pure-ish migrator: settings snapshot + folder path + filesystem → result.
 * Writes backup first, content next, `config.json` last (completion marker).
 * Never touches Collections/, SecretStorage, or global variables.
 */

import { randomUUID } from 'node:crypto';

import { COLLECTIONS_DIRECTORY_NAME } from '../collections/constants';
import { joinPathKey } from '../collections/models';
import { DEFAULT_COLLECTIONS_DIRECTORY } from './constants';
import { ensureProjectStoreGitignore } from './ensure-gitignore';
import { parseConfigDocument } from './parse';
import {
  authDirectoryPath,
  authProfilesPath,
  cacheDirectoryPath,
  configPath,
  environmentDocumentPath,
  environmentsDirectoryPath,
  historyDirectoryPath,
  localDirectoryPath,
  migrationBackupPath,
  projectStoreRootPath,
  sanitizeEnvironmentFileStem,
  workspaceDocumentPath,
} from './paths';
import type { ProjectStoreFilesystem } from './ports';
import {
  serializeJson,
  toAuthProfilesDocument,
  toConfigDocument,
  toEnvironmentDocument,
  toMigrationBackupDocument,
  toWorkspaceDocument,
} from './serialize';
import type {
  LegacySettingsSnapshot,
  MigrationOutcome,
} from './types';
import {
  emptyVariablesLocalDocument,
  environmentsSensitiveOverlay,
  workspaceSensitiveOverlay,
  writeVariablesLocalOverlay,
} from './variables-local';

export interface MigrateIfNeededOptions {
  readonly filesystem: ProjectStoreFilesystem;
  readonly workspaceRootPath: string;
  readonly settings: LegacySettingsSnapshot;
  /**
   * When true, this folder may receive a settings migration.
   * Only the primary workspace folder (`workspaceFolders[0]`) should pass true.
   */
  readonly allowSettingsMigration: boolean;
  /** Force a minimal store even when the folder has no legacy data. */
  readonly forceInitialize?: boolean;
  readonly now?: () => Date;
  readonly createProjectId?: () => string;
}

export interface MigrateIfNeededResult {
  readonly outcome: MigrationOutcome;
  readonly backupWritten: boolean;
}

/**
 * Idempotent migration / init for one workspace folder.
 *
 * - Valid `config.json` → no-op (optionally ensures gitignore).
 * - Migratable legacy data + `allowSettingsMigration` → backup + write + config.
 * - Folder with `Collections/` but `allowSettingsMigration === false` → empty
 *   / minimal store (`initialized`), never clone workspace settings.
 * - `forceInitialize` → minimal store when otherwise empty.
 * - Empty folder with no legacy data → skip.
 */
export async function migrateIfNeeded(
  options: MigrateIfNeededOptions,
): Promise<MigrateIfNeededResult> {
  const {
    filesystem,
    workspaceRootPath,
    settings,
    allowSettingsMigration,
    forceInitialize = false,
  } = options;
  const now = options.now ?? (() => new Date());
  const createProjectId = options.createProjectId ?? (() => randomUUID());

  if (await hasValidConfig(filesystem, workspaceRootPath)) {
    await ensureProjectStoreGitignore(filesystem, workspaceRootPath).catch(
      () => undefined,
    );
    return {
      outcome: { status: 'skipped-already-migrated' },
      backupWritten: false,
    };
  }

  const collectionsPath = joinPathKey(
    workspaceRootPath,
    COLLECTIONS_DIRECTORY_NAME,
  );
  const hasCollections = await filesystem.exists(collectionsPath);
  const hasSettingsData = hasMigratableSettings(settings);
  // Settings clone only when explicitly allowed (primary folder ownership).
  // Collections presence alone must NOT pull workspace settings into a
  // secondary root.
  const shouldMigrateSettings = hasSettingsData && allowSettingsMigration;

  if (!forceInitialize && !hasCollections && !shouldMigrateSettings) {
    return {
      outcome: { status: 'skipped-empty' },
      backupWritten: false,
    };
  }

  const projectId = createProjectId();
  let backupWritten = false;

  // Ensure ignore rules before any local/ backup that may hold sensitive values.
  await ensureStoreDirectories(filesystem, workspaceRootPath);
  await ensureProjectStoreGitignore(filesystem, workspaceRootPath);

  if (shouldMigrateSettings) {
    backupWritten = await writeBackupWithRetry(
      filesystem,
      workspaceRootPath,
      settings,
      now().toISOString(),
    );
  }

  const environments = shouldMigrateSettings ? settings.environments : [];
  await writeEnvironmentFiles(filesystem, workspaceRootPath, environments);

  await filesystem.writeText(
    workspaceDocumentPath(workspaceRootPath),
    serializeJson(
      toWorkspaceDocument(
        shouldMigrateSettings ? settings.workspaceVariables : [],
        shouldMigrateSettings ? settings.activeEnvironmentId : undefined,
      ),
    ),
  );

  await filesystem.writeText(
    authProfilesPath(workspaceRootPath),
    serializeJson(
      toAuthProfilesDocument(
        shouldMigrateSettings ? settings.authenticationProfiles : [],
      ),
    ),
  );

  if (shouldMigrateSettings) {
    await writeVariablesLocalOverlay(filesystem, workspaceRootPath, {
      ...emptyVariablesLocalDocument(),
      workspace: workspaceSensitiveOverlay(settings.workspaceVariables),
      environments: environmentsSensitiveOverlay(settings.environments),
    });
  }

  // config.json last — migration-complete marker for idempotent retries.
  await filesystem.writeText(
    configPath(workspaceRootPath),
    serializeJson(
      toConfigDocument(projectId, DEFAULT_COLLECTIONS_DIRECTORY),
    ),
  );

  return {
    outcome: {
      status: shouldMigrateSettings ? 'migrated' : 'initialized',
      projectId,
    },
    backupWritten,
  };
}

export function hasMigratableSettings(
  settings: LegacySettingsSnapshot,
): boolean {
  return (
    settings.environments.length > 0 ||
    settings.workspaceVariables.length > 0 ||
    settings.authenticationProfiles.length > 0 ||
    (settings.activeEnvironmentId !== undefined &&
      settings.activeEnvironmentId.trim().length > 0)
  );
}

async function hasValidConfig(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
): Promise<boolean> {
  const path = configPath(workspaceRootPath);
  if (!(await filesystem.exists(path))) {
    return false;
  }
  try {
    const text = await filesystem.readText(path);
    return parseConfigDocument(text) !== undefined;
  } catch {
    return false;
  }
}

async function ensureStoreDirectories(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
): Promise<void> {
  await filesystem.createDirectory(projectStoreRootPath(workspaceRootPath));
  await filesystem.createDirectory(environmentsDirectoryPath(workspaceRootPath));
  await filesystem.createDirectory(authDirectoryPath(workspaceRootPath));
  await filesystem.createDirectory(localDirectoryPath(workspaceRootPath));
  await filesystem.createDirectory(cacheDirectoryPath(workspaceRootPath));
  await filesystem.createDirectory(historyDirectoryPath(workspaceRootPath));
}

async function writeEnvironmentFiles(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
  environments: LegacySettingsSnapshot['environments'],
): Promise<void> {
  const usedStems = new Set<string>();
  for (const environment of environments) {
    const stem = allocateUniqueStem(environment.id, usedStems);
    usedStems.add(stem);
    const path = joinPathKey(
      environmentsDirectoryPath(workspaceRootPath),
      `${stem}.json`,
    );
    // Prefer helper path when stem matches sanitize (common case).
    const preferred = environmentDocumentPath(workspaceRootPath, environment.id);
    const target = stem === sanitizeEnvironmentFileStem(environment.id)
      ? preferred
      : path;
    await filesystem.writeText(
      target,
      serializeJson(toEnvironmentDocument(environment)),
    );
  }
}

function allocateUniqueStem(id: string, used: ReadonlySet<string>): string {
  const base = sanitizeEnvironmentFileStem(id);
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

async function writeBackupWithRetry(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
  settings: LegacySettingsSnapshot,
  migratedAt: string,
): Promise<boolean> {
  const path = migrationBackupPath(workspaceRootPath);
  const body = serializeJson(
    toMigrationBackupDocument({
      migratedAt,
      environments: settings.environments,
      workspaceVariables: settings.workspaceVariables,
      activeEnvironmentId: settings.activeEnvironmentId,
      authenticationProfiles: settings.authenticationProfiles,
    }),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await filesystem.createDirectory(localDirectoryPath(workspaceRootPath));
      await filesystem.writeText(path, body);
      return true;
    } catch {
      // Prefer succeeding backup first; one retry then continue migration.
    }
  }
  return false;
}

