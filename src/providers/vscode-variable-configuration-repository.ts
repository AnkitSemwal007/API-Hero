import { workspace } from 'vscode';

import { CONFIGURATION_KEYS, CONFIGURATION_SECTION } from '../constants';
import type {
  Environment,
  VariableDefinition,
  VariableScope,
} from '../models';
import {
  normalizeOptionalEnvironmentId,
  type VariableConfigurationRepository,
  type VariableConfigurationSnapshot,
} from '../variables/environment-manager';
import {
  getActiveProjectStoreCoordinator,
} from '../project-store/vscode/project-store-coordinator';
import { resolveProjectStoreFolderPath } from '../project-store/vscode/resolve-project-folder';

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

/**
 * Reads variable configuration with dual-read:
 * - Global variables always come from user settings.
 * - When `.apihero/config.json` exists (cached), environments / workspace vars /
 *   activeEnvironment come from the project store; otherwise settings.
 * Parse failures fall back to settings (coordinator omits bad cache entries).
 */
export class VsCodeVariableConfigurationRepository
implements VariableConfigurationRepository {
  public getSnapshot(): VariableConfigurationSnapshot {
    const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
    const globalVariables = readVariables(
      configuration.get<unknown>(CONFIGURATION_KEYS.globalVariables),
      'global',
    );

    const project = tryReadProjectSnapshot();
    if (project !== undefined) {
      return Object.freeze({
        globalVariables,
        workspaceVariables: project.workspaceVariables,
        environments: project.environments,
        activeEnvironmentId: normalizeOptionalEnvironmentId(
          project.activeEnvironmentId,
        ),
      });
    }

    return Object.freeze({
      globalVariables,
      workspaceVariables: readVariables(
        configuration.get<unknown>(CONFIGURATION_KEYS.workspaceVariables),
        'workspace',
      ),
      environments: readEnvironments(
        configuration.get<unknown>(CONFIGURATION_KEYS.environments),
      ),
      activeEnvironmentId: normalizeOptionalEnvironmentId(
        configuration.get<string>(CONFIGURATION_KEYS.activeEnvironment),
      ),
    });
  }
}

function tryReadProjectSnapshot(): {
  readonly environments: readonly Environment[];
  readonly workspaceVariables: readonly VariableDefinition[];
  readonly activeEnvironmentId?: string;
} | undefined {
  const coordinator = getActiveProjectStoreCoordinator();
  const folder = resolveProjectStoreFolderPath();
  if (coordinator === undefined || folder === undefined) {
    return undefined;
  }
  const cached = coordinator.getCached(folder);
  if (cached === undefined) {
    return undefined;
  }
  return {
    environments: cached.environments,
    workspaceVariables: cached.workspaceVariables,
    activeEnvironmentId: cached.activeEnvironmentId,
  };
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
