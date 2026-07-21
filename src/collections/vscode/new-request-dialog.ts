/**
 * VS Code webview host for the New Request dialog.
 */

import { ViewColumn, window, type Disposable } from 'vscode';

import type { RequestSourceDocument } from '../../request-source';
import { createWebviewNonce } from '../../ui/webview';
import {
  parseNewRequestDialogMessage,
  renderNewRequestDialogHtml,
  validateCreateMessage,
  type NewRequestDialogDestination,
  type NewRequestDialogState,
} from './new-request-dialog-html';

const PANEL_VIEW_TYPE = 'apiRunner.newRequest';

export interface NewRequestDialogResult {
  readonly collectionId: string;
  readonly folderRelativePath: string;
  readonly model: RequestSourceDocument;
}

export interface OpenNewRequestDialogOptions {
  readonly destinations: readonly NewRequestDialogDestination[];
  readonly preselectedCollectionId?: string;
  readonly preselectedFolderRelativePath?: string;
  /**
   * Invoked when the user clicks Create. Throw to keep the dialog open and
   * show the error; resolve to close the dialog.
   */
  readonly onCreate: (result: NewRequestDialogResult) => Promise<void>;
}

/**
 * Opens the New Request dialog. Resolves `true` after a successful create,
 * `false` when the user cancels or closes the panel.
 */
export async function openNewRequestDialog(
  options: OpenNewRequestDialogOptions,
): Promise<boolean> {
  if (options.destinations.length === 0) {
    return false;
  }

  return new Promise((resolve) => {
    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      'New Request',
      { viewColumn: ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    let settled = false;
    const disposables: Disposable[] = [];

    const finish = (created: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const disposable of disposables) {
        disposable.dispose();
      }
      panel.dispose();
      resolve(created);
    };

    const nonce = createWebviewNonce();
    panel.webview.html = renderNewRequestDialogHtml(nonce);

    const state: NewRequestDialogState = {
      destinations: options.destinations,
      ...(options.preselectedCollectionId !== undefined
        ? { preselectedCollectionId: options.preselectedCollectionId }
        : {}),
      ...(options.preselectedFolderRelativePath !== undefined
        ? {
            preselectedFolderRelativePath:
              options.preselectedFolderRelativePath,
          }
        : {}),
      defaultName: 'New Request',
      defaultMethod: 'GET',
      defaultUrl: 'https://httpbin.org/get',
    };

    disposables.push(
      panel.webview.onDidReceiveMessage((raw) => {
        void (async () => {
          const message = parseNewRequestDialogMessage(raw);
          if (message === undefined) {
            return;
          }
          if (message.type === 'ready') {
            await panel.webview.postMessage({ type: 'init', state });
            return;
          }
          if (message.type === 'cancel') {
            finish(false);
            return;
          }

          const validation = validateCreateMessage(
            message,
            options.destinations,
          );
          if (validation.error !== undefined || validation.model === undefined) {
            await panel.webview.postMessage({
              type: 'error',
              message: validation.error ?? 'Invalid request.',
            });
            return;
          }

          try {
            await options.onCreate({
              collectionId: message.collectionId,
              folderRelativePath: message.folderRelativePath,
              model: validation.model,
            });
            finish(true);
          } catch (error) {
            const text =
              error instanceof Error ? error.message : String(error);
            await panel.webview.postMessage({
              type: 'error',
              message: text,
            });
          }
        })();
      }),
      panel.onDidDispose(() => {
        finish(false);
      }),
    );
  });
}

export { validateCreateMessage };

/** Builds destination rows for every native collection root + folder. */
export function buildNewRequestDestinations(
  collections: readonly {
    readonly id: string;
    readonly kind: string;
    readonly display: { readonly label: string };
    readonly folders: Readonly<
      Record<
        string,
        {
          readonly relativePath: string;
          readonly display: { readonly label: string };
        }
      >
    >;
  }[],
): NewRequestDialogDestination[] {
  const destinations: NewRequestDialogDestination[] = [];
  for (const collection of collections) {
    if (collection.kind !== 'native') {
      continue;
    }
    destinations.push({
      collectionId: collection.id,
      collectionLabel: collection.display.label,
      folderRelativePath: '',
      folderLabel: '(collection root)',
    });
    const folders = Object.values(collection.folders).sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
    for (const folder of folders) {
      destinations.push({
        collectionId: collection.id,
        collectionLabel: collection.display.label,
        folderRelativePath: folder.relativePath,
        folderLabel: folder.relativePath,
      });
    }
  }
  return destinations;
}
