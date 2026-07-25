/**
 * Persists Environment Manager state.
 *
 * Full Environment Manager save may write to the project store when a workspace
 * folder is open (Phase 3 first-save init): it writes the full snapshot
 * (environments + workspace variables + active) via `writeProjectMetadata` and
 * will not empty-shadow settings. Once already in project mode, the store is
 * SoT and settings are not mirrored (settings remain an untouched compatibility
 * fallback until a later cleanup phase).
 *
 * Partial active-environment writes only target the project store when already
 * in project mode; otherwise they stay in VS Code settings.
 * Global variables always stay in user settings.
 */

import { ConfigurationTarget, workspace } from 'vscode';

import {
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
} from '../../constants';
import { normalizeOptionalEnvironmentId } from '../environment-manager';
import {
  getActiveProjectStoreCoordinator,
} from '../../project-store/vscode/project-store-coordinator';
import {
  isProjectStoreMode,
  resolveProjectStoreFolderPath,
} from '../../project-store/vscode/resolve-project-folder';
import type { EnvironmentManagerState } from './environment-manager-html';

/** Persists the Environment Manager snapshot. */
export async function writeEnvironmentManagerState(
  state: EnvironmentManagerState,
): Promise<void> {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);

  // Global variables always belong in user settings.
  await configuration.update(
    CONFIGURATION_KEYS.globalVariables,
    serializeVariables(state.globalVariables),
    ConfigurationTarget.Global,
  );

  const coordinator = getActiveProjectStoreCoordinator();
  const folder = resolveProjectStoreFolderPath();
  // Full snapshot write: folder open is enough (first-save may init project mode).
  if (coordinator !== undefined && folder !== undefined) {
    await coordinator.writeProjectMetadata(folder, {
      environments: state.environments.map((environment) => ({
        id: environment.id,
        name: environment.name.trim(),
        variables: environment.variables.map((variable) => ({
          name: variable.name.trim(),
          value: variable.value,
          sensitive: variable.sensitive === true,
          scope: 'environment' as const,
        })),
      })),
      workspaceVariables: state.workspaceVariables.map((variable) => ({
        name: variable.name.trim(),
        value: variable.value,
        sensitive: variable.sensitive === true,
        scope: 'workspace' as const,
      })),
      activeEnvironmentId: normalizeOptionalEnvironmentId(
        state.activeEnvironmentId,
      ),
    });
    return;
  }

  const workspaceTarget = resolveWorkspaceOrGlobalTarget();
  const environments = state.environments.map((environment) => ({
    id: environment.id,
    name: environment.name.trim(),
    variables: serializeVariables(environment.variables),
  }));

  await configuration.update(
    CONFIGURATION_KEYS.environments,
    environments,
    workspaceTarget,
  );
  await configuration.update(
    CONFIGURATION_KEYS.workspaceVariables,
    serializeVariables(state.workspaceVariables),
    workspaceTarget,
  );
  await configuration.update(
    CONFIGURATION_KEYS.activeEnvironment,
    normalizeOptionalEnvironmentId(state.activeEnvironmentId),
    workspaceTarget,
  );
}

/** Persists only the active environment id (session + store converge). */
export async function writeActiveEnvironmentId(
  id: string | undefined,
): Promise<void> {
  const normalized = normalizeOptionalEnvironmentId(id);
  const coordinator = getActiveProjectStoreCoordinator();
  const folder = resolveProjectStoreFolderPath();
  if (
    coordinator !== undefined &&
    folder !== undefined &&
    isProjectStoreMode()
  ) {
    await coordinator.writeActiveEnvironmentId(folder, normalized);
    return;
  }

  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  await configuration.update(
    CONFIGURATION_KEYS.activeEnvironment,
    normalized,
    resolveWorkspaceOrGlobalTarget(),
  );
}

function serializeVariables(
  variables: EnvironmentManagerState['globalVariables'],
): readonly {
  readonly name: string;
  readonly value: string;
  readonly sensitive?: true;
}[] {
  return variables.map((variable) => ({
    name: variable.name.trim(),
    value: variable.value,
    ...(variable.sensitive ? { sensitive: true as const } : {}),
  }));
}

function resolveWorkspaceOrGlobalTarget(): ConfigurationTarget {
  return (workspace.workspaceFolders?.length ?? 0) > 0
    ? ConfigurationTarget.Workspace
    : ConfigurationTarget.Global;
}
