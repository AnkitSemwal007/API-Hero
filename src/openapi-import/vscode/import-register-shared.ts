/**
 * Shared VS Code registration helpers for OpenAPI / Postman / Insomnia import.
 * Keeps writer + settings-patch logic in one place (no third near-copy).
 */

import { mkdir, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';

import { ConfigurationTarget, workspace } from 'vscode';

import {
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
} from '../../constants';
import type { AuthenticationProfile } from '../../models';
import {
  getActiveProjectStoreCoordinator,
} from '../../project-store/vscode/project-store-coordinator';
import { resolveProjectStoreFolderPath } from '../../project-store/vscode/resolve-project-folder';
import type { SettingsPatch, WorkspaceFileWriter } from '../index';

/** Node fs-backed workspace writer used by all import command registrations. */
export function createVsCodeWorkspaceWriter(): WorkspaceFileWriter {
  return {
    async mkdir(absolutePath: string): Promise<void> {
      await mkdir(absolutePath, { recursive: true });
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await writeFile(absolutePath, content, 'utf8');
    },
    async deleteFile(absolutePath: string): Promise<void> {
      await unlink(absolutePath);
    },
    async removeDirectory(absolutePath: string): Promise<void> {
      await rmdir(absolutePath);
    },
    async isNonEmptyDirectory(absolutePath: string): Promise<boolean> {
      try {
        const entries = await readdir(absolutePath);
        return entries.length > 0;
      } catch {
        return false;
      }
    },
    async listDirectory(absolutePath: string): Promise<readonly string[]> {
      return readdir(absolutePath);
    },
  };
}

/** Reads authentication profiles from workspace settings (or empty). */
export function readAuthProfilesFromWorkspace(): readonly AuthenticationProfile[] {
  return workspace
    .getConfiguration(CONFIGURATION_SECTION)
    .get<readonly AuthenticationProfile[]>(
      CONFIGURATION_KEYS.authenticationProfiles,
      [],
    );
}

/**
 * Applies an import settings patch to project store (when in project mode) or
 * workspace settings. Strips unsupported OAuth provider ids to schema-safe values.
 */
export async function applyImportSettingsPatch(
  patch: SettingsPatch,
): Promise<void> {
  const authPayload = patch.authenticationProfiles.map((profile) => {
    const providerId = profile.providerId;
    if (
      providerId === 'none' ||
      providerId === 'basic' ||
      providerId === 'bearer' ||
      providerId === 'apiKey'
    ) {
      return sanitizeProfileForSettings(profile) as AuthenticationProfile;
    }
    return {
      id: profile.id,
      label: profile.label,
      providerId: 'none',
    } as AuthenticationProfile;
  });

  const environments = patch.environments.map((environment) => ({
    id: environment.id,
    name: environment.name,
    variables: environment.variables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive === true,
      scope: 'environment' as const,
    })),
  }));

  const coordinator = getActiveProjectStoreCoordinator();
  const folder = resolveProjectStoreFolderPath();
  if (
    coordinator !== undefined &&
    folder !== undefined &&
    coordinator.isProjectMode(folder)
  ) {
    const cached = coordinator.getCached(folder);
    await coordinator.writeProjectMetadata(folder, {
      environments,
      workspaceVariables: cached?.workspaceVariables ?? [],
      activeEnvironmentId:
        patch.activeEnvironmentId ?? cached?.activeEnvironmentId,
      authenticationProfiles: authPayload,
    });
    return;
  }

  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);

  const environmentPayload = environments.map((environment) => ({
    id: environment.id,
    name: environment.name,
    variables: environment.variables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      ...(variable.sensitive ? { sensitive: true } : {}),
    })),
  }));

  await configuration.update(
    CONFIGURATION_KEYS.environments,
    environmentPayload,
    ConfigurationTarget.Workspace,
  );

  if (patch.activeEnvironmentId !== undefined) {
    await configuration.update(
      CONFIGURATION_KEYS.activeEnvironment,
      patch.activeEnvironmentId,
      ConfigurationTarget.Workspace,
    );
  }

  await configuration.update(
    CONFIGURATION_KEYS.authenticationProfiles,
    authPayload,
    ConfigurationTarget.Workspace,
  );
}

function sanitizeProfileForSettings(
  profile: AuthenticationProfile,
): Record<string, unknown> {
  const allowed = new Set([
    'id',
    'label',
    'providerId',
    'username',
    'password',
    'token',
    'value',
    'name',
    'location',
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (allowed.has(key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
