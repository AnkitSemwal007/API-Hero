/**
 * Public exports for the `.apihero` project store domain module.
 */

export {
  APIHERO_DIRECTORY_NAME,
  AUTH_DIRECTORY_NAME,
  AUTH_PROFILES_FILENAME,
  CACHE_DIRECTORY_NAME,
  CONFIG_RELATIVE_PATH,
  DEFAULT_COLLECTIONS_DIRECTORY,
  ENVIRONMENTS_DIRECTORY_NAME,
  HISTORY_DIRECTORY_NAME,
  LOCAL_DIRECTORY_NAME,
  MIGRATION_BACKUP_FILENAME,
  PROJECT_STORE_GITIGNORE_LINES,
  PROJECT_STORE_SCHEMA_VERSION,
  SCENARIOS_DIRECTORY_NAME,
  VARIABLES_LOCAL_FILENAME,
  WORKSPACE_RELATIVE_PATH,
} from './constants';
export { ensureProjectStoreGitignore } from './ensure-gitignore';
export {
  hasMigratableSettings,
  migrateIfNeeded,
} from './migrate';
export type {
  MigrateIfNeededOptions,
  MigrateIfNeededResult,
} from './migrate';
export {
  authProfilesPath,
  configPath,
  environmentDocumentPath,
  environmentsDirectoryPath,
  gitignorePath,
  migrationBackupPath,
  projectStoreRootPath,
  sanitizeEnvironmentFileStem,
  scenariosDirectoryPath,
  variablesLocalPath,
  workspaceDocumentPath,
} from './paths';
export type {
  ProjectStoreDirectoryEntry,
  ProjectStoreFilesystem,
} from './ports';
export {
  parseAuthProfilesDocument,
  parseConfigDocument,
  parseEnvironmentDocument,
  parseWorkspaceDocument,
} from './parse';
export {
  readVariablesLocalOverlay,
  writeVariablesLocalOverlay,
} from './variables-local';
export {
  ProjectStoreService,
} from './project-store-service';
export type { ProjectStoreServiceOptions } from './project-store-service';
export {
  resetWorkspaceStore,
} from './reset-workspace';
export type {
  ResetWorkspaceFailure,
  ResetWorkspaceStoreComponent,
  ResetWorkspaceStoreResult,
} from './reset-workspace';
export type {
  AuthProfilesDocument,
  ConfigDocument,
  EnvironmentDocument,
  LegacySettingsSnapshot,
  MigrationBackupDocument,
  MigrationOutcome,
  ProjectMetadataSnapshot,
  ProjectStoreVariable,
  VariablesLocalDocument,
  WorkspaceDocument,
} from './types';
