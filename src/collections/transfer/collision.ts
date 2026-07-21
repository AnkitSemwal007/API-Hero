/**
 * Pure path / name helpers for collection export and import.
 * No VS Code or filesystem I/O — callers supply existing sibling names.
 */

import { COLLECTION_MARKER_FILENAME } from '../constants';
import { joinPathKey } from '../models';
import { allocateUniqueName, sanitizeDirectoryName } from '../mutation/paths';

/** How to resolve a destination name that already exists. */
export type CollectionNameCollisionChoice =
  | 'rename'
  | 'overwrite'
  | 'abort';

/** Result of resolving a preferred collection directory name. */
export interface ResolvedCollectionDirectoryName {
  readonly directoryName: string;
  readonly overwrite: boolean;
}

/**
 * Resolves a preferred collection directory name against existing siblings.
 * Returns `undefined` when the preferred name is invalid or the choice is
 * `abort` and a collision exists.
 */
export function resolveCollectionNameCollision(
  preferredName: string,
  existingNames: readonly string[],
  choice: CollectionNameCollisionChoice,
): ResolvedCollectionDirectoryName | undefined {
  const directoryName = sanitizeDirectoryName(preferredName);
  if (directoryName === undefined) {
    return undefined;
  }

  const existing = new Set(existingNames);
  if (!existing.has(directoryName)) {
    return { directoryName, overwrite: false };
  }

  if (choice === 'abort') {
    return undefined;
  }

  if (choice === 'overwrite') {
    return { directoryName, overwrite: true };
  }

  return {
    directoryName: allocateUniqueName(directoryName, (candidate) =>
      existing.has(candidate),
    ),
    overwrite: false,
  };
}

/**
 * Prefers a sanitized marker `name`, otherwise the source folder basename.
 * Returns `undefined` when neither yields a safe directory segment.
 */
export function preferredCollectionDirectoryName(options: {
  readonly folderBasename: string;
  readonly markerName?: string;
}): string | undefined {
  if (
    options.markerName !== undefined &&
    options.markerName.trim().length > 0
  ) {
    const fromMarker = sanitizeDirectoryName(options.markerName);
    if (fromMarker !== undefined) {
      return fromMarker;
    }
  }
  return sanitizeDirectoryName(options.folderBasename);
}

/**
 * True when a directory listing looks like a native collection root
 * (marker file and/or at least one `.api` file at any immediate entry).
 */
export function looksLikeCollectionRoot(
  entryNames: readonly string[],
): boolean {
  const marker = COLLECTION_MARKER_FILENAME.toLowerCase();
  for (const name of entryNames) {
    const lower = name.toLowerCase();
    if (lower === marker || lower.endsWith('.api')) {
      return true;
    }
  }
  return false;
}

/** Absolute export path: `<destinationParent>/<directoryName>`. */
export function collectionExportDestinationPath(
  destinationParentPath: string,
  directoryName: string,
): string {
  return joinPathKey(destinationParentPath, directoryName);
}
