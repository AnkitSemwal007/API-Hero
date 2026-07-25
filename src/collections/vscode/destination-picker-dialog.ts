/**
 * VS Code webview host for picking a native collection folder destination.
 */

import { ViewColumn, window, type Disposable } from 'vscode';

import { createWebviewNonce } from '../../ui/webview';
import {
  parseDestinationPickerMessage,
  renderDestinationPickerDialogHtml,
  validateDestinationPickerSelection,
  type DestinationPickerDestination,
  type DestinationPickerDialogConfig,
} from './destination-picker-dialog-html';

const PANEL_VIEW_TYPE = 'apiRunner.destinationPicker';

export type { DestinationPickerDestination, DestinationPickerDialogConfig };

export interface DestinationPickerResult {
  readonly collectionId: string;
  readonly folderRelativePath: string;
}

export interface OpenDestinationPickerDialogOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly destinations: readonly DestinationPickerDestination[];
  readonly preselectedCollectionId?: string;
  readonly preselectedFolderRelativePath?: string;
  readonly submitLabel?: string;
  /**
   * Invoked when the user confirms. Throw to keep the dialog open and show the
   * error; resolve to close the dialog.
   */
  readonly onSubmit?: (result: DestinationPickerResult) => Promise<void>;
}

/**
 * Opens a destination picker. Resolves the selection after confirm, or
 * `undefined` when the user cancels or closes the panel.
 */
export async function openDestinationPickerDialog(
  options: OpenDestinationPickerDialogOptions,
): Promise<DestinationPickerResult | undefined> {
  if (options.destinations.length === 0) {
    return undefined;
  }

  const config: DestinationPickerDialogConfig = {
    title: options.title,
    destinations: options.destinations,
    submitLabel: options.submitLabel ?? 'Move Here',
    ...(options.subtitle !== undefined ? { subtitle: options.subtitle } : {}),
    ...(options.preselectedCollectionId !== undefined
      ? { preselectedCollectionId: options.preselectedCollectionId }
      : {}),
    ...(options.preselectedFolderRelativePath !== undefined
      ? {
          preselectedFolderRelativePath:
            options.preselectedFolderRelativePath,
        }
      : {}),
  };

  return new Promise((resolve) => {
    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      config.title,
      { viewColumn: ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    let settled = false;
    const disposables: Disposable[] = [];

    const finish = (result: DestinationPickerResult | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const disposable of disposables) {
        disposable.dispose();
      }
      panel.dispose();
      resolve(result);
    };

    const nonce = createWebviewNonce();
    panel.webview.html = renderDestinationPickerDialogHtml(nonce, config);

    disposables.push(
      panel.webview.onDidReceiveMessage((raw) => {
        void (async () => {
          const message = parseDestinationPickerMessage(raw);
          if (message === undefined) {
            return;
          }
          if (message.type === 'ready') {
            await panel.webview.postMessage({ type: 'init', config });
            return;
          }
          if (message.type === 'cancel') {
            finish(undefined);
            return;
          }

          const validation = validateDestinationPickerSelection(
            message,
            options.destinations,
          );
          if (
            validation.error !== undefined ||
            validation.collectionId === undefined ||
            validation.folderRelativePath === undefined
          ) {
            await panel.webview.postMessage({
              type: 'error',
              message: validation.error ?? 'Select a valid destination.',
            });
            return;
          }

          const result: DestinationPickerResult = {
            collectionId: validation.collectionId,
            folderRelativePath: validation.folderRelativePath,
          };

          try {
            if (options.onSubmit !== undefined) {
              await options.onSubmit(result);
            }
            finish(result);
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
        finish(undefined);
      }),
    );
  });
}
