import { workspace } from 'vscode';

import { CONFIGURATION_KEYS, CONFIGURATION_SECTION } from '../constants';
import type {
  Environment,
  VariableDefinition,
  VariableScope,
} from '../models';
import type {
  VariableConfigurationRepository,
  VariableConfigurationSnapshot,
} from '../variables';

interface ConfiguredVariable {
  readonly name?: unknown;
  readonly value?: unknown;
  readonly sensitive?: unknown;
}

interface ConfiguredEnvironment {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly variables?: unknown;
}

/** Reads variable configuration without exposing VS Code to the domain layer. */
export class VsCodeVariableConfigurationRepository
implements VariableConfigurationRepository {
  public getSnapshot(): VariableConfigurationSnapshot {
    const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
    return Object.freeze({
      globalVariables: readVariables(
        configuration.get<unknown>(CONFIGURATION_KEYS.globalVariables),
        'global',
      ),
      workspaceVariables: readVariables(
        configuration.get<unknown>(CONFIGURATION_KEYS.workspaceVariables),
        'workspace',
      ),
      environments: readEnvironments(
        configuration.get<unknown>(CONFIGURATION_KEYS.environments),
      ),
      activeEnvironmentId: configuration.get<string>(
        CONFIGURATION_KEYS.activeEnvironment,
      ),
    });
  }
}

function readVariables(value: unknown, scope: VariableScope): readonly VariableDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Object.freeze(value.map((item): VariableDefinition => {
    const configured = asConfiguredVariable(item);
    return Object.freeze({
      name: typeof configured.name === 'string' ? configured.name : '',
      value: typeof configured.value === 'string' ? configured.value : '',
      sensitive: configured.sensitive === true,
      scope,
    });
  }));
}

function readEnvironments(value: unknown): readonly Environment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Object.freeze(value.map((item, index): Environment => {
    const configured = asConfiguredEnvironment(item);
    const id = typeof configured.id === 'string' ? configured.id : `invalid-${index}`;
    return Object.freeze({
      id,
      name: typeof configured.name === 'string' ? configured.name : id,
      variables: readVariables(configured.variables, 'environment'),
    });
  }));
}

function asConfiguredVariable(value: unknown): ConfiguredVariable {
  return typeof value === 'object' && value !== null
    ? value as ConfiguredVariable
    : {};
}

function asConfiguredEnvironment(value: unknown): ConfiguredEnvironment {
  return typeof value === 'object' && value !== null
    ? value as ConfiguredEnvironment
    : {};
}
