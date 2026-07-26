import type { VariableDefinition } from '../models';

export interface CollectionVariablePersistRefreshInput {
  readonly persistedRootPath: string;
  readonly definitions: readonly VariableDefinition[];
  readonly isCollectionRunActive: boolean;
  readonly activeRootPath: string | undefined;
  readonly normalizeKey: (path: string) => string;
}

export interface CollectionVariablePersistRefreshResult {
  /** Cache key for `collectionVariableCache`. */
  readonly cacheKey: string;
  readonly definitions: readonly VariableDefinition[];
  /**
   * When true, also replace the active collection-run snapshot used while a
   * collection execute is in progress.
   */
  readonly updateActiveRunSnapshot: boolean;
}

/**
 * Plans cache / active-run updates after a successful `scope=collection`
 * persist. Always refreshes the collection-variable cache for the written
 * root — including outside an active collection run (Create Variable /
 * single-request extract).
 */
export function planCollectionVariablePersistRefresh(
  input: CollectionVariablePersistRefreshInput,
): CollectionVariablePersistRefreshResult {
  const cacheKey = input.normalizeKey(input.persistedRootPath);
  const updateActiveRunSnapshot =
    input.isCollectionRunActive
    && input.activeRootPath !== undefined
    && input.normalizeKey(input.activeRootPath) === cacheKey;
  return {
    cacheKey,
    definitions: input.definitions,
    updateActiveRunSnapshot,
  };
}
