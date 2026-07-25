/**
 * Resolves which workspace folder owns project-store metadata for dual-read/write.
 *
 * Ownership rules:
 * 1. **Settings migration owner** = `workspace.workspaceFolders[0]` only (primary).
 * 2. Workspace-level env/auth dual-read and dual-write (Environment Manager
 *    full save, Auth Manager / switch-environment / OpenAPI when already in
 *    project mode) target the **primary folder** — never a secondary folder's
 *    `.apihero`. Partial writers (auth, active-env, OpenAPI patch) only use
 *    the project store when `isProjectStoreMode()` is true.
 * 3. Collection create / `ensureInitialized(folder)` / Initialize command operate
 *    only on the explicitly chosen folder path.
 * 4. Never fall through to "first secondary with a store" for env/auth writes.
 *
 * If primary has no store yet and the user saves env via manager, initializing
 * `.apihero` on primary only is correct. Settings fallback remains when primary
 * is not in project mode.
 */

import { workspace } from 'vscode';

import { getActiveProjectStoreCoordinator } from './project-store-coordinator';

/**
 * Absolute fsPath of the primary workspace folder used for workspace-level
 * env/auth project metadata. Always `workspaceFolders[0]` when folders exist.
 */
export function resolveProjectStoreFolderPath(): string | undefined {
  return workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** True when the primary folder is in `.apihero` project mode. */
export function isProjectStoreMode(): boolean {
  const folder = resolveProjectStoreFolderPath();
  if (folder === undefined) {
    return false;
  }
  return getActiveProjectStoreCoordinator()?.isProjectMode(folder) === true;
}

