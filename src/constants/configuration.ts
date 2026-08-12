/** Root namespace for all API Hero settings. */
export const CONFIGURATION_SECTION = 'apiHero';

/**
 * Legacy settings namespace. Migrated to {@link CONFIGURATION_SECTION} on
 * activate; kept as a constant so migration and docs stay centralized.
 */
export const LEGACY_CONFIGURATION_SECTION = 'apiRunner';

/** Stable keys for settings below the API Hero namespace. */
export const CONFIGURATION_KEYS = {
  logLevel: 'logLevel',
  requestTimeout: 'requestTimeout',
  maxResponseBytes: 'maxResponseBytes',
  globalVariables: 'variables.global',
  workspaceVariables: 'variables.workspace',
  environments: 'environments',
  activeEnvironment: 'activeEnvironment',
  authenticationProfiles: 'authentication.profiles',
  historyMaxEntries: 'history.maxEntries',
  importMaxFileBytes: 'import.maxFileBytes',
  collectionRunnerFailurePolicy: 'collectionRunner.failurePolicy',
  collectionRunnerRetryEnabled: 'collectionRunner.retryEnabled',
  collectionRunnerMaxRetries: 'collectionRunner.maxRetries',
  collectionRunnerRetryDelayMs: 'collectionRunner.retryDelayMs',
  collectionRunnerRetryBackoff: 'collectionRunner.retryBackoff',
  collectionRunnerSkipDestructiveRequests:
    'collectionRunner.skipDestructiveRequests',
  languageFeatures: {
    hover: 'languageFeatures.hover',
    outline: 'languageFeatures.outline',
    diagnostics: 'languageFeatures.diagnostics',
  },
} as const;

/** Defaults mirrored by the extension manifest. */
export const DEFAULT_CONFIGURATION = {
  logLevel: 'info',
  requestTimeout: 30_000,
  /** 10 MiB default caps unbounded response buffering. */
  maxResponseBytes: 10 * 1024 * 1024,
  globalVariables: [],
  workspaceVariables: [],
  environments: [],
  authenticationProfiles: [],
  /** Cap retained history entries (newest kept). */
  historyMaxEntries: 1_000,
  /** Hard upper bound for history retention settings. */
  historyMaxEntriesLimit: 10_000,
  /** Default OpenAPI specification file size cap (5 MiB). */
  importMaxFileBytes: 5 * 1024 * 1024,
  /** Hard upper bound for import file size settings (50 MiB). */
  importMaxFileBytesLimit: 50 * 1024 * 1024,
  /**
   * Collection run failure policy. `ask` prompts each run; other values apply
   * without a QuickPick.
   */
  collectionRunnerFailurePolicy: 'ask',
  collectionRunnerRetryEnabled: false,
  collectionRunnerMaxRetries: 2,
  collectionRunnerRetryDelayMs: 500,
  collectionRunnerRetryBackoff: 'exponential',
  collectionRunnerSkipDestructiveRequests: false,
  languageFeatures: {
    hover: true,
    outline: true,
    diagnostics: true,
  },
} as const;

/**
 * Coerces a settings value to a non-negative safe integer, or the configured
 * default when the value is missing or invalid (e.g. hand-edited floats).
 */
export function normalizeMaxResponseBytes(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return DEFAULT_CONFIGURATION.maxResponseBytes;
}

/**
 * Coerces a settings value to a positive safe integer retention cap, or the
 * configured default when the value is missing or invalid. Values above
 * {@link DEFAULT_CONFIGURATION.historyMaxEntriesLimit} are clamped.
 */
export function normalizeHistoryMaxEntries(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) {
    return Math.min(value, DEFAULT_CONFIGURATION.historyMaxEntriesLimit);
  }
  return DEFAULT_CONFIGURATION.historyMaxEntries;
}

/**
 * Coerces a settings value to a positive safe integer import size cap, or the
 * configured default when the value is missing or invalid. Values above
 * {@link DEFAULT_CONFIGURATION.importMaxFileBytesLimit} are clamped.
 */
export function normalizeImportMaxFileBytes(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) {
    return Math.min(value, DEFAULT_CONFIGURATION.importMaxFileBytesLimit);
  }
  return DEFAULT_CONFIGURATION.importMaxFileBytes;
}

/** A configuration key below the API Hero namespace. */
export type ConfigurationKey =
  | typeof CONFIGURATION_KEYS.logLevel
  | typeof CONFIGURATION_KEYS.requestTimeout
  | typeof CONFIGURATION_KEYS.maxResponseBytes
  | typeof CONFIGURATION_KEYS.historyMaxEntries
  | typeof CONFIGURATION_KEYS.importMaxFileBytes
  | typeof CONFIGURATION_KEYS.collectionRunnerFailurePolicy
  | typeof CONFIGURATION_KEYS.collectionRunnerRetryEnabled
  | typeof CONFIGURATION_KEYS.collectionRunnerMaxRetries
  | typeof CONFIGURATION_KEYS.collectionRunnerRetryDelayMs
  | typeof CONFIGURATION_KEYS.collectionRunnerRetryBackoff
  | typeof CONFIGURATION_KEYS.collectionRunnerSkipDestructiveRequests
  | typeof CONFIGURATION_KEYS.globalVariables
  | typeof CONFIGURATION_KEYS.workspaceVariables
  | typeof CONFIGURATION_KEYS.environments
  | typeof CONFIGURATION_KEYS.activeEnvironment
  | typeof CONFIGURATION_KEYS.authenticationProfiles
  | (typeof CONFIGURATION_KEYS.languageFeatures)[keyof typeof CONFIGURATION_KEYS.languageFeatures];

/**
 * Flat list of relative setting keys under {@link CONFIGURATION_SECTION} /
 * {@link LEGACY_CONFIGURATION_SECTION} for namespace migration.
 */
export function flattenConfigurationKeys(): readonly string[] {
  return [
    CONFIGURATION_KEYS.logLevel,
    CONFIGURATION_KEYS.requestTimeout,
    CONFIGURATION_KEYS.maxResponseBytes,
    CONFIGURATION_KEYS.globalVariables,
    CONFIGURATION_KEYS.workspaceVariables,
    CONFIGURATION_KEYS.environments,
    CONFIGURATION_KEYS.activeEnvironment,
    CONFIGURATION_KEYS.authenticationProfiles,
    CONFIGURATION_KEYS.historyMaxEntries,
    CONFIGURATION_KEYS.importMaxFileBytes,
    CONFIGURATION_KEYS.collectionRunnerFailurePolicy,
    CONFIGURATION_KEYS.collectionRunnerRetryEnabled,
    CONFIGURATION_KEYS.collectionRunnerMaxRetries,
    CONFIGURATION_KEYS.collectionRunnerRetryDelayMs,
    CONFIGURATION_KEYS.collectionRunnerRetryBackoff,
    CONFIGURATION_KEYS.collectionRunnerSkipDestructiveRequests,
    CONFIGURATION_KEYS.languageFeatures.hover,
    CONFIGURATION_KEYS.languageFeatures.outline,
    CONFIGURATION_KEYS.languageFeatures.diagnostics,
  ];
}
