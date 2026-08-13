/**
 * API Hero Project Package v1 constants.
 * Format version is independent of the application version.
 */

export const PROJECT_PACKAGE_FORMAT = 'apihero-project';

export const PROJECT_PACKAGE_KIND = 'project';

/** Independently versioned package format. Not the API Hero app version. */
export const PROJECT_PACKAGE_FORMAT_VERSION = 1;

export const PROJECT_PACKAGE_FILE_EXTENSION = '.apihero';

export const MANIFEST_ENTRY_NAME = 'manifest.json';

export const PROJECT_ROOT_PREFIX = 'project';

/** Temporary import staging directory under `.apihero/`. Never packaged. */
export const IMPORT_STAGING_DIRECTORY_NAME = '.pkg-import';

/** Uncompressed archive payload cap (50 MiB). */
export const MAX_PACKAGE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Per-entry uncompressed cap (8 MiB). */
export const MAX_PACKAGE_FILE_BYTES = 8 * 1024 * 1024;

/** Maximum files in a package, including the manifest. */
export const MAX_PACKAGE_ENTRIES = 5_000;

export const SKIP_DIRECTORY_NAMES = Object.freeze([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.vscode',
] as const);
