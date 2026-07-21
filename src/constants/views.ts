/** Stable identifiers reserved for API Hero views. */
export const VIEW_IDS = {
  /** Activity Bar collections explorer. */
  collections: 'apiRunner.collections',
  /** Activity Bar request history explorer. */
  history: 'apiRunner.history',
  /** Reserved for a future generic explorer surface. */
  explorer: 'apiRunner.explorer',
} as const;

/** An API Hero view identifier. */
export type ViewId = (typeof VIEW_IDS)[keyof typeof VIEW_IDS];

/**
 * Custom Text Editor view type for single-request `.api` files.
 * Shared so collections navigation can openWith without importing request-editor.
 */
export const REQUEST_EDITOR_VIEW_TYPE = 'apiRunner.requestEditor';
