import { normalizePathKey, normalizeRelativePath } from '../collections/models';
import type { SourceLocationRef } from './models';

/**
 * Parses an authored `@source` value into a path plus optional 1-based line
 * (stored 0-based). Rejects empty values and `..` segments.
 */
export function parseSourceDirectiveValue(
  value: string,
): SourceLocationRef | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const lineMatch = /^(.*):(\d+)$/u.exec(trimmed);
  let path = trimmed;
  let line: number | undefined;
  if (lineMatch !== null && !looksLikeWindowsDrive(trimmed)) {
    path = lineMatch[1]!.trim();
    const authoredLine = Number(lineMatch[2]);
    if (Number.isSafeInteger(authoredLine) && authoredLine > 0) {
      line = authoredLine - 1;
    }
  }
  if (path.length === 0 || path.includes('\0')) {
    return undefined;
  }
  const normalized = normalizeRelativePath(path.replace(/\\/g, '/'));
  if (normalized.length === 0) {
    return undefined;
  }
  if (hasParentSegment(path)) {
    return undefined;
  }
  return line === undefined ? { path: normalized } : { path: normalized, line };
}

/** True when `candidate` (file URI or path) matches an authored source path. */
export function sourcePathMatches(
  authoredPath: string,
  candidatePath: string,
  workspaceRoots: readonly string[] = [],
): boolean {
  const authored = normalizePathKey(authoredPath.replace(/\\/g, '/'));
  const candidate = normalizePathKey(candidatePath.replace(/\\/g, '/'));
  if (authored.length === 0 || candidate.length === 0) {
    return false;
  }
  if (candidate === authored || candidate.endsWith(`/${authored}`)) {
    return true;
  }
  for (const root of workspaceRoots) {
    const joined = normalizePathKey(
      `${root.replace(/\\/g, '/').replace(/\/+$/u, '')}/${authored}`,
    );
    if (candidate === joined || stripUriScheme(candidate) === stripUriScheme(joined)) {
      return true;
    }
  }
  return stripUriScheme(candidate).endsWith(`/${authored}`);
}

function hasParentSegment(path: string): boolean {
  return path.split(/[/\\]/u).includes('..');
}

function looksLikeWindowsDrive(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) && !/:\d+$/u.test(value);
}

function stripUriScheme(path: string): string {
  return path.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '');
}
