export { COMMAND_IDS, LEGACY_COMMAND_IDS, toLegacyCommandId } from './commands';
export type { CommandId, LegacyCommandId } from './commands';
export {
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
  DEFAULT_CONFIGURATION,
  flattenConfigurationKeys,
  LEGACY_CONFIGURATION_SECTION,
  normalizeHistoryMaxEntries,
  normalizeImportMaxFileBytes,
  normalizeMaxResponseBytes,
} from './configuration';
export type { ConfigurationKey } from './configuration';
export { EXTENSION_ID, EXTENSION_NAME } from './extension';
export {
  AUTH_SECRET_KEY_PREFIX,
  authenticationSecretKey,
  LEGACY_AUTH_SECRET_KEY_PREFIX,
  legacyAuthenticationSecretKey,
} from './secrets';
export { SECRET_STORAGE_KEYS, STORAGE_KEYS } from './storage';
export type { SecretStorageKey, StorageKey } from './storage';
export {
  ACTIVITY_BAR_CONTAINER_ID,
  COLLECTIONS_TREE_MIME_TYPE,
  LEGACY_REQUEST_EDITOR_VIEW_TYPE,
  REQUEST_EDITOR_VIEW_TYPE,
  VIEW_IDS,
} from './views';
export type { ViewId } from './views';
