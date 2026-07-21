/**
 * Command-opened WebviewPanel host for Collection Run Report.
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
import type { RunSummary } from '../index';
import {
  buildCollectionRunReportModel,
  parseCollectionRunReportMessage,
  renderCollectionRunReportHtml,
} from './run-report-html';

const PANEL_VIEW_TYPE = 'apiRunner.collectionRunReport';

export interface CollectionRunReportPanelActions {
  /** Opens the request editor / document for a report row. */
  readonly openRequest: (requestId: string) => Promise<void>;
  /** Reveals the request in the Collections tree (may also open). */
  readonly revealRequest: (requestId: string) => Promise<void>;
}

/** Owns a singleton Collection Run Report panel. */
export class CollectionRunReportPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private summary: RunSummary | undefined;

  public constructor(
    private readonly actions: CollectionRunReportPanelActions = {
      openRequest: defaultOpenRequest,
      revealRequest: defaultRevealRequest,
    },
  ) {}

  /** Opens or reveals the report panel for a finished run. */
  public show(summary: RunSummary): void {
    this.summary = summary;
    const title = `Run Report: ${summary.plan.collectionName}`;

    if (this.panel !== undefined) {
      this.panel.title = title;
      this.panel.reveal(ViewColumn.Beside, false);
      void this.postInit();
      return;
    }

    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      title,
      { viewColumn: ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    this.panel = panel;

    const nonce = createWebviewNonce();
    panel.webview.html = renderCollectionRunReportHtml(nonce);

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
      }),
    ];
  }

  /** Re-shows the last report when available. */
  public showLast(): void {
    if (this.summary === undefined) {
      void window.showInformationMessage(
        'No collection run report is available yet.',
      );
      return;
    }
    this.show(this.summary);
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.summary = undefined;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseCollectionRunReportMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }

    try {
      if (message.type === 'open') {
        await this.actions.openRequest(message.requestId);
        return;
      }
      if (message.type === 'reveal') {
        await this.actions.revealRequest(message.requestId);
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to open that request.',
      });
    }
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.summary === undefined) {
      return;
    }
    const model = buildCollectionRunReportModel(this.summary);
    await this.panel.webview.postMessage({ type: 'init', model });
  }
}

async function defaultOpenRequest(requestId: string): Promise<void> {
  await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
}

async function defaultRevealRequest(requestId: string): Promise<void> {
  // openCollectionRequest opens the document and reveals the tree node.
  await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
  await commands.executeCommand(COMMAND_IDS.focusCollections);
}
