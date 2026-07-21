/**
 * Pure path / naming helpers for collection filesystem mutations.
 * No VS Code or Node filesystem imports.
 */

import {
  COLLECTIONS_DIRECTORY_NAME,
  COLLECTION_MARKER_FILENAME,
} from '../constants';
import { joinPathKey, normalizeRelativePath } from '../models';
import { serializePlaceholderRequest } from '../../request-source';

/** Default single-request placeholder written by Create Request. */
export const PLACEHOLDER_REQUEST_SOURCE = serializePlaceholderRequest(
  'New Request',
);

const INVALID_NAME_PATTERN = /[<>:"/\\|?*]/u;

function hasAsciiControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) <= 0x1f) {
      return true;
    }
  }
  return false;
}
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/** Returns a filesystem-safe segment or undefined when the name is invalid. */
export function sanitizePathSegment(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === '.' || trimmed === '..') {
    return undefined;
  }
  if (INVALID_NAME_PATTERN.test(trimmed) || hasAsciiControlChars(trimmed)) {
    return undefined;
  }
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return undefined;
  }
  if (RESERVED_WINDOWS_NAMES.has(trimmed.toUpperCase())) {
    return undefined;
  }
  return trimmed;
}

/** Sanitizes a collection or folder display name for use as a directory. */
export function sanitizeDirectoryName(raw: string): string | undefined {
  return sanitizePathSegment(raw);
}

/**
 * Sanitizes a request name into a `.api` basename (adds `.api` when missing).
 * Returns undefined when the name is empty or unsafe.
 */
export function sanitizeRequestFileName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const withoutExt = trimmed.toLowerCase().endsWith('.api')
    ? trimmed.slice(0, -4)
    : trimmed;
  const segment = sanitizePathSegment(withoutExt);
  if (segment === undefined) {
    return undefined;
  }
  return `${segment}.api`;
}

/** Strips a trailing `.api` extension for display / rename prompts. */
export function stripApiExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith('.api')
    ? fileName.slice(0, -4)
    : fileName;
}

/** Last path segment of an absolute or relative `/`-normalized path. */
export function pathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? normalized : normalized.slice(index + 1);
}

/** Parent directory of a path (empty string when at root of a relative path). */
export function pathDirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '';
  }
  return normalized.slice(0, index);
}

/** Workspace-relative `Collections/<Name>` for a collection directory name. */
export function collectionRelativeRootForName(collectionName: string): string {
  return joinPathKey(COLLECTIONS_DIRECTORY_NAME, collectionName);
}

/** Absolute collection root from workspace root + collection directory name. */
export function collectionRootPath(
  workspaceRootPath: string,
  collectionName: string,
): string {
  return joinPathKey(
    workspaceRootPath,
    COLLECTIONS_DIRECTORY_NAME,
    collectionName,
  );
}

/** Absolute marker path under a collection root. */
export function collectionMarkerPath(collectionRootPath: string): string {
  return joinPathKey(collectionRootPath, COLLECTION_MARKER_FILENAME);
}

/**
 * Joins a collection root with a relative folder path and optional file name.
 * `folderRelativePath` empty means the collection root.
 */
export function joinUnderCollection(
  collectionRootPath: string,
  folderRelativePath: string,
  ...segments: string[]
): string {
  const folder = normalizeRelativePath(folderRelativePath);
  if (folder.length === 0) {
    return joinPathKey(collectionRootPath, ...segments);
  }
  return joinPathKey(collectionRootPath, folder, ...segments);
}

/**
 * Returns a unique name by appending ` (2)`, ` (3)`, … when `exists` is true.
 * `baseName` should already be sanitized (and include `.api` for files).
 */
export function allocateUniqueName(
  baseName: string,
  exists: (candidate: string) => boolean,
): string {
  if (!exists(baseName)) {
    return baseName;
  }
  const isApi = baseName.toLowerCase().endsWith('.api');
  const stem = isApi ? baseName.slice(0, -4) : baseName;
  const extension = isApi ? '.api' : '';
  let index = 2;
  for (;;) {
    const candidate = `${stem} (${index})${extension}`;
    if (!exists(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

/** Builds placeholder `.api` source with an `@name` matching the request label. */
export function buildPlaceholderRequestSource(requestLabel: string): string {
  return serializePlaceholderRequest(requestLabel);
}

/**
 * Relocates a relative path that lived under `fromPrefix` so it lives under
 * `toPrefix`. Returns undefined when `relativePath` is not under `fromPrefix`.
 */
export function remapRelativePath(
  relativePath: string,
  fromPrefix: string,
  toPrefix: string,
): string | undefined {
  const path = normalizeRelativePath(relativePath);
  const from = normalizeRelativePath(fromPrefix);
  const to = normalizeRelativePath(toPrefix);
  if (from.length === 0) {
    return to.length === 0 ? path : joinPathKey(to, path);
  }
  if (path === from) {
    return to;
  }
  if (!path.startsWith(`${from}/`)) {
    return undefined;
  }
  const rest = path.slice(from.length + 1);
  return to.length === 0 ? rest : joinPathKey(to, rest);
}
