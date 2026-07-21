/**
 * Writes authentication profile metadata through VS Code settings only.
 * Secrets stay in SecretStorage — never written here.
 */

import { ConfigurationTarget, workspace } from 'vscode';

import {
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
} from '../../constants';
import type {
  AuthenticationProfile,
  AuthenticationValueSource,
} from '../../models';
import type { AuthManagerState } from './auth-manager-html';

/** Persists Auth Manager metadata to `apiRunner.authentication.profiles`. */
export async function writeAuthManagerState(
  state: AuthManagerState,
  baseline: readonly AuthenticationProfile[],
): Promise<void> {
  const baselineById = new Map(
    baseline.map((profile) => [profile.id, profile] as const),
  );
  const profiles = state.profiles.map((profile) =>
    toSettingsProfile(profile, baselineById.get(profile.id)),
  );
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  await configuration.update(
    CONFIGURATION_KEYS.authenticationProfiles,
    profiles,
    resolveWorkspaceOrGlobalTarget(),
  );
}

function toSettingsProfile(
  profile: AuthManagerState['profiles'][number],
  baseline: AuthenticationProfile | undefined,
): AuthenticationProfile {
  const label = profile.label.trim();
  const id = profile.id.trim();
  const sameProvider =
    baseline !== undefined && baseline.providerId === profile.providerId;

  switch (profile.providerId) {
    case 'none':
      return {
        id,
        providerId: 'none',
        ...(label.length > 0 ? { label } : {}),
      };
    case 'basic':
      return {
        id,
        providerId: 'basic',
        ...(label.length > 0 ? { label } : {}),
        username: sameProvider
          ? preserveOrSecret(baseline, 'username')
          : { kind: 'secret' },
        password: sameProvider
          ? preserveOrSecret(baseline, 'password')
          : { kind: 'secret' },
      };
    case 'bearer':
      return {
        id,
        providerId: 'bearer',
        ...(label.length > 0 ? { label } : {}),
        token: sameProvider
          ? preserveOrSecret(baseline, 'token')
          : { kind: 'secret' },
      };
    case 'apiKey':
      return {
        id,
        providerId: 'apiKey',
        ...(label.length > 0 ? { label } : {}),
        name: (profile.apiKeyName ?? '').trim(),
        location: profile.apiKeyLocation === 'query' ? 'query' : 'header',
        value: sameProvider
          ? preserveOrSecret(baseline, 'value')
          : { kind: 'secret' },
      };
  }
}

function preserveOrSecret(
  baseline: AuthenticationProfile,
  field: string,
): AuthenticationValueSource {
  const source = (baseline as Readonly<Record<string, unknown>>)[field];
  if (isValueSource(source)) {
    return source;
  }
  return { kind: 'secret' };
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

function resolveWorkspaceOrGlobalTarget(): ConfigurationTarget {
  return (workspace.workspaceFolders?.length ?? 0) > 0
    ? ConfigurationTarget.Workspace
    : ConfigurationTarget.Global;
}
