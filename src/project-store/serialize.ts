/**
 * JSON serialize helpers for `.apihero` documents.
 */

import type {
  AuthenticationProfile,
  AuthenticationValueSource,
  Environment,
  VariableDefinition,
} from '../models';
import { PROJECT_STORE_SCHEMA_VERSION } from './constants';
import type {
  AuthProfilesDocument,
  ConfigDocument,
  EnvironmentDocument,
  MigrationBackupDocument,
  ProjectStoreVariable,
  WorkspaceDocument,
} from './types';

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

export function toConfigDocument(
  projectId: string,
  collectionsDirectory: string,
): ConfigDocument {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    projectId,
    collectionsDirectory,
  };
}

export function toWorkspaceDocument(
  variables: readonly VariableDefinition[] | readonly ProjectStoreVariable[],
  activeEnvironmentId: string | undefined,
): WorkspaceDocument {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    ...(activeEnvironmentId === undefined || activeEnvironmentId.trim().length === 0
      ? {}
      : { activeEnvironmentId: activeEnvironmentId.trim() }),
    variables: variables.map(toTrackedVariable),
  };
}

export function toEnvironmentDocument(
  environment: Environment,
): EnvironmentDocument {
  return {
    id: environment.id,
    name: environment.name,
    variables: environment.variables.map(toTrackedVariable),
  };
}

/**
 * Auth metadata for tracked `.apihero/auth/profiles.json`.
 * Literal credential sources are always redacted to `{ kind: 'secret' }` —
 * never write literal credential strings into tracked auth docs.
 */
export function toAuthProfilesDocument(
  profiles: readonly AuthenticationProfile[],
): AuthProfilesDocument {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    profiles: profiles.map(redactAuthenticationProfile),
  };
}

/**
 * Migration backup under gitignored `local/` may retain full settings values
 * for recovery (including literal auth sources and sensitive variable values).
 */
export function toMigrationBackupDocument(input: {
  readonly migratedAt: string;
  readonly environments: readonly Environment[];
  readonly workspaceVariables: readonly VariableDefinition[];
  readonly activeEnvironmentId?: string;
  readonly authenticationProfiles: readonly AuthenticationProfile[];
}): MigrationBackupDocument {
  return {
    migratedAt: input.migratedAt,
    source: 'workspace-settings',
    environments: input.environments.map((environment) => ({
      id: environment.id,
      name: environment.name,
      variables: environment.variables.map(toStoredVariableFull),
    })),
    workspaceVariables: input.workspaceVariables.map(toStoredVariableFull),
    ...(input.activeEnvironmentId === undefined
      ? {}
      : { activeEnvironmentId: input.activeEnvironmentId }),
    authenticationProfiles: input.authenticationProfiles.map((profile) =>
      structuredClone(profile),
    ),
  };
}

/** Collects literal credential values before they are redacted on disk. */
export function collectAuthLiteralSecrets(
  profiles: readonly AuthenticationProfile[],
): readonly {
  readonly profileId: string;
  readonly field: string;
  readonly value: string;
}[] {
  const collected: {
    readonly profileId: string;
    readonly field: string;
    readonly value: string;
  }[] = [];
  for (const profile of profiles) {
    for (const [field, source] of authenticationValueSourceEntries(profile)) {
      if (source.kind === 'literal') {
        collected.push({
          profileId: profile.id,
          field,
          value: source.value,
        });
      }
    }
  }
  return collected;
}

export function redactAuthenticationProfile(
  profile: AuthenticationProfile,
): AuthenticationProfile {
  const clone = structuredClone(profile) as Record<string, unknown>;
  for (const [field, source] of authenticationValueSourceEntries(profile)) {
    clone[field] = redactAuthenticationValueSource(source);
  }
  return clone as AuthenticationProfile;
}

export function redactAuthenticationValueSource(
  source: AuthenticationValueSource,
): AuthenticationValueSource {
  if (source.kind === 'literal') {
    return { kind: 'secret' };
  }
  return source;
}

/**
 * Tracked env/workspace variables: sensitive rows store an empty value.
 * Actual sensitive values live in `.apihero/local/variables.local.json`.
 */
export function toTrackedVariable(
  variable: VariableDefinition | ProjectStoreVariable,
): ProjectStoreVariable {
  if (variable.sensitive === true) {
    return {
      name: variable.name,
      value: '',
      sensitive: true,
    };
  }
  return {
    name: variable.name,
    value: variable.value,
  };
}

/** Full variable row (backup / in-memory); preserves sensitive values. */
function toStoredVariableFull(
  variable: VariableDefinition | ProjectStoreVariable,
): ProjectStoreVariable {
  return {
    name: variable.name,
    value: variable.value,
    ...(variable.sensitive === true ? { sensitive: true } : {}),
  };
}

function authenticationValueSourceEntries(
  profile: AuthenticationProfile,
): readonly (readonly [string, AuthenticationValueSource])[] {
  switch (profile.providerId) {
    case 'none':
      return [];
    case 'basic':
      return [
        ['username', asValueSource(profile, 'username')],
        ['password', asValueSource(profile, 'password')],
      ].filter(
        (entry): entry is [string, AuthenticationValueSource] =>
          entry[1] !== undefined,
      );
    case 'bearer':
      return [['token', asValueSource(profile, 'token')]].filter(
        (entry): entry is [string, AuthenticationValueSource] =>
          entry[1] !== undefined,
      );
    case 'apiKey':
      return [['value', asValueSource(profile, 'value')]].filter(
        (entry): entry is [string, AuthenticationValueSource] =>
          entry[1] !== undefined,
      );
    default:
      return Object.entries(profile).filter(
        (entry): entry is [string, AuthenticationValueSource] =>
          isValueSource(entry[1]),
      );
  }
}

function asValueSource(
  profile: AuthenticationProfile,
  field: string,
): AuthenticationValueSource | undefined {
  const source = (profile as Readonly<Record<string, unknown>>)[field];
  return isValueSource(source) ? source : undefined;
}

function isValueSource(value: unknown): value is AuthenticationValueSource {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const source = value as Partial<AuthenticationValueSource>;
  return (
    source.kind === 'secret' ||
    (source.kind === 'variable' && typeof source.name === 'string') ||
    (source.kind === 'literal' &&
      typeof source.value === 'string' &&
      source.unsafe === true)
  );
}

