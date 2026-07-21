/**
 * Command-opened WebviewPanel host for the API Hero Overview.
 */

import {
  commands,
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';

import type { CollectionDiscoveryService } from '../../collections/discovery';
import { COMMAND_IDS } from '../../constants';
import type { HistoryRepository } from '../../history/repository';
import { createWebviewNonce } from '../../ui/webview';
import {
  buildOverviewModel,
  OverviewQuickAction,
  parseOverviewMessage,
  renderOverviewHtml,
  type OverviewQuickAction as OverviewQuickActionId,
} from './overview-html';

const PANEL_VIEW_TYPE = 'apiRunner.overview';
const PANEL_TITLE = 'API Hero Overview';

const QUICK_ACTION_COMMANDS: Readonly<
  Record<OverviewQuickActionId, string>
> = {
  [OverviewQuickAction.CreateRequest]: COMMAND_IDS.createRequest,
  [OverviewQuickAction.CreateCollection]: COMMAND_IDS.createCollection,
  [OverviewQuickAction.ImportOpenApi]: COMMAND_IDS.importOpenApi,
  [OverviewQuickAction.ManageEnvironments]: COMMAND_IDS.manageEnvironments,
  [OverviewQuickAction.ManageAuthProfiles]: COMMAND_IDS.manageAuthProfiles,
  [OverviewQuickAction.FocusCollections]: COMMAND_IDS.focusCollections,
};

export interface OverviewPanelOptions {
  readonly historyRepository: HistoryRepository;
  readonly discovery: CollectionDiscoveryService;
}

/** Owns a singleton Overview panel opened via command (not Activity Bar). */
export class OverviewPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private readonly disposables: Disposable[] = [];

  public constructor(private readonly options: OverviewPanelOptions) {
    this.disposables.push(
      options.discovery.onDidChange(() => {
        void this.postInit();
      }),
    );
  }

  /** Opens or reveals the Overview panel. */
  public show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Active, false);
      void this.postInit();
      return;
    }

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
    this.panel = panel;

    const nonce = createWebviewNonce();
    panel.webview.html = renderOverviewHtml(nonce);

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

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseOverviewMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }

    try {
      if (message.type === 'ready' || message.type === 'refresh') {
        await this.postInit();
        return;
      }
      if (message.type === 'focusCollections') {
        await commands.executeCommand(COMMAND_IDS.focusCollections);
        return;
      }
      if (message.type === 'openHistory') {
        await commands.executeCommand(
          COMMAND_IDS.openHistoryEntry,
          message.id,
        );
        return;
      }
      if (message.type === 'runAction') {
        await commands.executeCommand(QUICK_ACTION_COMMANDS[message.action]);
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to complete overview action.',
      });
    }
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined) {
      return;
    }
    try {
      const entries = await this.options.historyRepository.list({ limit: 8 });
      const model = buildOverviewModel(
        entries,
        this.options.discovery.snapshot,
      );
      await this.panel.webview.postMessage({ type: 'init', model });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to load overview.',
      });
    }
  }
}
