/**
 * Reads the legacy settings projection used for `.apihero` migration.
 * Never reads SecretStorage — auth profiles keep `{ kind: "secret" }` refs only.
 */

import { workspace } from 'vscode';

import { CONFIGURATION_KEYS, CONFIGURATION_SECTION } from '../../constants';
import type { AuthenticationProfile, Environment, VariableDefinition } from '../../models';
import { normalizeOptionalEnvironmentId } from '../../variables/environment-manager';
import type { LegacySettingsSnapshot } from '../types';

/** Snapshot of workspace settings project metadata (no secrets, no globals). */
export function readLegacySettingsSnapshot(): LegacySettingsSnapshot {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  return {
    environments: readEnvironments(
      configuration.get<unknown>(CONFIGURATION_KEYS.environments),
    ),
    workspaceVariables: readVariables(
      configuration.get<unknown>(CONFIGURATION_KEYS.workspaceVariables),
      'workspace',
    ),
    activeEnvironmentId: normalizeOptionalEnvironmentId(
      configuration.get<string>(CONFIGURATION_KEYS.activeEnvironment),
    ),
    authenticationProfiles: configuration.get<readonly AuthenticationProfile[]>(
      CONFIGURATION_KEYS.authenticationProfiles,
      [],
    ),
  };
}

function readVariables(
  value: unknown,
  scope: 'workspace' | 'environment',
): readonly VariableDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item): VariableDefinition => {
    const record =
      typeof item === 'object' && item !== null
        ? (item as Record<string, unknown>)
        : {};
    return {
      name: typeof record.name === 'string' ? record.name : '',
      value: typeof record.value === 'string' ? record.value : '',
      sensitive: record.sensitive === true,
      scope,
    };
  });
}

function readEnvironments(value: unknown): readonly Environment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index): Environment => {
    const record =
      typeof item === 'object' && item !== null
        ? (item as Record<string, unknown>)
        : {};
    const id =
      typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id.trim()
        : `invalid-${index}`;
    return {
      id,
      name:
        typeof record.name === 'string' && record.name.trim().length > 0
          ? record.name.trim()
          : id,
      variables: readVariables(record.variables, 'environment'),
    };
  });
}
