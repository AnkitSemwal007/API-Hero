/**
 * VS Code webview host for Create/Edit CRUD name prompts.
 * Name-only mode stays backward compatible; optional Description when configured.
 */

import { ViewColumn, window, type Disposable } from 'vscode';

import { createWebviewNonce } from '../../ui/webview';
import {
  normalizeCrudPromptDescription,
  parseCrudPromptMessage,
  renderCrudPromptDialogHtml,
  validateCrudPromptValue,
  type CrudPromptDialogConfig,
} from './crud-prompt-dialog-html';

const PANEL_VIEW_TYPE = 'apiRunner.crudPrompt';

export type { CrudPromptDialogConfig };

/** Result when the dialog includes an optional Description field. */
export interface CrudPromptResult {
  readonly name: string;
  readonly description?: string;
}

export interface OpenCrudPromptDialogOptions extends CrudPromptDialogConfig {
  /**
   * Invoked when the user submits a valid name. Throw to keep the dialog open
   * and show the error; resolve to close the dialog.
   */
  readonly onSubmit?: (
    value: string,
    extras?: { readonly description?: string },
  ) => Promise<void>;
  /**
   * Extra name validation after the required non-empty check.
   * Return an error message to keep the dialog open.
   */
  readonly validateName?: (name: string) => string | undefined;
}

type OpenCrudPromptDialogWithDescription = OpenCrudPromptDialogOptions & {
  readonly descriptionFieldLabel: string;
};

/**
 * Opens a Create Collection-style prompt with Name + Description.
 * Resolves `{ name, description? }` after successful submit, or `undefined`
 * when the user cancels or closes the panel.
 */
export async function openCrudPromptDialog(
  options: OpenCrudPromptDialogWithDescription,
): Promise<CrudPromptResult | undefined>;
/**
 * Opens a name prompt dialog. Resolves the trimmed name after successful
 * submit, or `undefined` when the user cancels or closes the panel.
 */
export async function openCrudPromptDialog(
  options: OpenCrudPromptDialogOptions,
): Promise<string | undefined>;
export async function openCrudPromptDialog(
  options: OpenCrudPromptDialogOptions,
): Promise<string | CrudPromptResult | undefined> {
  const hasDescription = options.descriptionFieldLabel !== undefined;
  const config: CrudPromptDialogConfig = {
    title: options.title,
    fieldLabel: options.fieldLabel,
    submitLabel: options.submitLabel,
    ...(options.subtitle !== undefined ? { subtitle: options.subtitle } : {}),
    ...(options.placeholder !== undefined
      ? { placeholder: options.placeholder }
      : {}),
    ...(options.initialValue !== undefined
      ? { initialValue: options.initialValue }
      : {}),
    ...(options.descriptionFieldLabel !== undefined
      ? { descriptionFieldLabel: options.descriptionFieldLabel }
      : {}),
    ...(options.descriptionPlaceholder !== undefined
      ? { descriptionPlaceholder: options.descriptionPlaceholder }
      : {}),
    ...(options.initialDescription !== undefined
      ? { initialDescription: options.initialDescription }
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

    const finish = (value: string | CrudPromptResult | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const disposable of disposables) {
        disposable.dispose();
      }
      panel.dispose();
      resolve(value);
    };

    const nonce = createWebviewNonce();
    panel.webview.html = renderCrudPromptDialogHtml(nonce, config);

    disposables.push(
      panel.webview.onDidReceiveMessage((raw) => {
        void (async () => {
          const message = parseCrudPromptMessage(raw);
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

          const validation = validateCrudPromptValue(message.value);
          if (validation.error !== undefined || validation.value === undefined) {
            await panel.webview.postMessage({
              type: 'error',
              message: validation.error ?? 'Name is required.',
            });
            return;
          }

          if (options.validateName !== undefined) {
            const nameError = options.validateName(validation.value);
            if (nameError !== undefined) {
              await panel.webview.postMessage({
                type: 'error',
                message: nameError,
              });
              return;
            }
          }

          const description = hasDescription
            ? normalizeCrudPromptDescription(message.description)
            : undefined;
          const extras =
            hasDescription && description !== undefined
              ? { description }
              : hasDescription
                ? {}
                : undefined;

          try {
            if (options.onSubmit !== undefined) {
              await options.onSubmit(validation.value, extras);
            }
            if (hasDescription) {
              finish({
                name: validation.value,
                ...(description !== undefined ? { description } : {}),
              });
            } else {
              finish(validation.value);
            }
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
