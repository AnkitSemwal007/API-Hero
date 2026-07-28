/**
 * Command-opened WebviewPanel host for Collection Run Report.
 * Supports finished summaries and live session updates (no manager dependency).
 */
import {
  commands,
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';
import { createWebviewNonce } from '../../ui/webview';
import { COMMAND_IDS } from '../../constants';
import type { RunIdentifier, RunSummary } from '../index';
import type { CollectionRunSessionSnapshot } from '../run-session-models';
import {
  buildCollectionRunReportModel,
  buildLiveCollectionRunReportModel,
  parseCollectionRunReportMessage,
  renderCollectionRunReportHtml,
} from './run-report-html';

const PANEL_VIEW_TYPE = 'apiHero.collectionRunReport';

export interface CollectionRunReportPanelActions {
  readonly openRequest: (requestId: string) => Promise<void>;
  readonly revealRequest: (requestId: string) => Promise<void>;
}

export class CollectionRunReportPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private summary: RunSummary | undefined;
  private liveRunId: RunIdentifier | undefined;
  private lastLiveSnapshot: CollectionRunSessionSnapshot | undefined;

  public constructor(
    private readonly actions: CollectionRunReportPanelActions = {
      openRequest: defaultOpenRequest,
      revealRequest: defaultRevealRequest,
    },
  ) {}

  public show(summary: RunSummary): void {
    this.summary = summary;
    this.liveRunId = undefined;
    this.lastLiveSnapshot = undefined;
    this.ensurePanel(`Run Report: ${summary.plan.collectionName}`);
    void this.postInit();
  }

  public showLive(snapshot: CollectionRunSessionSnapshot): void {
    if (snapshot.summary !== undefined) {
      this.show(snapshot.summary);
      return;
    }
    this.summary = undefined;
    this.liveRunId = snapshot.runId;
    this.lastLiveSnapshot = snapshot;
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
      this.show(session.summary);
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
      this.show(this.summary);
      return;
    }
    if (this.lastLiveSnapshot !== undefined) {
      this.showLive(this.lastLiveSnapshot);
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
    panel.webview.html = renderCollectionRunReportHtml(createWebviewNonce());
    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => { void this.onMessage(raw); }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) disposable.dispose();
        this.panel = undefined;
      }),
    ];
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseCollectionRunReportMessage(raw);
    if (message === undefined || this.panel === undefined) return;
    if (message.type === 'ready') {
      if (this.summary !== undefined) { await this.postInit(); return; }
      if (this.lastLiveSnapshot !== undefined) await this.postInitFromLive(this.lastLiveSnapshot);
      return;
    }
    try {
      if (message.type === 'open') { await this.actions.openRequest(message.requestId); return; }
      if (message.type === 'reveal') await this.actions.revealRequest(message.requestId);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({ type: 'error', message: text || 'Unable to open that request.' });
    }
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.summary === undefined) return;
    await this.panel.webview.postMessage({ type: 'init', model: buildCollectionRunReportModel(this.summary) });
  }

  private async postInitFromLive(snapshot: CollectionRunSessionSnapshot): Promise<void> {
    if (this.panel === undefined) return;
    if (snapshot.summary !== undefined) {
      this.summary = snapshot.summary;
      await this.postInit();
      return;
    }
    await this.panel.webview.postMessage({ type: 'init', model: buildLiveCollectionRunReportModel(snapshot) });
  }

  private async postUpdate(snapshot: CollectionRunSessionSnapshot): Promise<void> {
    if (this.panel === undefined) return;
    if (snapshot.summary !== undefined) {
      this.summary = snapshot.summary;
      await this.postInit();
      return;
    }
    await this.panel.webview.postMessage({ type: 'live', model: buildLiveCollectionRunReportModel(snapshot) });
  }
}

async function defaultOpenRequest(requestId: string): Promise<void> {
  await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
}
async function defaultRevealRequest(requestId: string): Promise<void> {
  await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
  await commands.executeCommand(COMMAND_IDS.focusCollections);
}
