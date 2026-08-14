/**
 * Command-opened WebviewPanel host for Collection Run Report.
 * Supports finished summaries and live session updates (no manager dependency).
 */
import {
  commands,
  Uri,
  ViewColumn,
  window,
  workspace,
  type Disposable,
  type WebviewPanel,
} from 'vscode';
import { createWebviewNonce } from '../../ui/webview';
import { COMMAND_IDS } from '../../constants';
import { describeFilesystemFailure } from '../../shared';
import type { ResponsePresentation } from '../../response/presentation';
import type { RunIdentifier, RunSummary } from '../index';
import type { CollectionRunSessionSnapshot } from '../run-session-models';
import {
  renderStandaloneCollectionRunReportHtml,
  serializeCollectionRunReportJson,
  suggestedRunReportFileName,
  confirmOverwriteIfExists,
  type RunReportExportFormat,
} from './run-report-export';
import {
  buildCollectionRunReportModel,
  buildLiveCollectionRunReportModel,
  parseCollectionRunReportMessage,
  renderCollectionRunReportHtml,
  type CollectionRunReportModel,
} from './run-report-html';

const PANEL_VIEW_TYPE = 'apiHero.collectionRunReport';

export interface CollectionRunReportPanelActions {
  readonly openRequest: (requestId: string) => Promise<void>;
  readonly revealRequest: (requestId: string) => Promise<void>;
  /**
   * Compare the current request presentation with a prior collection-run
   * presentation (Run A vs Run B). Optional — omit when unavailable.
   */
  readonly compareRuns?: (
    requestId: string,
    current: ResponsePresentation,
  ) => Promise<void>;
  /**
   * Reopen Collection Run Setup with the previous submitted config.
   * Optional — omit when the host has no Setup panel; `runAgain` then opens
   * Setup for the reported collection without restoring a prior draft.
   */
  readonly onRunAgain?: (collectionId: string) => Promise<void>;
}

export interface CollectionRunReportShowOptions {
  readonly environmentName?: string;
}

export class CollectionRunReportPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private summary: RunSummary | undefined;
  private liveRunId: RunIdentifier | undefined;
  private lastLiveSnapshot: CollectionRunSessionSnapshot | undefined;
  private environmentName: string | undefined;
  private actions: CollectionRunReportPanelActions;

  public constructor(
    actions: CollectionRunReportPanelActions = {
      openRequest: defaultOpenRequest,
      revealRequest: defaultRevealRequest,
    },
  ) {
    this.actions = actions;
  }

  public setOnRunAgain(onRunAgain: (collectionId: string) => Promise<void>): void {
    this.actions = { ...this.actions, onRunAgain };
  }

  public show(
    summary: RunSummary,
    options?: CollectionRunReportShowOptions,
  ): void {
    this.summary = summary;
    this.liveRunId = undefined;
    this.lastLiveSnapshot = undefined;
    this.environmentName = options?.environmentName?.trim() || undefined;
    this.ensurePanel(`Run Report: ${summary.plan.collectionName}`);
    void this.postInit();
  }

  public showLive(
    snapshot: CollectionRunSessionSnapshot,
    options?: CollectionRunReportShowOptions,
  ): void {
    if (snapshot.summary !== undefined) {
      this.show(snapshot.summary, options);
      return;
    }
    this.summary = undefined;
    this.liveRunId = snapshot.runId;
    this.lastLiveSnapshot = snapshot;
    if (options?.environmentName !== undefined) {
      this.environmentName = options.environmentName.trim() || undefined;
    }
    const title =
      snapshot.status === 'running'
        ? `Live Report: ${snapshot.collectionName}`
        : `Run Report: ${snapshot.collectionName}`;
    this.ensurePanel(title);
    void this.postInitFromLive(snapshot);
  }

  public updateLive(session: CollectionRunSessionSnapshot): void {
    if (!this.isShowing(session.runId) || this.panel === undefined) {
      return;
    }
    if (session.summary !== undefined) {
      this.show(session.summary, {
        ...(this.environmentName === undefined
          ? {}
          : { environmentName: this.environmentName }),
      });
      return;
    }
    this.lastLiveSnapshot = session;
    this.panel.title =
      session.status === 'running'
        ? `Live Report: ${session.collectionName}`
        : `Run Report: ${session.collectionName}`;
    void this.postUpdate(session);
  }

  public isShowing(runId: RunIdentifier): boolean {
    if (this.panel === undefined) {
      return false;
    }
    if (this.liveRunId === runId) {
      return true;
    }
    return this.summary?.runId === runId;
  }

  public showLast(): void {
    if (this.summary !== undefined) {
      this.show(this.summary, {
        ...(this.environmentName === undefined
          ? {}
          : { environmentName: this.environmentName }),
      });
      return;
    }
    if (this.lastLiveSnapshot !== undefined) {
      this.showLive(this.lastLiveSnapshot, {
        ...(this.environmentName === undefined
          ? {}
          : { environmentName: this.environmentName }),
      });
      return;
    }
    void window.showInformationMessage('No collection run report is available yet.');
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.summary = undefined;
    this.liveRunId = undefined;
    this.lastLiveSnapshot = undefined;
    this.environmentName = undefined;
  }

  private reportOptions(): { readonly environmentName?: string } | undefined {
    return this.environmentName === undefined
      ? undefined
      : { environmentName: this.environmentName };
  }

  private ensurePanel(title: string): void {
    if (this.panel !== undefined) {
      this.panel.title = title;
      this.panel.reveal(ViewColumn.Beside, false);
      return;
    }
    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      title,
      { viewColumn: ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.panel = panel;
    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => { void this.onMessage(raw); }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) disposable.dispose();
        this.panel = undefined;
      }),
    ];
    panel.webview.html = renderCollectionRunReportHtml(createWebviewNonce());
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseCollectionRunReportMessage(raw);
    if (message === undefined || this.panel === undefined) return;
    if (message.type === 'ready') {
      if (this.summary !== undefined) { await this.postInit(); return; }
      if (this.lastLiveSnapshot !== undefined) await this.postInitFromLive(this.lastLiveSnapshot);
      return;
    }
    if (message.type === 'export') {
      try {
        await this.exportReport();
      } catch (cause) {
        await this.notifyExportFailure(cause);
      }
      return;
    }
    try {
      if (message.type === 'open') { await this.actions.openRequest(message.requestId); return; }
      if (message.type === 'reveal') { await this.actions.revealRequest(message.requestId); return; }
      if (message.type === 'compareRuns') {
        await this.compareRuns(message.requestId);
        return;
      }
      if (message.type === 'runAgain') await this.runAgain();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      const fallback =
        message.type === 'runAgain'
          ? 'Unable to run that collection again.'
          : message.type === 'compareRuns'
            ? 'Unable to compare runs for that request.'
            : 'Unable to open that request.';
      if (this.panel === undefined) {
        return;
      }
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || fallback,
      });
    }
  }

  private async compareRuns(requestId: string): Promise<void> {
    const current = this.findPresentation(requestId);
    if (current === undefined) {
      await window.showInformationMessage(
        'No response presentation is available for that request in this run.',
      );
      return;
    }
    if (this.actions.compareRuns === undefined) {
      await window.showInformationMessage(
        'Compare Runs is not available in this host.',
      );
      return;
    }
    await this.actions.compareRuns(requestId, current);
  }

  private findPresentation(
    requestId: string,
  ): ResponsePresentation | undefined {
    const fromSummary = this.summary?.results.find(
      (result) => result.requestId === requestId,
    )?.presentation;
    if (fromSummary !== undefined) {
      return fromSummary;
    }
    return this.lastLiveSnapshot?.results.find(
      (result) => result.requestId === requestId,
    )?.presentation;
  }

  private currentModel(): CollectionRunReportModel | undefined {
    if (this.summary !== undefined) {
      return buildCollectionRunReportModel(this.summary, this.reportOptions());
    }
    if (this.lastLiveSnapshot !== undefined) {
      return buildLiveCollectionRunReportModel(
        this.lastLiveSnapshot,
        this.reportOptions(),
      );
    }
    return undefined;
  }

  private async exportReport(): Promise<void> {
    const model = this.currentModel();
    if (model === undefined) {
      await window.showInformationMessage(
        'No collection run report is available to export.',
      );
      return;
    }

    const choice = await window.showQuickPick(
      [
        {
          label: 'JSON',
          description: 'Save a .json file',
          format: 'json' as const,
        },
        {
          label: 'HTML',
          description: 'Save a standalone .html file',
          format: 'html' as const,
        },
      ],
      { title: 'Export Run Report', placeHolder: 'Choose an export format' },
    );
    if (choice === undefined) {
      return;
    }

    await this.saveExportedReport(model, choice.format);
  }

  private async saveExportedReport(
    model: CollectionRunReportModel,
    format: RunReportExportFormat,
  ): Promise<void> {
    const fileName = suggestedRunReportFileName(model.collectionName, format);
    const workspaceFolder = workspace.workspaceFolders?.[0]?.uri;
    const defaultUri =
      workspaceFolder === undefined
        ? Uri.file(fileName)
        : Uri.joinPath(workspaceFolder, fileName);
    const uri = await window.showSaveDialog({
      defaultUri,
      saveLabel: format === 'json' ? 'Export JSON' : 'Export HTML',
      filters:
        format === 'json' ? { JSON: ['json'] } : { HTML: ['html'] },
    });
    if (uri === undefined) {
      return;
    }

    let exists = false;
    try {
      await workspace.fs.stat(uri);
      exists = true;
    } catch {
      // Keep exists=false when the target is not already on disk.
    }

    const allowed = await confirmOverwriteIfExists(exists, async () => {
      const overwrite = await window.showWarningMessage(
        `"${uri.fsPath}" already exists. Overwrite?`,
        { modal: true },
        'Overwrite',
      );
      return overwrite === 'Overwrite';
    });
    if (!allowed) {
      return;
    }

    let content: string;
    try {
      content =
        format === 'json'
          ? serializeCollectionRunReportJson(model)
          : renderStandaloneCollectionRunReportHtml(model);
    } catch (cause) {
      await this.notifyExportFailure(cause);
      return;
    }

    try {
      await workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    } catch (cause) {
      await this.notifyExportFailure(cause);
      return;
    }

    window.setStatusBarMessage(`Run report saved to ${uri.fsPath}`, 3_000);
  }

  private async notifyExportFailure(cause: unknown): Promise<void> {
    const described = describeFilesystemFailure(cause);
    const text =
      described ??
      (cause instanceof Error ? cause.message : String(cause));
    await window.showErrorMessage(text || 'Unable to export the run report.');
  }

  /**
   * Re-opens Collection Run Setup for the reported collection.
   * Uses plan/session `collectionId` from the host — not a webview-supplied id.
   * When `onRunAgain` is set, restores the previous submitted setup.
   */
  private async runAgain(): Promise<void> {
    const collectionId =
      this.summary?.plan.collectionId ?? this.lastLiveSnapshot?.collectionId;
    const collectionName =
      this.summary?.plan.collectionName ?? this.lastLiveSnapshot?.collectionName ?? '';
    if (collectionId === undefined || collectionId.trim().length === 0) {
      if (this.panel !== undefined) {
        await this.panel.webview.postMessage({
          type: 'error',
          message: 'Unable to run that collection again.',
        });
      }
      return;
    }
    if (this.actions.onRunAgain !== undefined) {
      await this.actions.onRunAgain(collectionId);
      return;
    }
    await commands.executeCommand(COMMAND_IDS.runCollection, {
      id: collectionId,
      kind: 'collection',
      label: collectionName,
      collapsible: true,
    });
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.summary === undefined) return;
    await this.panel.webview.postMessage({
      type: 'init',
      model: buildCollectionRunReportModel(this.summary, this.reportOptions()),
    });
  }

  private async postInitFromLive(snapshot: CollectionRunSessionSnapshot): Promise<void> {
    if (this.panel === undefined) return;
    if (snapshot.summary !== undefined) {
      this.summary = snapshot.summary;
      await this.postInit();
      return;
    }
    await this.panel.webview.postMessage({
      type: 'init',
      model: buildLiveCollectionRunReportModel(snapshot, this.reportOptions()),
    });
  }

  private async postUpdate(snapshot: CollectionRunSessionSnapshot): Promise<void> {
    if (this.panel === undefined) return;
    if (snapshot.summary !== undefined) {
      this.summary = snapshot.summary;
      await this.postInit();
      return;
    }
    await this.panel.webview.postMessage({
      type: 'live',
      model: buildLiveCollectionRunReportModel(snapshot, this.reportOptions()),
    });
  }
}

async function defaultOpenRequest(requestId: string): Promise<void> {
  await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
}
async function defaultRevealRequest(requestId: string): Promise<void> {
  await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
  await commands.executeCommand(COMMAND_IDS.focusCollections);
}
