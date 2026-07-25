/**
 * Persists Auth Manager metadata.
 * Secrets stay in SecretStorage — never written here.
 *
 * When already in `.apihero` project mode, profiles are written to
 * `.apihero/auth/profiles.json` as SoT and are NOT mirrored to workspace
 * settings (settings remain an untouched compatibility fallback).
 * When a folder is open but project mode is not active yet, writes stay in
 * VS Code settings — partial writers must not `ensureInitialized` an empty
 * store that would shadow settings via dual-read.
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
import {
  getActiveProjectStoreCoordinator,
} from '../../project-store/vscode/project-store-coordinator';
import {
  isProjectStoreMode,
  resolveProjectStoreFolderPath,
} from '../../project-store/vscode/resolve-project-folder';
import type { AuthManagerState } from './auth-manager-html';

/** Persists Auth Manager metadata (project store or settings). */
export async function writeAuthManagerState(
  state: AuthManagerState,
  baseline: readonly AuthenticationProfile[],
): Promise<void> {
  const nextIds = new Set(state.profiles.map((profile) => profile.id));
  const profiles = state.profiles.map((profile, index) => {
    const byId = baseline.find((entry) => entry.id === profile.id);
    const byIndex = baseline[index];
    // When the profile id was renamed, preserve credential sources from the
    // prior id at the same index (baseline lookup by new id would miss).
    const baselineProfile =
      byId ??
      (byIndex !== undefined && !nextIds.has(byIndex.id) ? byIndex : undefined);
    return toSettingsProfile(profile, baselineProfile);
  });

  const coordinator = getActiveProjectStoreCoordinator();
  const folder = resolveProjectStoreFolderPath();
  if (
    coordinator !== undefined &&
    folder !== undefined &&
    isProjectStoreMode()
  ) {
    await coordinator.writeAuthProfiles(folder, profiles);
    return;
  }

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
