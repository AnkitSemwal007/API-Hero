/** Stable keys used with extension-owned persistent storage. */
export const STORAGE_KEYS = {
  activeEnvironmentId: 'activeEnvironmentId',
  /** Relative file name under globalStorageUri for request history. */
  requestHistoryFile: 'request-history.json',
} as const;

/** Stable keys used with VS Code secret storage. */
export const SECRET_STORAGE_KEYS = {
  authentication: 'authentication',
} as const;

/** An API Hero persistent storage key. */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** An API Hero secret storage key. */
export type SecretStorageKey =
  (typeof SECRET_STORAGE_KEYS)[keyof typeof SECRET_STORAGE_KEYS];
