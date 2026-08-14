/**
 * Command-opened WebviewPanel host for Collection Authentication.
 */

import {
  commands,
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';

import type { Collection, CollectionDiscoveryService } from '../../collections';
import { COMMAND_IDS } from '../../constants';
import { createWebviewNonce } from '../../ui/webview';
import type { AuthenticationProfileManager } from '../authentication-profile-manager';
import { summarizeAuthenticationProfileForUi } from '../ui';
import {
  buildCollectionAuthState,
  parseCollectionAuthMessage,
  renderCollectionAuthHtml,
  resolveCollectionAuthSaveProfileId,
} from './collection-auth-html';
import { writeCollectionDefaultAuthenticationId } from './set-collection-default-auth';

const PANEL_VIEW_TYPE = 'apiHero.collectionAuth';
const PANEL_TITLE = 'Collection Authentication';

export interface CollectionAuthPanelOptions {
  readonly profileManager: AuthenticationProfileManager;
  readonly discovery: CollectionDiscoveryService;
}

/** Owns a singleton Collection Authentication panel. */
export class CollectionAuthPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private collection: Collection | undefined;
  private readonly disposables: Disposable[] = [];

  public constructor(private readonly options: CollectionAuthPanelOptions) {
    this.disposables.push(
      options.profileManager.onDidChange(() => {
        void this.postInit();
      }),
      options.discovery.onDidChange(() => {
        void this.postInit();
      }),
    );
  }

  /** Opens or reveals the Collection Authentication panel for a collection. */
  public show(collection: Collection): void {
    this.collection = collection;
    if (this.panel !== undefined) {
      this.panel.title = panelTitle(collection);
      this.panel.reveal(ViewColumn.Beside, false);
      void this.postInit();
      return;
    }

    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      panelTitle(collection),
      { viewColumn: ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    this.panel = panel;
    panel.webview.html = renderCollectionAuthHtml(createWebviewNonce());

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
        this.collection = undefined;
      }),
    ];

    void this.postInit();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
    this.collection = undefined;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseCollectionAuthMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }
    if (message.type === 'cancel') {
      this.panel.dispose();
      return;
    }
    if (message.type === 'manageAuthentication') {
      await commands.executeCommand(COMMAND_IDS.manageAuthProfiles);
      return;
    }
    if (this.collection === undefined) {
      return;
    }
    const knownIds = this.options.profileManager.list().map((profile) => profile.id);
    const resolved = resolveCollectionAuthSaveProfileId(message.profileId, knownIds);
    if (!resolved.ok) {
      await this.panel.webview.postMessage({
        type: 'error',
        message: resolved.message,
      });
      return;
    }
    try {
      await writeCollectionDefaultAuthenticationId({
        collection: this.collection,
        profileId: resolved.profileId,
        discovery: this.options.discovery,
      });
      this.panel.dispose();
    } catch (error) {
      const text =
        error instanceof Error ? error.message : 'Unable to save Collection Authentication.';
      await this.panel.webview.postMessage({ type: 'error', message: text });
    }
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.collection === undefined) {
      return;
    }
    const latest =
      this.options.discovery.snapshot?.collections[this.collection.id];
    if (latest !== undefined) {
      this.collection = latest;
    }
    const collection = this.collection;
    const profiles = this.options.profileManager
      .list()
      .map(summarizeAuthenticationProfileForUi);
    const defaultAuthenticationId = collection.metadata.defaultAuthenticationId;
    const state = buildCollectionAuthState({
      collectionName: collection.display.label,
      collectionId: collection.id,
      ...(defaultAuthenticationId === undefined
        ? {}
        : { defaultAuthenticationId }),
      profiles,
    });
    await this.panel.webview.postMessage({ type: 'init', state });
  }
}

function panelTitle(collection: Collection): string {
  const label = collection.display.label.trim();
  return label.length > 0
    ? `${PANEL_TITLE}: ${label}`
    : PANEL_TITLE;
}
