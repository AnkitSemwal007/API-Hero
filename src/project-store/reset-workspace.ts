/**
 * Pure domain helper: remove known API Hero workspace store roots.
 * Never walks Collections or other project files.
 */

import { joinPathKey } from '../collections/models';
import { projectStoreRootPath } from './paths';
import type { ProjectStoreFilesystem } from './ports';

/**
 * Legacy scenarios root relative to the workspace folder
 * (kept local to avoid a project-store ↔ scenarios/storage import cycle).
 */
const LEGACY_SCENARIOS_RELATIVE = '.api-hero/scenarios';
const LEGACY_API_HERO_PARENT = '.api-hero';

/** Components the filesystem reset may report failures for. */
export type ResetWorkspaceStoreComponent =
  | 'project-store'
  | 'legacy-scenarios';

export interface ResetWorkspaceFailure {
  readonly component: string;
  readonly message: string;
}

export interface ResetWorkspaceStoreResult {
  /** True when at least one known root was present and removed. */
  readonly deletedSomething: boolean;
  readonly failures: readonly ResetWorkspaceFailure[];
}

/**
 * Deletes `.apihero` and legacy `.api-hero/scenarios` under the workspace
 * folder. Missing paths are success (already clean). Idempotent.
 */
export async function resetWorkspaceStore(
  workspaceRootPath: string,
  filesystem: ProjectStoreFilesystem,
): Promise<ResetWorkspaceStoreResult> {
  const failures: ResetWorkspaceFailure[] = [];
  let deletedSomething = false;

  const storeRoot = projectStoreRootPath(workspaceRootPath);
  const storeDeleted = await deletePathRecursive(
    filesystem,
    storeRoot,
    'project-store',
    failures,
  );
  if (storeDeleted) {
    deletedSomething = true;
  }

  const legacyRoot = joinPathKey(workspaceRootPath, LEGACY_SCENARIOS_RELATIVE);
  const legacyDeleted = await deletePathRecursive(
    filesystem,
    legacyRoot,
    'legacy-scenarios',
    failures,
  );
  if (legacyDeleted) {
    deletedSomething = true;
  }

  const legacyParent = joinPathKey(workspaceRootPath, LEGACY_API_HERO_PARENT);
  const parentDeleted = await deleteEmptyDirectoryIfSafe(
    filesystem,
    legacyParent,
    'legacy-scenarios',
    failures,
  );
  if (parentDeleted) {
    deletedSomething = true;
  }

  return { deletedSomething, failures };
}

async function deletePathRecursive(
  filesystem: ProjectStoreFilesystem,
  path: string,
  component: ResetWorkspaceStoreComponent,
  failures: ResetWorkspaceFailure[],
): Promise<boolean> {
  try {
    if (!(await filesystem.exists(path))) {
      return false;
    }
    await filesystem.delete(path, { recursive: true, useTrash: false });
    return true;
  } catch (error: unknown) {
    failures.push({
      component,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Removes an empty legacy `.api-hero` directory only. Non-empty parents are
 * left untouched so unrelated content is never deleted.
 */
async function deleteEmptyDirectoryIfSafe(
  filesystem: ProjectStoreFilesystem,
  path: string,
  component: ResetWorkspaceStoreComponent,
  failures: ResetWorkspaceFailure[],
): Promise<boolean> {
  try {
    if (!(await filesystem.exists(path))) {
      return false;
    }
    const entries = await filesystem.readDirectory(path);
    if (entries.length > 0) {
      return false;
    }
    await filesystem.delete(path, { recursive: true, useTrash: false });
    return true;
  } catch (error: unknown) {
    failures.push({
      component,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
