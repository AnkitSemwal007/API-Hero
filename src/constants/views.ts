/** Stable identifiers reserved for API Hero views. */
export const VIEW_IDS = {
  /** Activity Bar collections explorer. */
  collections: 'apiHero.collections',
  /** Activity Bar collection-run execution dashboard. */
  execution: 'apiHero.execution',
  /** Activity Bar request history explorer. */
  history: 'apiHero.history',
  /** Activity Bar scenario explorer. */
  explorer: 'apiHero.explorer',
} as const;

/** An API Hero view identifier. */
export type ViewId = (typeof VIEW_IDS)[keyof typeof VIEW_IDS];

/**
 * Custom Text Editor view type for single-request `.api` files.
 * Shared so collections navigation can openWith without importing request-editor.
 */
export const REQUEST_EDITOR_VIEW_TYPE = 'apiHero.requestEditor';

/**
 * Legacy custom editor view type kept contributed and dual-registered so
 * workspaces that still open `apiRunner.requestEditor` keep working.
 */
export const LEGACY_REQUEST_EDITOR_VIEW_TYPE = 'apiRunner.requestEditor';

/** Activity Bar container id (canonical). */
export const ACTIVITY_BAR_CONTAINER_ID = 'apiHero';

/** DnD mime type for Collections tree drag-and-drop. */
export const COLLECTIONS_TREE_MIME_TYPE =
  'application/vnd.code.tree.apiHero.collections';
