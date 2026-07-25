/**
 * Safe JSON parse helpers for `.apihero` documents.
 * Unknown keys are ignored; corrupt documents return undefined (no wipe).
 */

import type { AuthenticationProfile } from '../models';
import { PROJECT_STORE_SCHEMA_VERSION } from './constants';
import type {
  AuthProfilesDocument,
  ConfigDocument,
  EnvironmentDocument,
  ProjectStoreVariable,
  WorkspaceDocument,
} from './types';

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseConfigDocument(text: string): ConfigDocument | undefined {
  const record = parseJsonObject(text);
  if (record === undefined) {
    return undefined;
  }
  const schemaVersion = record.schemaVersion;
  const projectId = record.projectId;
  const collectionsDirectory = record.collectionsDirectory;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return undefined;
  }
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    return undefined;
  }
  if (
    typeof collectionsDirectory !== 'string' ||
    collectionsDirectory.trim().length === 0
  ) {
    return undefined;
  }
  return {
    schemaVersion,
    projectId: projectId.trim(),
    collectionsDirectory: collectionsDirectory.trim(),
  };
}

export function parseWorkspaceDocument(text: string): WorkspaceDocument | undefined {
  const record = parseJsonObject(text);
  if (record === undefined) {
    return undefined;
  }
  const schemaVersion =
    typeof record.schemaVersion === 'number' &&
    Number.isInteger(record.schemaVersion)
      ? record.schemaVersion
      : PROJECT_STORE_SCHEMA_VERSION;
  const activeRaw = record.activeEnvironmentId;
  const activeEnvironmentId =
    typeof activeRaw === 'string' && activeRaw.trim().length > 0
      ? activeRaw.trim()
      : undefined;
  return {
    schemaVersion,
    ...(activeEnvironmentId === undefined ? {} : { activeEnvironmentId }),
    variables: parseVariableList(record.variables),
  };
}

export function parseEnvironmentDocument(
  text: string,
): EnvironmentDocument | undefined {
  const record = parseJsonObject(text);
  if (record === undefined) {
    return undefined;
  }
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id.length === 0) {
    return undefined;
  }
  const name =
    typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim()
      : id;
  return {
    id,
    name,
    variables: parseVariableList(record.variables),
  };
}

export function parseAuthProfilesDocument(
  text: string,
): AuthProfilesDocument | undefined {
  const record = parseJsonObject(text);
  if (record === undefined) {
    return undefined;
  }
  const schemaVersion =
    typeof record.schemaVersion === 'number' &&
    Number.isInteger(record.schemaVersion)
      ? record.schemaVersion
      : PROJECT_STORE_SCHEMA_VERSION;
  const profiles = Array.isArray(record.profiles)
    ? (record.profiles as AuthenticationProfile[])
    : [];
  return { schemaVersion, profiles };
}

function parseVariableList(value: unknown): readonly ProjectStoreVariable[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item): ProjectStoreVariable => {
    const record =
      typeof item === 'object' && item !== null
        ? (item as Record<string, unknown>)
        : {};
    return {
      name: typeof record.name === 'string' ? record.name : '',
      value: typeof record.value === 'string' ? record.value : '',
      ...(record.sensitive === true ? { sensitive: true } : {}),
    };
  });
}
