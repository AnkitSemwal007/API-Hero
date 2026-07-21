/**
 * Command-opened WebviewPanel host for History Detail (metadata only).
 */

import { randomBytes } from 'node:crypto';

import {
  env,
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';

import type { HistoryEntry } from '../models';
import {
  buildHistoryDetailModel,
  parseHistoryDetailMessage,
  renderHistoryDetailHtml,
} from './history-detail-html';

const PANEL_VIEW_TYPE = 'apiRunner.historyDetail';

export interface HistoryDetailPanelActions {
  readonly rerun: (entry: HistoryEntry) => Promise<void>;
  readonly reveal: (entry: HistoryEntry) => Promise<void>;
  readonly deleteEntry: (entry: HistoryEntry) => Promise<boolean>;
}

/** Owns a singleton History Detail panel. */
export class HistoryDetailPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private entry: HistoryEntry | undefined;

  public constructor(private readonly actions: HistoryDetailPanelActions) {}

  /** Opens or reveals the History Detail panel for one entry. */
  public show(entry: HistoryEntry): void {
    this.entry = entry;
    const title = panelTitle(entry);

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

    const nonce = randomBytes(18).toString('base64url');
    panel.webview.html = renderHistoryDetailHtml(nonce);

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
        this.entry = undefined;
      }),
    ];
  }

  /** Clears the panel when the open entry was deleted externally. */
  public notifyEntryDeleted(entryId: string): void {
    if (this.entry?.id !== entryId) {
      return;
    }
    this.close();
  }

  /** Closes the open panel without disposing the host. */
  public close(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.entry = undefined;
  }

  public dispose(): void {
    this.close();
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseHistoryDetailMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }

    const entry = this.entry;
    if (entry === undefined) {
      return;
    }

    try {
      if (message.type === 'rerun') {
        await this.actions.rerun(entry);
        return;
      }
      if (message.type === 'reveal') {
        await this.actions.reveal(entry);
        return;
      }
      if (message.type === 'copySummary') {
        const model = buildHistoryDetailModel(entry);
        await env.clipboard.writeText(model.summaryText);
        window.setStatusBarMessage('History summary copied to clipboard', 2_000);
        return;
      }
      if (message.type === 'delete') {
        const confirm = await window.showWarningMessage(
          'Delete this history entry?',
          { modal: true },
          'Delete',
        );
        if (confirm !== 'Delete') {
          return;
        }
        const deleted = await this.actions.deleteEntry(entry);
        if (deleted) {
          this.panel.dispose();
        }
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to complete history action.',
      });
    }
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.entry === undefined) {
      return;
    }
    const model = buildHistoryDetailModel(this.entry);
    await this.panel.webview.postMessage({ type: 'init', model });
  }
}

function panelTitle(entry: HistoryEntry): string {
  const name = entry.metadata.requestName?.trim();
  if (name !== undefined && name.length > 0) {
    return `History: ${name}`;
  }
  return `History: ${entry.summary.method} ${shortUrl(entry.summary.url)}`;
}

function shortUrl(url: string): string {
  return url.length > 48 ? `${url.slice(0, 45)}…` : url;
}
