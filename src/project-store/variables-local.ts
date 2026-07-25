/**
 * Sensitive variable overlay under `.apihero/local/variables.local.json`.
 * Domain-only — no `vscode` imports.
 */

import type { Environment, VariableDefinition } from '../models';
import { PROJECT_STORE_SCHEMA_VERSION } from './constants';
import { parseJsonObject } from './parse';
import { localDirectoryPath, variablesLocalPath } from './paths';
import type { ProjectStoreFilesystem } from './ports';
import { serializeJson } from './serialize';
import type { ProjectStoreVariable, VariablesLocalDocument } from './types';

export function emptyVariablesLocalDocument(): VariablesLocalDocument {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    workspace: {},
    environments: {},
  };
}

export function parseVariablesLocalDocument(
  text: string,
): VariablesLocalDocument | undefined {
  const record = parseJsonObject(text);
  if (record === undefined) {
    return undefined;
  }
  const schemaVersion =
    typeof record.schemaVersion === 'number' &&
    Number.isInteger(record.schemaVersion)
      ? record.schemaVersion
      : PROJECT_STORE_SCHEMA_VERSION;
  return {
    schemaVersion,
    workspace: parseStringMap(record.workspace),
    environments: parseEnvironmentMaps(record.environments),
  };
}

export async function readVariablesLocalOverlay(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
): Promise<VariablesLocalDocument> {
  const path = variablesLocalPath(workspaceRootPath);
  if (!(await filesystem.exists(path))) {
    return emptyVariablesLocalDocument();
  }
  try {
    const parsed = parseVariablesLocalDocument(await filesystem.readText(path));
    return parsed ?? emptyVariablesLocalDocument();
  } catch {
    return emptyVariablesLocalDocument();
  }
}

export async function writeVariablesLocalOverlay(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
  document: VariablesLocalDocument,
): Promise<void> {
  await filesystem.createDirectory(localDirectoryPath(workspaceRootPath));
  await filesystem.writeText(
    variablesLocalPath(workspaceRootPath),
    serializeJson({
      schemaVersion: document.schemaVersion,
      workspace: document.workspace,
      environments: document.environments,
    }),
  );
}

/** Builds the workspace overlay map from sensitive variables only. */
export function workspaceSensitiveOverlay(
  variables: readonly VariableDefinition[] | readonly ProjectStoreVariable[],
): Readonly<Record<string, string>> {
  const overlay: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.sensitive === true && variable.name.trim().length > 0) {
      overlay[variable.name] = variable.value;
    }
  }
  return overlay;
}

/** Builds the environments overlay map from sensitive variables only. */
export function environmentsSensitiveOverlay(
  environments: readonly Environment[],
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const overlay: Record<string, Record<string, string>> = {};
  for (const environment of environments) {
    const values: Record<string, string> = {};
    for (const variable of environment.variables) {
      if (variable.sensitive === true && variable.name.trim().length > 0) {
        values[variable.name] = variable.value;
      }
    }
    if (Object.keys(values).length > 0) {
      overlay[environment.id] = values;
    }
  }
  return overlay;
}

export function mergeWorkspaceVariablesWithOverlay(
  variables: readonly ProjectStoreVariable[],
  overlay: Readonly<Record<string, string>>,
): readonly ProjectStoreVariable[] {
  return variables.map((variable) =>
    mergeVariableWithOverlay(variable, overlay[variable.name]),
  );
}

export function mergeEnvironmentVariablesWithOverlay(
  variables: readonly ProjectStoreVariable[],
  overlay: Readonly<Record<string, string>> | undefined,
): readonly ProjectStoreVariable[] {
  if (overlay === undefined) {
    return variables;
  }
  return variables.map((variable) =>
    mergeVariableWithOverlay(variable, overlay[variable.name]),
  );
}

function mergeVariableWithOverlay(
  variable: ProjectStoreVariable,
  overlayValue: string | undefined,
): ProjectStoreVariable {
  if (variable.sensitive === true && overlayValue !== undefined) {
    return {
      name: variable.name,
      value: overlayValue,
      sensitive: true,
    };
  }
  return variable;
}

function parseStringMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function parseEnvironmentMaps(
  value: unknown,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, Readonly<Record<string, string>>> = {};
  for (const [envId, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    result[envId] = parseStringMap(entry);
  }
  return result;
}

