/**
 * Shared VS Code WebviewPanel host for specification import wizards.
 * Parameterized by provider / labels / filters; OpenAPI may enable URL source.
 *
 * Security: `selectWorkspace` is allowlisted against wizardFolders only.
 */

import { readdir } from 'node:fs/promises';

import {
  commands,
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
import {
  NodeHttpTransport,
  type HttpTransport,
} from '../../execution';
import type { AuthenticationProfile, Environment } from '../../models';
import type { Logger } from '../../shared';
import { createWebviewNonce } from '../../ui/webview';
import {
  evaluateImportSourceSize,
  fetchOpenApiSpecUrl,
  resolveUnderTarget,
  rollbackWrittenFiles,
  runImportPipeline,
  type ImportProgressEvent,
  type ImportSummary,
  type SettingsPatch,
  type SpecificationImportProvider,
  type WorkspaceFileWriter,
} from '../index';

export interface ImportWizardFolder {
  readonly name: string;
  readonly path: string;
}

export interface ImportWizardPreviewBase {
  readonly apiName: string;
  readonly apiVersion: string;
  readonly formatVersion: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly environmentCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly scriptWarningCount: number;
  readonly unsupportedFeatureCount: number;
  readonly outputDirectoryName: string;
  readonly warningCount: number;
  readonly warnings: readonly string[];
}

export interface ImportWizardSummaryBase {
  readonly success: boolean;
  readonly cancelled: boolean;
  readonly apiName: string;
  readonly apiVersion: string;
  readonly formatVersion: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly environmentCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly scriptWarningCount: number;
  readonly unsupportedFeatureCount: number;
  readonly targetDirectory: string;
  readonly writtenFileCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly secretHints: readonly string[];
  readonly manageAuthAvailable: boolean;
}

export type ImportWizardInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'cancel' }
  | { readonly type: 'close' }
  | { readonly type: 'selectWorkspace'; readonly path: string }
  | { readonly type: 'pickFile' }
  | { readonly type: 'fetchUrl'; readonly url: string }
  | { readonly type: 'analyze'; readonly outputDirectoryName: string }
  | { readonly type: 'startImport'; readonly outputDirectoryName: string }
  | { readonly type: 'cancelImport' }
  | { readonly type: 'manageAuthProfiles' }
  | { readonly type: 'back'; readonly to?: string };

export interface ImportWizardFormatConfig {
  readonly panelViewType: string;
  readonly panelTitle: string;
  readonly noWorkspaceMessage: string;
  readonly sourceMissingMessage: string;
  readonly analyzeFailureMessage: string;
  readonly fileFilters: { readonly [name: string]: readonly string[] };
  readonly fileDialogTitle?: string;
  readonly openLabel?: string;
  /** Forced provider (OpenAPI / Postman / Insomnia). */
  readonly provider?: SpecificationImportProvider;
  readonly renderHtml: (nonce: string) => string;
  readonly parseMessage: (
    value: unknown,
  ) => ImportWizardInboundMessage | undefined;
  /** Diagnostic code prefix for unsupported features (e.g. `postman-unsupported`). */
  readonly unsupportedCodePrefix?: string;
  /** Exact diagnostic code counted as script warnings. */
  readonly scriptWarningCode?: string;
  readonly logLabel: string;
  /** When true, host handles `fetchUrl` (OpenAPI URL source). */
  readonly enableUrlSource?: boolean;
  readonly transport?: HttpTransport;
  /**
   * Message type for file-picker size/read failures.
   * Defaults to `previewError` (file step). OpenAPI uses `error` to keep step.
   */
  readonly filePickErrorType?: 'error' | 'previewError';
  /**
   * When true (default for collection formats), preview includes
   * script/unsupported feature counters. OpenAPI sets false.
   */
  readonly includeUnsupportedCounters?: boolean;
  /** Preview/summary field alias used by OpenAPI HTML (`openapiVersion`). */
  readonly formatVersionField?: 'formatVersion' | 'openapiVersion';
}

export interface OpenImportWizardHostOptions {
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly writer: WorkspaceFileWriter;
  readonly readEnvironments: () => readonly Environment[];
  readonly readActiveEnvironmentId: () => string | undefined;
  readonly readAuthProfiles: () => readonly AuthenticationProfile[];
  readonly applySettingsPatch: (patch: SettingsPatch) => Promise<void>;
  readonly manageAuthAvailable?: boolean;
  readonly format: ImportWizardFormatConfig;
}

/**
 * Opens a parameterized import wizard. Resolves when the panel closes.
 * Returns `true` when an import completed successfully.
 */
export async function openImportWizardHost(
  options: OpenImportWizardHostOptions,
): Promise<boolean> {
  const format = options.format;
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    void window.showErrorMessage(format.noWorkspaceMessage);
    return false;
  }

  const wizardFolders: ImportWizardFolder[] = folders.map((folder) => ({
    name: folder.name,
    path: folder.uri.fsPath,
  }));
  const skipWorkspaceStep = wizardFolders.length === 1;
  const manageAuthAvailable = options.manageAuthAvailable !== false;
  const includeUnsupported = format.includeUnsupportedCounters !== false;
  const formatField = format.formatVersionField ?? 'formatVersion';
  const transport =
    format.enableUrlSource === true
      ? (format.transport ?? new NodeHttpTransport())
      : undefined;

  return new Promise((resolve) => {
    const panel = window.createWebviewPanel(
      format.panelViewType,
      format.panelTitle,
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
    let sourcePath = '';
    let sourceFileName: string | undefined;
    let sourceText = '';
    let outputDirectoryName = '';
    let cancelRequested = false;
    let fetchGeneration = 0;
    let fetchAbort: AbortController | undefined;
    let fetchInFlight = false;
    const disposables: Disposable[] = [];

    const abortInFlightFetch = (): void => {
      if (format.enableUrlSource !== true) {
        return;
      }
      fetchGeneration += 1;
      fetchInFlight = false;
      fetchAbort?.abort();
      fetchAbort = undefined;
    };

    const finish = (success: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      abortInFlightFetch();
      importSucceeded = success;
      panel.dispose();
    };

    const post = async (message: unknown): Promise<void> => {
      if (settled) {
        return;
      }
      try {
        await panel.webview.postMessage(message);
      } catch {
        // Panel may already be disposed.
      }
    };

    const maxFileBytes = (): number =>
      normalizeImportMaxFileBytes(
        workspace
          .getConfiguration(CONFIGURATION_SECTION)
          .get(CONFIGURATION_KEYS.importMaxFileBytes),
      );

    const countByCode = (
      summary: ImportSummary,
      predicate: (code: string) => boolean,
    ): number =>
      summary.diagnostics.filter((item) => predicate(item.code)).length;

    const buildPreview = (
      summary: ImportSummary,
      suggestedOutput: string,
    ): Record<string, unknown> => {
      const warnings = summary.diagnostics
        .filter((item) => item.severity === 'warning')
        .map((item) => item.message);
      const base: Record<string, unknown> = {
        apiName: summary.apiName,
        apiVersion: summary.apiVersion,
        folderCount: summary.folderCount,
        requestCount: summary.requestCount,
        environmentCount: summary.environmentCount,
        variableCount: summary.variableCount,
        authProfileCount: summary.authProfileCount,
        outputDirectoryName: suggestedOutput || outputDirectoryName,
        warningCount: warnings.length,
        warnings: warnings.slice(0, 12),
      };
      base[formatField] = summary.openapiVersion;
      if (includeUnsupported) {
        base.scriptWarningCount = format.scriptWarningCode
          ? countByCode(
              summary,
              (code) => code === format.scriptWarningCode,
            )
          : 0;
        base.unsupportedFeatureCount = format.unsupportedCodePrefix
          ? countByCode(summary, (code) =>
              code.startsWith(format.unsupportedCodePrefix!),
            )
          : 0;
      }
      return base;
    };

    const buildSummaryView = (
      summary: ImportSummary,
      patch: SettingsPatch | undefined,
    ): Record<string, unknown> => {
      const warnings = summary.diagnostics
        .filter((item) => item.severity === 'warning')
        .map((item) => item.message);
      const errors = summary.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => item.message);
      const base: Record<string, unknown> = {
        success: summary.success,
        cancelled: summary.cancelled,
        apiName: summary.apiName,
        apiVersion: summary.apiVersion,
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
      base[formatField] = summary.openapiVersion;
      if (includeUnsupported) {
        base.scriptWarningCount = format.scriptWarningCode
          ? countByCode(
              summary,
              (code) => code === format.scriptWarningCode,
            )
          : 0;
        base.unsupportedFeatureCount = format.unsupportedCodePrefix
          ? countByCode(summary, (code) =>
              code.startsWith(format.unsupportedCodePrefix!),
            )
          : 0;
      }
      return base;
    };

    const hasSource = (): boolean =>
      sourceText.length > 0 && sourcePath.length > 0;

    const pipelineCommon = (): {
      sourceText: string;
      sourcePath: string;
      fileName?: string;
      targetRoot: string;
      outputDirectoryName?: string;
      limits: { maxFileBytes: number };
      existingEnvironments: readonly Environment[];
      existingAuthProfiles: readonly AuthenticationProfile[];
      activeEnvironmentId?: string;
      writer: WorkspaceFileWriter;
      provider?: SpecificationImportProvider;
    } => {
      const activeEnvironmentId = options.readActiveEnvironmentId();
      return {
        sourceText,
        sourcePath,
        ...(sourceFileName === undefined ? {} : { fileName: sourceFileName }),
        targetRoot: selectedFolderPath,
        ...(outputDirectoryName.length > 0
          ? { outputDirectoryName }
          : {}),
        limits: { maxFileBytes: maxFileBytes() },
        existingEnvironments: options.readEnvironments(),
        existingAuthProfiles: options.readAuthProfiles(),
        ...(activeEnvironmentId === undefined
          ? {}
          : { activeEnvironmentId }),
        writer: options.writer,
        ...(format.provider !== undefined
          ? { provider: format.provider }
          : {}),
      };
    };

    const runAnalyze = async (requestedOutput: string): Promise<void> => {
      if (!hasSource()) {
        await post({
          type: 'previewError',
          message: format.sourceMissingMessage,
        });
        return;
      }
      outputDirectoryName = requestedOutput.trim();
      try {
        const result = await runImportPipeline({
          ...pipelineCommon(),
          skipWrite: true,
        });

        if (!result.summary.success) {
          const firstError = result.summary.diagnostics.find(
            (item) => item.severity === 'error',
          );
          await post({
            type: 'previewError',
            message:
              firstError?.message ?? format.analyzeFailureMessage,
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
        options.logger.warning(`${format.logLabel} preview failed`, {
          message,
        });
        await post({ type: 'previewError', message });
      }
    };

    const runImport = async (requestedOutput: string): Promise<void> => {
      if (!hasSource()) {
        await post({
          type: 'error',
          message: format.sourceMissingMessage,
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

      let overwrite = false;
      if (outputDirectoryName.length > 0) {
        const targetPath = resolveUnderTarget(
          selectedFolderPath,
          outputDirectoryName,
        );
        if (targetPath !== undefined) {
          try {
            const entries = await readdir(targetPath);
            if (entries.length > 0) {
              const choice = await window.showWarningMessage(
                `Import target "${outputDirectoryName}" already exists and is not empty. Overwrite?`,
                { modal: true },
                'Overwrite',
              );
              if (choice !== 'Overwrite') {
                await post({
                  type: 'error',
                  message:
                    'Import cancelled — choose a different collection name or confirm overwrite.',
                });
                return;
              }
              overwrite = true;
            }
          } catch {
            // Target does not exist yet.
          }
        }
      }

      try {
        const result = await runImportPipeline({
          ...pipelineCommon(),
          cancellation,
          ...(overwrite ? { overwrite: true } : {}),
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
          options.logger.info(
            `${format.logLabel} cancelled from wizard`,
          );
          return;
        }

        if (result.summary.success && result.settingsPatch !== undefined) {
          try {
            await options.applySettingsPatch(result.settingsPatch);
          } catch (settingsError) {
            const settingsMessage =
              settingsError instanceof Error
                ? settingsError.message
                : String(settingsError);
            if (result.summary.writtenFiles.length > 0) {
              await rollbackWrittenFiles(
                options.writer,
                result.summary.writtenFiles,
                result.summary.targetDirectory,
              );
            }
            options.logger.warning(
              `${format.logLabel} settings patch failed; rolled back files`,
              { message: settingsMessage },
            );
            await post({
              type: 'error',
              message: `Import files were rolled back because settings could not be updated: ${settingsMessage}`,
            });
            return;
          }
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
        options.logger.info(`${format.logLabel} finished`, {
          success: result.summary.success,
          requests: result.summary.requestCount,
          target: result.summary.targetDirectory,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        options.logger.warning(`${format.logLabel} failed`, { message });
        await post({
          type: 'error',
          message:
            format.enableUrlSource === true
              ? `${format.logLabel} failed: ${message}`
              : message,
        });
      }
    };

    const pickFile = async (): Promise<void> => {
      const filters: { [name: string]: string[] } = {};
      for (const [name, exts] of Object.entries(format.fileFilters)) {
        filters[name] = [...exts];
      }
      const picked = await window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        canSelectFiles: true,
        openLabel: format.openLabel ?? 'Select',
        ...(format.fileDialogTitle !== undefined
          ? { title: format.fileDialogTitle }
          : {}),
        filters,
      });
      const uri = picked?.[0];
      if (uri === undefined) {
        return;
      }
      try {
        const sizeCheck = evaluateImportSourceSize(
          (await workspace.fs.stat(uri)).size,
          maxFileBytes(),
        );
        if (!sizeCheck.ok) {
          await post({
            type: format.filePickErrorType ?? 'previewError',
            message: sizeCheck.diagnostic.message,
          });
          options.logger.warning(
            `${format.logLabel} rejected before read`,
            { message: sizeCheck.diagnostic.message },
          );
          return;
        }
        const bytes = await workspace.fs.readFile(uri);
        sourceText = Buffer.from(bytes).toString('utf8');
        sourcePath = uri.fsPath;
        sourceFileName = uri.path.split('/').pop() ?? uri.fsPath;
        await post({
          type: 'fileSelected',
          path: sourcePath,
          name: sourceFileName,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        await post({
          type: format.filePickErrorType ?? 'previewError',
          message,
        });
      }
    };

    const runFetchUrl = async (rawUrl: string): Promise<void> => {
      if (format.enableUrlSource !== true || transport === undefined) {
        return;
      }
      if (fetchInFlight) {
        return;
      }
      fetchInFlight = true;
      const generation = ++fetchGeneration;
      fetchAbort?.abort();
      fetchAbort = new AbortController();
      const result = await fetchOpenApiSpecUrl(rawUrl, {
        transport,
        maxResponseBytes: maxFileBytes(),
        signal: fetchAbort.signal,
      });
      if (settled || generation !== fetchGeneration) {
        return;
      }
      fetchInFlight = false;
      fetchAbort = undefined;
      if (!result.ok) {
        options.logger.warning(`${format.logLabel} URL fetch failed`, {
          message: result.message,
          code: result.code,
        });
        await post({ type: 'error', message: result.message });
        return;
      }
      sourceText = result.text;
      sourcePath = result.sourceUrl;
      sourceFileName = result.fileName;
      const name = result.fileName ?? result.sourceUrl;
      await post({
        type: 'fileSelected',
        path: result.sourceUrl,
        name,
      });
    };

    const sendInit = async (): Promise<void> => {
      await post({
        type: 'init',
        state: {
          folders: wizardFolders,
          skipWorkspaceStep,
          selectedFolderPath,
          manageAuthAvailable,
          step: skipWorkspaceStep ? 'file' : 'workspace',
        },
      });
    };

    disposables.push(
      panel.webview.onDidReceiveMessage(async (raw) => {
        const message = format.parseMessage(raw);
        if (message === undefined) {
          return;
        }
        switch (message.type) {
          case 'ready':
            await sendInit();
            break;
          case 'cancel':
          case 'close':
            abortInFlightFetch();
            finish(importSucceeded);
            break;
          case 'selectWorkspace': {
            // Allowlist only — reject webview-supplied paths not in wizardFolders.
            const match = wizardFolders.find(
              (folder) => folder.path === message.path,
            );
            if (match === undefined) {
              await post({
                type: 'error',
                message: 'Select a valid workspace folder.',
              });
              break;
            }
            selectedFolderPath = match.path;
            break;
          }
          case 'pickFile':
            await pickFile();
            break;
          case 'fetchUrl':
            await runFetchUrl(message.url);
            break;
          case 'analyze':
            await runAnalyze(message.outputDirectoryName);
            break;
          case 'startImport':
            await runImport(message.outputDirectoryName);
            break;
          case 'cancelImport':
            cancelRequested = true;
            break;
          case 'manageAuthProfiles':
            if (manageAuthAvailable) {
              await commands.executeCommand(COMMAND_IDS.manageAuthProfiles);
            }
            break;
          case 'back':
            break;
          default:
            break;
        }
      }),
      panel.onDidDispose(() => {
        cancelRequested = true;
        for (const disposable of disposables) {
          disposable.dispose();
        }
        if (!settled) {
          settled = true;
          abortInFlightFetch();
          resolve(importSucceeded);
        } else {
          resolve(importSucceeded);
        }
      }),
    );

    panel.webview.html = format.renderHtml(createWebviewNonce());
  });
}
