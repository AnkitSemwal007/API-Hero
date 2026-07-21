/**
 * VS Code WebviewPanel host for the OpenAPI Import multi-step wizard.
 * Wraps the existing import pipeline — no duplicate parsers/writers.
 */

import { randomBytes } from 'node:crypto';

import {
  commands,
  Uri,
  ViewColumn,
  window,
  workspace,
  type Disposable,
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
import {
  parseOpenApiImportWizardMessage,
  renderOpenApiImportWizardHtml,
  type OpenApiImportWizardFolder,
  type OpenApiImportWizardPreview,
  type OpenApiImportWizardState,
  type OpenApiImportWizardSummaryView,
} from './openapi-import-wizard-html';

const PANEL_VIEW_TYPE = 'apiRunner.openapiImportWizard';
const PANEL_TITLE = 'Import OpenAPI';

export interface OpenOpenApiImportWizardOptions {
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly writer: WorkspaceFileWriter;
  readonly readEnvironments: () => readonly Environment[];
  readonly readAuthProfiles: () => readonly AuthenticationProfile[];
  readonly applySettingsPatch: (patch: SettingsPatch) => Promise<void>;
  /** When false, summary omits the Manage Auth Profiles CTA. */
  readonly manageAuthAvailable?: boolean;
}

/**
 * Opens the OpenAPI Import wizard. Resolves when the panel closes.
 * Returns `true` when an import completed successfully.
 */
export async function openOpenApiImportWizard(
  options: OpenOpenApiImportWizardOptions,
): Promise<boolean> {
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    void window.showErrorMessage(
      'Open a workspace folder before importing an OpenAPI specification.',
    );
    return false;
  }

  const wizardFolders: OpenApiImportWizardFolder[] = folders.map((folder) => ({
    name: folder.name,
    path: folder.uri.fsPath,
  }));
  const skipWorkspaceStep = wizardFolders.length === 1;
  const manageAuthAvailable = options.manageAuthAvailable !== false;

  return new Promise((resolve) => {
    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      { viewColumn: ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    let settled = false;
    let importSucceeded = false;
    let selectedFolderPath = wizardFolders[0]!.path;
    let selectedFileUri: Uri | undefined;
    let sourceText = '';
    let outputDirectoryName = '';
    let cancelRequested = false;
    const disposables: Disposable[] = [];

    const finish = (success: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const disposable of disposables) {
        disposable.dispose();
      }
      panel.dispose();
      resolve(success);
    };

    const nonce = randomBytes(18).toString('base64url');
    panel.webview.html = renderOpenApiImportWizardHtml(nonce);

    const initialState = (): OpenApiImportWizardState => ({
      folders: wizardFolders,
      skipWorkspaceStep,
      selectedFolderPath,
      manageAuthAvailable,
      step: skipWorkspaceStep ? 'file' : 'workspace',
    });

    const post = async (
      message: Parameters<typeof panel.webview.postMessage>[0],
    ): Promise<void> => {
      if (settled) {
        return;
      }
      await panel.webview.postMessage(message);
    };

    const maxFileBytes = (): number =>
      normalizeImportMaxFileBytes(
        workspace
          .getConfiguration(CONFIGURATION_SECTION)
          .get(CONFIGURATION_KEYS.importMaxFileBytes),
      );

    const buildPreview = (
      summary: ImportSummary,
      suggestedOutput: string,
    ): OpenApiImportWizardPreview => {
      const warnings = summary.diagnostics
        .filter((item) => item.severity === 'warning')
        .map((item) => item.message);
      return {
        apiName: summary.apiName,
        apiVersion: summary.apiVersion,
        openapiVersion: summary.openapiVersion,
        folderCount: summary.folderCount,
        requestCount: summary.requestCount,
        environmentCount: summary.environmentCount,
        variableCount: summary.variableCount,
        authProfileCount: summary.authProfileCount,
        outputDirectoryName: suggestedOutput || outputDirectoryName,
        warningCount: warnings.length,
        warnings: warnings.slice(0, 12),
      };
    };

    const buildSummaryView = (
      summary: ImportSummary,
      patch: SettingsPatch | undefined,
    ): OpenApiImportWizardSummaryView => {
      const errors = summary.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => item.message);
      const warnings = summary.diagnostics
        .filter((item) => item.severity === 'warning')
        .map((item) => item.message);
      return {
        success: summary.success,
        cancelled: summary.cancelled,
        apiName: summary.apiName,
        apiVersion: summary.apiVersion,
        openapiVersion: summary.openapiVersion,
        folderCount: summary.folderCount,
        requestCount: summary.requestCount,
        environmentCount: summary.environmentCount,
        variableCount: summary.variableCount,
        authProfileCount: summary.authProfileCount,
        targetDirectory: summary.targetDirectory,
        writtenFileCount: summary.writtenFiles.length,
        warningCount: warnings.length,
        errorCount: errors.length,
        warnings: warnings.slice(0, 12),
        errors: errors.slice(0, 12),
        secretHints: patch?.secretHints.slice(0, 16) ?? [],
        manageAuthAvailable,
      };
    };

    const runAnalyze = async (requestedOutput: string): Promise<void> => {
      if (selectedFileUri === undefined || sourceText.length === 0) {
        await post({
          type: 'previewError',
          message: 'Select an OpenAPI specification file first.',
        });
        return;
      }
      outputDirectoryName = requestedOutput.trim();
      try {
        const result = await runImportPipeline({
          sourceText,
          sourcePath: selectedFileUri.fsPath,
          fileName: selectedFileUri.path.split('/').pop(),
          targetRoot: selectedFolderPath,
          ...(outputDirectoryName.length > 0
            ? { outputDirectoryName }
            : {}),
          limits: { maxFileBytes: maxFileBytes() },
          existingEnvironments: options.readEnvironments(),
          existingAuthProfiles: options.readAuthProfiles(),
          writer: options.writer,
          skipWrite: true,
        });

        if (!result.summary.success) {
          const firstError = result.summary.diagnostics.find(
            (item) => item.severity === 'error',
          );
          await post({
            type: 'previewError',
            message:
              firstError?.message ??
              'Specification could not be analyzed for import.',
          });
          return;
        }

        const suggested =
          result.artifacts?.outputDirectoryName ?? outputDirectoryName;
        if (outputDirectoryName.length === 0 && suggested.length > 0) {
          outputDirectoryName = suggested;
        }
        await post({
          type: 'preview',
          preview: buildPreview(result.summary, suggested),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        options.logger.warning('OpenAPI import preview failed', { message });
        await post({ type: 'previewError', message });
      }
    };

    const runImport = async (requestedOutput: string): Promise<void> => {
      if (selectedFileUri === undefined || sourceText.length === 0) {
        await post({
          type: 'error',
          message: 'Select an OpenAPI specification file first.',
        });
        return;
      }
      outputDirectoryName = requestedOutput.trim();
      cancelRequested = false;
      const cancellation = {
        get isCancellationRequested(): boolean {
          return cancelRequested;
        },
      };

      try {
        const result = await runImportPipeline({
          sourceText,
          sourcePath: selectedFileUri.fsPath,
          fileName: selectedFileUri.path.split('/').pop(),
          targetRoot: selectedFolderPath,
          ...(outputDirectoryName.length > 0
            ? { outputDirectoryName }
            : {}),
          limits: { maxFileBytes: maxFileBytes() },
          existingEnvironments: options.readEnvironments(),
          existingAuthProfiles: options.readAuthProfiles(),
          cancellation,
          writer: options.writer,
          onProgress: (event: ImportProgressEvent) => {
            void post({
              type: 'progress',
              phase: event.phase,
              message: event.message,
            });
          },
        });

        if (result.summary.cancelled) {
          await post({
            type: 'summary',
            summary: buildSummaryView(result.summary, undefined),
          });
          options.logger.info('OpenAPI import cancelled from wizard');
          return;
        }

        if (result.summary.success && result.settingsPatch !== undefined) {
          await options.applySettingsPatch(result.settingsPatch);
        }

        if (result.summary.success) {
          await post({
            type: 'progress',
            phase: 'refreshing',
            message: 'Refreshing collections…',
          });
          await options.discovery.refresh();
          importSucceeded = true;
        }

        await post({
          type: 'summary',
          summary: buildSummaryView(
            result.summary,
            result.summary.success ? result.settingsPatch : undefined,
          ),
        });
        options.logger.info('OpenAPI import finished', {
          success: result.summary.success,
          requests: result.summary.requestCount,
          target: result.summary.targetDirectory,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        options.logger.warning('OpenAPI import failed', { message });
        await post({ type: 'error', message: `OpenAPI import failed: ${message}` });
      }
    };

    disposables.push(
      panel.webview.onDidReceiveMessage((raw) => {
        void (async () => {
          const message = parseOpenApiImportWizardMessage(raw);
          if (message === undefined) {
            return;
          }

          switch (message.type) {
            case 'ready': {
              await post({ type: 'init', state: initialState() });
              return;
            }
            case 'cancel':
            case 'close': {
              finish(importSucceeded);
              return;
            }
            case 'selectWorkspace': {
              const match = wizardFolders.find(
                (folder) => folder.path === message.path,
              );
              if (match === undefined) {
                await post({
                  type: 'error',
                  message: 'Select a valid workspace folder.',
                });
                return;
              }
              selectedFolderPath = match.path;
              return;
            }
            case 'pickFile': {
              const picked = await window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                  'OpenAPI Specification': ['json', 'yaml', 'yml'],
                },
                title: 'Import OpenAPI Specification',
                openLabel: 'Select',
              });
              if (picked === undefined || picked.length === 0) {
                return;
              }
              const fileUri = picked[0]!;
              const sizeCheck = evaluateImportSourceSize(
                (await workspace.fs.stat(fileUri)).size,
                maxFileBytes(),
              );
              if (!sizeCheck.ok) {
                await post({
                  type: 'error',
                  message: sizeCheck.diagnostic.message,
                });
                options.logger.warning('OpenAPI import rejected before read', {
                  message: sizeCheck.diagnostic.message,
                });
                return;
              }
              const bytes = await workspace.fs.readFile(fileUri);
              sourceText = Buffer.from(bytes).toString('utf8');
              selectedFileUri = fileUri;
              const name = fileUri.path.split('/').pop() ?? fileUri.fsPath;
              await post({
                type: 'fileSelected',
                path: fileUri.fsPath,
                name,
              });
              return;
            }
            case 'analyze': {
              await runAnalyze(message.outputDirectoryName);
              return;
            }
            case 'startImport': {
              await runImport(message.outputDirectoryName);
              return;
            }
            case 'cancelImport': {
              cancelRequested = true;
              return;
            }
            case 'manageAuthProfiles': {
              if (manageAuthAvailable) {
                await commands.executeCommand(COMMAND_IDS.manageAuthProfiles);
              }
              return;
            }
            case 'back': {
              // UI owns step visibility; host only clears transient errors.
              return;
            }
            default: {
              return;
            }
          }
        })();
      }),
      panel.onDidDispose(() => {
        cancelRequested = true;
        finish(importSucceeded);
      }),
    );
  });
}
