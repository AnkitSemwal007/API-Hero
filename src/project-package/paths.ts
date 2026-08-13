/**
 * Path safety for project packages. Unsafe paths are rejected, never rewritten.
 */

import {
  PROJECT_ROOT_PREFIX,
  MANIFEST_ENTRY_NAME,
} from './constants';

const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** POSIX-normalize separators; trim a single leading slash. */
export function posixNormalize(input: string): string {
  return input.replace(/\\/gu, '/').replace(/^\.\/+/u, '');
}

export function isAbsolutePackagePath(path: string): boolean {
  const normalized = posixNormalize(path);
  if (normalized.startsWith('/') || normalized.startsWith('//')) {
    return true;
  }
  if (/^[A-Za-z]:(\/|$)/u.test(normalized)) {
    return true;
  }
  if (normalized.startsWith('\\\\') || /^[A-Za-z]:\\/u.test(path)) {
    return true;
  }
  return false;
}

export function isReservedSegment(segment: string): boolean {
  const stem = segment.split('.')[0]?.toLowerCase() ?? '';
  return WINDOWS_RESERVED.has(stem);
}

/**
 * Splits a package-relative path into segments, or undefined when unsafe.
 * Rejects `.`, `..`, empty, NUL, absolute, drive letters, and reserved names.
 */
export function safePathSegments(raw: string): readonly string[] | undefined {
  if (raw.includes('\0')) {
    return undefined;
  }
  if (isAbsolutePackagePath(raw)) {
    return undefined;
  }
  const normalized = posixNormalize(raw);
  if (normalized.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (part.length === 0 || part === '.') {
      continue;
    }
    if (part === '..') {
      return undefined;
    }
    if (part.includes('\0') || isReservedSegment(part)) {
      return undefined;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts;
}

export function joinPosix(segments: readonly string[]): string {
  return segments.join('/');
}

/**
 * Archive entry names must be `manifest.json` or under `project/`.
 */
export function isAllowedArchiveEntry(name: string): boolean {
  const segments = safePathSegments(name);
  if (segments === undefined) {
    return false;
  }
  const joined = joinPosix(segments);
  if (joined === MANIFEST_ENTRY_NAME) {
    return true;
  }
  return segments[0] === PROJECT_ROOT_PREFIX && segments.length > 1;
}

/**
 * Maps an archive `project/...` path to a destination-relative path.
 */
export function projectRelativeFromArchive(name: string): string | undefined {
  const segments = safePathSegments(name);
  if (segments === undefined || segments[0] !== PROJECT_ROOT_PREFIX) {
    return undefined;
  }
  if (segments.length < 2) {
    return undefined;
  }
  return joinPosix(segments.slice(1));
}

export function archivePathForProjectFile(relativePath: string): string | undefined {
  const segments = safePathSegments(relativePath);
  if (segments === undefined) {
    return undefined;
  }
  return joinPosix([PROJECT_ROOT_PREFIX, ...segments]);
}

/**
 * Collections directory must be a single relative segment (e.g. `Collections`).
 */
export function isValidCollectionsDirectoryName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const segments = safePathSegments(trimmed);
  if (segments === undefined || segments.length !== 1) {
    return false;
  }
  const name = segments[0]!;
  if (name.startsWith('.') || name === 'node_modules') {
    return false;
  }
  return true;
}

/**
 * Resolve `relativePath` under `destinationRoot`. Returns undefined on escape.
 */
export function resolveUnderDestination(
  destinationRoot: string,
  relativePath: string,
): string | undefined {
  const segments = safePathSegments(relativePath);
  if (segments === undefined) {
    return undefined;
  }
  const root = posixNormalize(destinationRoot).replace(/\/+$/u, '');
  if (root.length === 0) {
    return undefined;
  }
  const combined = `${root}/${joinPosix(segments)}`;
  const rootCompare = root.toLowerCase();
  const combinedCompare = combined.toLowerCase();
  if (
    combinedCompare !== rootCompare &&
    !combinedCompare.startsWith(`${rootCompare}/`)
  ) {
    return undefined;
  }
  return combined;
}
