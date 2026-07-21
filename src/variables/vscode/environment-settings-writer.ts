/**
 * Writes variable/environment configuration through VS Code settings only.
 * Keeps a single store (`apiRunner.*`) — no parallel persistence.
 */

import { ConfigurationTarget, workspace } from 'vscode';

import {
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
} from '../../constants';
import type { EnvironmentManagerState } from './environment-manager-html';

/** Persists the Environment Manager snapshot to existing settings keys. */
export async function writeEnvironmentManagerState(
  state: EnvironmentManagerState,
): Promise<void> {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
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
    state.activeEnvironmentId,
    workspaceTarget,
  );
  // Global variables always belong in user settings.
  await configuration.update(
    CONFIGURATION_KEYS.globalVariables,
    serializeVariables(state.globalVariables),
    ConfigurationTarget.Global,
  );
}

/** Persists only the active environment id (session + settings converge). */
export async function writeActiveEnvironmentId(
  id: string | undefined,
): Promise<void> {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  await configuration.update(
    CONFIGURATION_KEYS.activeEnvironment,
    id,
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
