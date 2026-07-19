import { mkdir, writeFile } from 'node:fs/promises';

import {
  commands,
  ConfigurationTarget,
  ProgressLocation,
  Uri,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type Progress,
} from 'vscode';

import type { CollectionDiscoveryService } from '../../collections';
import {
  COMMAND_IDS,
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
  normalizeImportMaxFileBytes,
} from '../../constants';
import type { AuthenticationProfile, Environment } from '../../models';
import type { Logger } from '../../shared';
import {
  evaluateImportSourceSize,
  runImportPipeline,
  type ImportProgressEvent,
  type ImportSummary,
  type SettingsPatch,
  type WorkspaceFileWriter,
} from '../index';

export interface RegisterOpenApiImportOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
}

export interface OpenApiImportRegistration {
  readonly disposables: readonly Disposable[];
}

/**
 * Registers `apiRunner.importOpenApi` with file picker, progress, and summary.
 * Called from `extension.ts` only — keeps activate composition-only.
 */
export function registerOpenApiImport(
  options: RegisterOpenApiImportOptions,
): OpenApiImportRegistration {
  const { context, logger, discovery } = options;

  const registration = commands.registerCommand(
    COMMAND_IDS.importOpenApi,
    async () => {
      await executeImportOpenApi(logger, discovery);
    },
  );

  context.subscriptions.push(registration);
  return { disposables: [registration] };
}

async function executeImportOpenApi(
  logger: Logger,
  discovery: CollectionDiscoveryService,
): Promise<void> {
  const folder = await pickWorkspaceFolder();
  if (folder === undefined) {
    return;
  }

  const picked = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'OpenAPI Specification': ['json', 'yaml', 'yml'],
    },
    title: 'Import OpenAPI Specification',
    openLabel: 'Import',
  });

  if (picked === undefined || picked.length === 0) {
    return;
  }

  const fileUri = picked[0]!;
  const maxFileBytes = normalizeImportMaxFileBytes(
    workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get(CONFIGURATION_KEYS.importMaxFileBytes),
  );

  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: 'API Runner: Importing OpenAPI…',
      cancellable: true,
    },
    async (progress, token) => {
      const cancellation = {
        get isCancellationRequested(): boolean {
          return token.isCancellationRequested;
        },
      };

      try {
        progress.report({ message: 'Checking file size…' });
        const stat = await workspace.fs.stat(fileUri);
        const sizeCheck = evaluateImportSourceSize(stat.size, maxFileBytes);
        if (!sizeCheck.ok) {
          void window.showErrorMessage(sizeCheck.diagnostic.message);
          logger.warning('OpenAPI import rejected before read', {
            message: sizeCheck.diagnostic.message,
          });
          return;
        }

        const bytes = await workspace.fs.readFile(fileUri);
        const sourceText = Buffer.from(bytes).toString('utf8');

        const result = await runImportPipeline({
          sourceText,
          sourcePath: fileUri.fsPath,
          fileName: fileUri.path.split('/').pop(),
          targetRoot: folder.uri.fsPath,
          limits: { maxFileBytes },
          existingEnvironments: readEnvironments(),
          existingAuthProfiles: readAuthProfiles(),
          cancellation,
          writer: createVsCodeWorkspaceWriter(),
          onProgress: (event) => reportProgress(progress, event),
        });

        if (result.summary.cancelled) {
          void window.showWarningMessage('OpenAPI import cancelled.');
          return;
        }

        // Settings and collections refresh only on success (no error diagnostics).
        if (result.summary.success && result.settingsPatch !== undefined) {
          await applySettingsPatch(result.settingsPatch);
        }

        if (result.summary.success) {
          progress.report({ message: 'Refreshing collections…' });
          await discovery.refresh();
        }

        await showImportSummary(
          result.summary,
          result.summary.success ? result.settingsPatch : undefined,
        );
        logger.info('OpenAPI import finished', {
          success: result.summary.success,
          requests: result.summary.requestCount,
          target: result.summary.targetDirectory,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.warning('OpenAPI import failed', { message });
        void window.showErrorMessage(`OpenAPI import failed: ${message}`);
      }
    },
  );
}

function reportProgress(
  progress: Progress<{ message?: string; increment?: number }>,
  event: ImportProgressEvent,
): void {
  progress.report({ message: event.message });
}

async function pickWorkspaceFolder(): Promise<
  | { readonly uri: Uri; readonly name: string }
  | undefined
> {
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    void window.showErrorMessage(
      'Open a workspace folder before importing an OpenAPI specification.',
    );
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  const selected = await window.showWorkspaceFolderPick({
    placeHolder: 'Select the workspace folder for imported `.api` files',
  });
  return selected;
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

async function showImportSummary(
  summary: ImportSummary,
  patch: SettingsPatch | undefined,
): Promise<void> {
  const errors = summary.diagnostics.filter((item) => item.severity === 'error');
  const warnings = summary.diagnostics.filter(
    (item) => item.severity === 'warning',
  );

  const lines = [
    `${summary.apiName || 'OpenAPI'} ${summary.apiVersion}`.trim(),
    `OpenAPI ${summary.openapiVersion || 'unknown'}`,
    `Folders: ${summary.folderCount}, Requests: ${summary.requestCount}`,
    `Environments: ${summary.environmentCount}, Variables: ${summary.variableCount}`,
    `Auth profiles: ${summary.authProfileCount}`,
    `Output: ${summary.targetDirectory}`,
    `Files written: ${summary.writtenFiles.length}`,
    `Warnings: ${warnings.length}, Errors: ${errors.length}`,
  ];

  if (patch !== undefined && patch.secretHints.length > 0) {
    lines.push('', 'Secret placeholders (configure SecretStorage):');
    for (const hint of patch.secretHints.slice(0, 8)) {
      lines.push(`• ${hint}`);
    }
  }

  if (errors.length > 0) {
    lines.push('', 'Errors:');
    for (const item of errors.slice(0, 10)) {
      lines.push(`• ${item.message}`);
    }
  } else if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const item of warnings.slice(0, 8)) {
      lines.push(`• ${item.message}`);
    }
  }

  const detail = lines.join('\n');
  if (!summary.success) {
    await window.showErrorMessage(
      `OpenAPI import finished with errors (${errors.length}).`,
      { modal: true, detail },
    );
    return;
  }

  if (warnings.length > 0) {
    await window.showWarningMessage(
      `Imported ${summary.requestCount} request(s) with ${warnings.length} warning(s).`,
      { modal: true, detail },
    );
    return;
  }

  await window.showInformationMessage(
    `Imported ${summary.requestCount} request(s) into ${summary.targetDirectory}.`,
    { modal: true, detail },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
