/** Stable identifiers reserved for API Runner views. */
export const VIEW_IDS = {
  /** Activity Bar collections explorer. */
  collections: 'apiRunner.collections',
  /** Activity Bar request history explorer. */
  history: 'apiRunner.history',
  /** Reserved for a future generic explorer surface. */
  explorer: 'apiRunner.explorer',
} as const;

/** An API Runner view identifier. */
export type ViewId = (typeof VIEW_IDS)[keyof typeof VIEW_IDS];
