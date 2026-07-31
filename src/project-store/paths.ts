/**
 * Pure path helpers for the `.apihero` project store.
 * Uses the same `/`-normalized join rules as collections.
 */

import { joinPathKey } from '../collections/models';
import {
  APIHERO_DIRECTORY_NAME,
  AUTH_DIRECTORY_NAME,
  AUTH_PROFILES_FILENAME,
  CACHE_DIRECTORY_NAME,
  CONFIG_RELATIVE_PATH,
  ENVIRONMENTS_DIRECTORY_NAME,
  HISTORY_DIRECTORY_NAME,
  LOCAL_DIRECTORY_NAME,
  MIGRATION_BACKUP_FILENAME,
  SCENARIOS_DIRECTORY_NAME,
  VARIABLES_LOCAL_FILENAME,
  WORKSPACE_RELATIVE_PATH,
} from './constants';

/** Absolute (or URI) path to `.apihero` under a workspace folder. */
export function projectStoreRootPath(workspaceRootPath: string): string {
  return joinPathKey(workspaceRootPath, APIHERO_DIRECTORY_NAME);
}

export function configPath(workspaceRootPath: string): string {
  return joinPathKey(projectStoreRootPath(workspaceRootPath), CONFIG_RELATIVE_PATH);
}

export function workspaceDocumentPath(workspaceRootPath: string): string {
  return joinPathKey(
    projectStoreRootPath(workspaceRootPath),
    WORKSPACE_RELATIVE_PATH,
  );
}

export function environmentsDirectoryPath(workspaceRootPath: string): string {
  return joinPathKey(
    projectStoreRootPath(workspaceRootPath),
    ENVIRONMENTS_DIRECTORY_NAME,
  );
}

export function environmentDocumentPath(
  workspaceRootPath: string,
  environmentId: string,
): string {
  return joinPathKey(
    environmentsDirectoryPath(workspaceRootPath),
    `${sanitizeEnvironmentFileStem(environmentId)}.json`,
  );
}

export function authDirectoryPath(workspaceRootPath: string): string {
  return joinPathKey(projectStoreRootPath(workspaceRootPath), AUTH_DIRECTORY_NAME);
}

/** Absolute (or URI) path to `.apihero/scenarios` under a workspace folder. */
export function scenariosDirectoryPath(workspaceRootPath: string): string {
  return joinPathKey(
    projectStoreRootPath(workspaceRootPath),
    SCENARIOS_DIRECTORY_NAME,
  );
}

export function authProfilesPath(workspaceRootPath: string): string {
  return joinPathKey(authDirectoryPath(workspaceRootPath), AUTH_PROFILES_FILENAME);
}

export function localDirectoryPath(workspaceRootPath: string): string {
  return joinPathKey(projectStoreRootPath(workspaceRootPath), LOCAL_DIRECTORY_NAME);
}

export function cacheDirectoryPath(workspaceRootPath: string): string {
  return joinPathKey(projectStoreRootPath(workspaceRootPath), CACHE_DIRECTORY_NAME);
}

export function historyDirectoryPath(workspaceRootPath: string): string {
  return joinPathKey(projectStoreRootPath(workspaceRootPath), HISTORY_DIRECTORY_NAME);
}

export function migrationBackupPath(workspaceRootPath: string): string {
  return joinPathKey(localDirectoryPath(workspaceRootPath), MIGRATION_BACKUP_FILENAME);
}

export function variablesLocalPath(workspaceRootPath: string): string {
  return joinPathKey(localDirectoryPath(workspaceRootPath), VARIABLES_LOCAL_FILENAME);
}

export function gitignorePath(workspaceRootPath: string): string {
  return joinPathKey(workspaceRootPath, '.gitignore');
}

const UNSAFE_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/**
 * Sanitizes an environment id for use as a filename stem.
 * Replaces unsafe path characters; never returns empty.
 */
export function sanitizeEnvironmentFileStem(rawId: string): string {
  const trimmed = rawId.trim();
  let sanitized = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch.charCodeAt(0) <= 0x1f || UNSAFE_FILENAME_CHARS.has(ch)) {
      sanitized += '_';
    } else {
      sanitized += ch;
    }
  }
  const replaced = sanitized.replace(/\.+$/g, '').replace(/\s+$/g, '');
  if (replaced.length === 0) {
    return 'environment';
  }
  return replaced;
}
