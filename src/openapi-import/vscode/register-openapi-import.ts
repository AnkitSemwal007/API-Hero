import { mkdir, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';

import {
  ConfigurationTarget,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';

import type { CollectionDiscoveryService } from '../../collections';
import {
  COMMAND_IDS,
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
} from '../../constants';
import { NodeHttpTransport } from '../../execution';
import type { AuthenticationProfile } from '../../models';
import type { Logger } from '../../shared';
import {
  getActiveProjectStoreCoordinator,
} from '../../project-store/vscode/project-store-coordinator';
import { resolveProjectStoreFolderPath } from '../../project-store/vscode/resolve-project-folder';
import type { EnvironmentManager } from '../../variables';
import type { SettingsPatch, WorkspaceFileWriter } from '../index';
import { openOpenApiImportWizard } from './openapi-import-wizard';

export interface RegisterOpenApiImportOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly environmentManager: EnvironmentManager;
}

export interface OpenApiImportRegistration {
  readonly disposables: readonly Disposable[];
}

/**
 * Registers `apiHero.importOpenApi` to open the multi-step import wizard.
 * Called from `extension.ts` only — keeps activate composition-only.
 */
export function registerOpenApiImport(
  options: RegisterOpenApiImportOptions,
): OpenApiImportRegistration {
  const { context, logger, discovery, environmentManager } = options;

  const registration = registerCommandWithLegacyAlias(
    COMMAND_IDS.importOpenApi,
    async () => {
      await openOpenApiImportWizard({
        logger,
        discovery,
        writer: createVsCodeWorkspaceWriter(),
        // Same source as active id (project-aware EnvironmentManager), not
        // settings-only — keeps append + activate gating consistent.
        readEnvironments: () => environmentManager.list(),
        readActiveEnvironmentId: () => environmentManager.activeId,
        readAuthProfiles,
        applySettingsPatch,
        manageAuthAvailable: true,
        transport: new NodeHttpTransport(),
      });
    },
  );

  context.subscriptions.push(registration);
  return { disposables: [registration] };
}

function createVsCodeWorkspaceWriter(): WorkspaceFileWriter {
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

function readAuthProfiles(): readonly AuthenticationProfile[] {
  return workspace
    .getConfiguration(CONFIGURATION_SECTION)
    .get<readonly AuthenticationProfile[]>(
      CONFIGURATION_KEYS.authenticationProfiles,
      [],
    );
}

async function applySettingsPatch(patch: SettingsPatch): Promise<void> {
  // Strip extension-only OAuth metadata keys that violate the settings schema
  // enum for providerId — keep executable profiles; record oauth as none.
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
  // Only dual-write when already in project mode — avoid ensureInitialized
  // empty-store shadow of workspace settings before first full env save.
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
