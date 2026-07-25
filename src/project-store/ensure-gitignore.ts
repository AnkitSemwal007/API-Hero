/**
 * Idempotently appends `.apihero` ignore rules to a workspace `.gitignore`.
 */

import { PROJECT_STORE_GITIGNORE_LINES } from './constants';
import { gitignorePath } from './paths';
import type { ProjectStoreFilesystem } from './ports';

export interface EnsureGitignoreResult {
  readonly changed: boolean;
  readonly path: string;
}

/**
 * Ensures the standard `.apihero/local|cache|history/` lines exist.
 * Creates `.gitignore` when missing. Does not duplicate existing lines.
 */
export async function ensureProjectStoreGitignore(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
): Promise<EnsureGitignoreResult> {
  const path = gitignorePath(workspaceRootPath);
  let existing = '';
  if (await filesystem.exists(path)) {
    existing = await filesystem.readText(path);
  }

  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  const missing = PROJECT_STORE_GITIGNORE_LINES.filter(
    (line) => !present.has(line),
  );
  if (missing.length === 0) {
    return { changed: false, path };
  }

  const needsLeadingNewline =
    existing.length > 0 && !existing.endsWith('\n') && !existing.endsWith('\r');
  const block = [
    ...(existing.length === 0 ? [] : ['']),
    '# API Hero project store (local overlays / cache / history)',
    ...missing,
  ].join('\n');
  const next = `${existing}${needsLeadingNewline ? '\n' : ''}${block}\n`;
  await filesystem.writeText(path, next);
  return { changed: true, path };
}
