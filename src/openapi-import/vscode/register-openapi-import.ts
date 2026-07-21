import { mkdir, writeFile } from 'node:fs/promises';

import {
  commands,
  ConfigurationTarget,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import type { CollectionDiscoveryService } from '../../collections';
import {
  COMMAND_IDS,
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
} from '../../constants';
import type { AuthenticationProfile, Environment } from '../../models';
import type { Logger } from '../../shared';
import type { SettingsPatch, WorkspaceFileWriter } from '../index';
import { openOpenApiImportWizard } from './openapi-import-wizard';

export interface RegisterOpenApiImportOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
}

export interface OpenApiImportRegistration {
  readonly disposables: readonly Disposable[];
}

/**
 * Registers `apiRunner.importOpenApi` to open the multi-step import wizard.
 * Called from `extension.ts` only — keeps activate composition-only.
 */
export function registerOpenApiImport(
  options: RegisterOpenApiImportOptions,
): OpenApiImportRegistration {
  const { context, logger, discovery } = options;

  const registration = commands.registerCommand(
    COMMAND_IDS.importOpenApi,
    async () => {
      await openOpenApiImportWizard({
        logger,
        discovery,
        writer: createVsCodeWorkspaceWriter(),
        readEnvironments,
        readAuthProfiles,
        applySettingsPatch,
        manageAuthAvailable: true,
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
  };
}

function readEnvironments(): readonly Environment[] {
  const raw = workspace
    .getConfiguration(CONFIGURATION_SECTION)
    .get<unknown>(CONFIGURATION_KEYS.environments, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item, index) => {
    const record = asRecord(item);
    const id =
      typeof record.id === 'string' && record.id.length > 0
        ? record.id
        : `env-${index}`;
    const variables = Array.isArray(record.variables)
      ? record.variables.map((variable) => {
          const entry = asRecord(variable);
          return {
            name: typeof entry.name === 'string' ? entry.name : '',
            value: typeof entry.value === 'string' ? entry.value : '',
            sensitive: entry.sensitive === true,
            scope: 'environment' as const,
          };
        })
      : [];
    return {
      id,
      name: typeof record.name === 'string' ? record.name : id,
      variables,
    };
  });
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
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);

  const environmentPayload = patch.environments.map((environment) => ({
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
      return sanitizeProfileForSettings(profile);
    }
    return {
      id: profile.id,
      label: profile.label,
      providerId: 'none',
    };
  });

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
