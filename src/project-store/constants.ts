/**
 * Filesystem layout conventions for the `.apihero` project store.
 * Domain code shares these strings; VS Code adapters must not invent aliases.
 */

import { COLLECTIONS_DIRECTORY_NAME } from '../collections/constants';

/** Project store directory under each workspace folder. */
export const APIHERO_DIRECTORY_NAME = '.apihero';

/** Current `config.json` schema version. */
export const PROJECT_STORE_SCHEMA_VERSION = 1;

/** Relative path to the project identity / migration marker. */
export const CONFIG_RELATIVE_PATH = 'config.json';

/** Relative path to workspace variables + active environment. */
export const WORKSPACE_RELATIVE_PATH = 'workspace.json';

/** Relative directory for per-environment JSON documents. */
export const ENVIRONMENTS_DIRECTORY_NAME = 'environments';

/** Relative directory for auth metadata. */
export const AUTH_DIRECTORY_NAME = 'auth';

/** Relative directory for scenario documents under the project store. */
export const SCENARIOS_DIRECTORY_NAME = 'scenarios';

/** Auth profiles metadata filename under `auth/`. */
export const AUTH_PROFILES_FILENAME = 'profiles.json';

/** Gitignored local overlays / migration backup. */
export const LOCAL_DIRECTORY_NAME = 'local';

/** Gitignored derived cache (reserved). */
export const CACHE_DIRECTORY_NAME = 'cache';

/** Gitignored project history (Phase 4 deferred). */
export const HISTORY_DIRECTORY_NAME = 'history';

/** Stable migration backup filename under `local/`. */
export const MIGRATION_BACKUP_FILENAME = 'migration-backup.json';

/**
 * Gitignored overlay for sensitive variable values.
 * Tracked env/workspace docs store empty values for `sensitive: true` rows.
 */
export const VARIABLES_LOCAL_FILENAME = 'variables.local.json';

/** Default collections directory recorded in `config.json`. */
export const DEFAULT_COLLECTIONS_DIRECTORY = COLLECTIONS_DIRECTORY_NAME;

/**
 * Lines that must appear in the workspace `.gitignore` when a project store
 * is initialized or migrated. Appended idempotently.
 */
export const PROJECT_STORE_GITIGNORE_LINES = Object.freeze([
  '.apihero/local/',
  '.apihero/cache/',
  '.apihero/history/',
] as const);
