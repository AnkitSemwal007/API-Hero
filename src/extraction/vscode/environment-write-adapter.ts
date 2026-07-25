import type { EnvironmentManager } from '../../variables';
import {
  writeEnvironmentManagerState,
  type EnvironmentManagerState,
} from '../../variables/vscode';
import type {
  EnvironmentWritePorts,
  EnvironmentWriteState,
} from '../environment-variable-writer';

/**
 * Bridges {@link EnvironmentVariableWriter} ports to VS Code persistence and
 * {@link EnvironmentManager.refresh}.
 */
export function createEnvironmentWritePorts(
  manager: EnvironmentManager,
  getState: () => Promise<EnvironmentManagerState> | EnvironmentManagerState,
): EnvironmentWritePorts {
  return {
    getActiveEnvironmentId: () => manager.activeId,
    getState: async () => toWriteState(await getState()),
    writeState: async (state) => {
      await writeEnvironmentManagerState(fromWriteState(state));
    },
    refresh: () => {
      manager.refresh();
    },
  };
}

function toWriteState(state: EnvironmentManagerState): EnvironmentWriteState {
  return {
    environments: state.environments.map((environment) => ({
      id: environment.id,
      name: environment.name,
      variables: environment.variables.map((variable) => ({
        name: variable.name,
        value: variable.value,
        sensitive: variable.sensitive,
      })),
    })),
    globalVariables: state.globalVariables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
    })),
    workspaceVariables: state.workspaceVariables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
    })),
    ...(state.activeEnvironmentId === undefined
      ? {}
      : { activeEnvironmentId: state.activeEnvironmentId }),
    ...(state.selectedId === undefined ? {} : { selectedId: state.selectedId }),
  };
}

function fromWriteState(state: EnvironmentWriteState): EnvironmentManagerState {
  return {
    environments: state.environments.map((environment) => ({
      id: environment.id,
      name: environment.name,
      variables: environment.variables.map((variable) => ({
        name: variable.name,
        value: variable.value,
        sensitive: variable.sensitive,
      })),
    })),
    globalVariables: state.globalVariables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
    })),
    workspaceVariables: state.workspaceVariables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
    })),
    ...(state.activeEnvironmentId === undefined
      ? {}
      : { activeEnvironmentId: state.activeEnvironmentId }),
    ...(state.selectedId === undefined ? {} : { selectedId: state.selectedId }),
  };
}
