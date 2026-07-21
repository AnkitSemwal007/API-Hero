/**
 * Custom Text Editor provider for single-request `.api` files.
 */

import {
  commands,
  Range,
  Uri,
  workspace,
  WorkspaceEdit,
  type CustomTextEditorProvider,
  type Disposable,
  type TextDocument,
  type WebviewPanel,
} from 'vscode';

import { COMMAND_IDS, REQUEST_EDITOR_VIEW_TYPE } from '../../constants';
import { createWebviewNonce } from '../../ui/webview';
import {
  parseSourceToRequestDocument,
  serializeRequestDocument,
  type RequestSourceDocument,
} from '../../request-source';
import { REQUEST_EDITOR_SYNC_DEBOUNCE_MS } from './constants';
import { renderRequestEditorHtml } from './request-editor-html';
import {
  maskSensitiveVariablesForWebview,
  parseRequestEditorMessage,
  redactSensitiveVariablesInSource,
  restoreSensitiveVariablesFromBaseline,
  type RequestEditorAuthProfileOption,
  type RequestEditorState,
} from './request-editor-messages';

export interface RequestEditorProviderOptions {
  readonly getAuthProfiles: () => readonly RequestEditorAuthProfileOption[];
  readonly getVariablePreview?: (
    model: RequestSourceDocument,
  ) => Readonly<Record<string, string>>;
  /**
   * Runs the document request (same pipeline as `apiRunner.runRequest`).
   * Preferred over executeCommand so Custom Text Editors work without an
   * active TextEditor.
   */
  readonly runDocument: (document: TextDocument) => Promise<void>;
}

/**
 * Bidirectional form ↔ document sync for language `api` Custom TextEditor.
 */
export class RequestEditorProvider implements CustomTextEditorProvider {
  public constructor(private readonly options: RequestEditorProviderOptions) {}

  public async resolveCustomTextEditor(
    document: TextDocument,
    webviewPanel: WebviewPanel,
  ): Promise<void> {
    const sync = new RequestEditorDocumentSync(
      document,
      webviewPanel,
      this.options,
    );
    // Dispose only when this panel closes — do not retain per-document sync
    // on the extension-lifetime subscription list.
    webviewPanel.onDidDispose(() => sync.dispose());
    await sync.initialize();
  }
}

class RequestEditorDocumentSync implements Disposable {
  private readonly disposables: Disposable[] = [];
  private disposed = false;
  private formDebounce: ReturnType<typeof setTimeout> | undefined;
  private textDebounce: ReturnType<typeof setTimeout> | undefined;
  /** Document versions written by the form — ignore echo change events. */
  private readonly ignoredVersions = new Set<number>();

  public constructor(
    private readonly document: TextDocument,
    private readonly panel: WebviewPanel,
    private readonly options: RequestEditorProviderOptions,
  ) {}

  public async initialize(): Promise<void> {
    const nonce = createWebviewNonce();
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    this.panel.webview.html = renderRequestEditorHtml(nonce);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((raw) => {
        void this.handleMessage(raw);
      }),
      workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== this.document.uri.toString()) {
          return;
        }
        if (this.ignoredVersions.has(event.document.version)) {
          this.ignoredVersions.delete(event.document.version);
          return;
        }
        this.scheduleTextToForm();
      }),
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.formDebounce !== undefined) {
      clearTimeout(this.formDebounce);
    }
    if (this.textDebounce !== undefined) {
      clearTimeout(this.textDebounce);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = parseRequestEditorMessage(raw);
    if (message === undefined) {
      return;
    }
    if (message.type === 'ready') {
      await this.postState();
      return;
    }
    if (message.type === 'openTextEditor') {
      await commands.executeCommand(
        'vscode.openWith',
        this.document.uri,
        'default',
      );
      return;
    }
    if (message.type === 'switchEnvironment') {
      await commands.executeCommand(COMMAND_IDS.switchEnvironment);
      return;
    }
    if (message.type === 'selectAuthentication') {
      await commands.executeCommand(COMMAND_IDS.selectAuthentication);
      return;
    }
    if (message.type === 'manageAuthProfiles') {
      await commands.executeCommand(COMMAND_IDS.manageAuthProfiles);
      return;
    }
    if (message.type === 'manageEnvironments') {
      await commands.executeCommand(COMMAND_IDS.manageEnvironments);
      return;
    }
    if (message.type === 'run') {
      try {
        await this.options.runDocument(this.document);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await this.panel.webview.postMessage({ type: 'error', message: text });
      }
      return;
    }

    this.scheduleFormToText(message.model, message.documentVersion);
  }

  private scheduleFormToText(
    model: RequestSourceDocument,
    expectedVersion: number,
  ): void {
    if (this.formDebounce !== undefined) {
      clearTimeout(this.formDebounce);
    }
    this.formDebounce = setTimeout(() => {
      this.formDebounce = undefined;
      void this.applyFormModel(model, expectedVersion);
    }, REQUEST_EDITOR_SYNC_DEBOUNCE_MS);
  }

  private scheduleTextToForm(): void {
    if (this.textDebounce !== undefined) {
      clearTimeout(this.textDebounce);
    }
    this.textDebounce = setTimeout(() => {
      this.textDebounce = undefined;
      void this.postState();
    }, REQUEST_EDITOR_SYNC_DEBOUNCE_MS);
  }

  private async applyFormModel(
    model: RequestSourceDocument,
    expectedVersion: number,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.document.version !== expectedVersion) {
      await this.postState();
      return;
    }

    const parsed = parseSourceToRequestDocument(
      this.document.getText(),
      this.document.uri.toString(),
    );
    if (parsed.kind !== 'single') {
      await this.postState();
      return;
    }

    const restored = restoreSensitiveVariablesFromBaseline(
      model,
      parsed.document,
    );
    const nextText = serializeRequestDocument(restored);
    if (nextText === this.document.getText()) {
      return;
    }

    const edit = new WorkspaceEdit();
    const fullRange = new Range(
      this.document.positionAt(0),
      this.document.positionAt(this.document.getText().length),
    );
    edit.replace(this.document.uri, fullRange, nextText);
    const nextVersion = this.document.version + 1;
    this.ignoredVersions.add(nextVersion);
    const applied = await workspace.applyEdit(edit);
    if (!applied) {
      this.ignoredVersions.delete(nextVersion);
      await this.panel.webview.postMessage({
        type: 'error',
        message: 'Could not update the request document.',
      });
      return;
    }
    await this.postState();
  }

  private async postState(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const sourceText = redactSensitiveVariablesInSource(
      this.document.getText(),
    );
    const parsed = parseSourceToRequestDocument(
      this.document.getText(),
      this.document.uri.toString(),
    );
    const authProfiles = this.options.getAuthProfiles();
    let state: RequestEditorState;

    if (parsed.kind === 'multi') {
      state = {
        mode: 'multi',
        documentVersion: this.document.version,
        sourceText,
        requestCount: parsed.requestCount,
        authProfiles,
        fileName: this.document.fileName,
      };
    } else if (parsed.kind === 'empty') {
      state = {
        mode: 'empty',
        documentVersion: this.document.version,
        sourceText,
        requestCount: 0,
        authProfiles,
        fileName: this.document.fileName,
      };
    } else {
      const masked = maskSensitiveVariablesForWebview(parsed.document);
      const variablePreview =
        this.options.getVariablePreview?.(parsed.document) ?? {};
      state = {
        mode: 'form',
        documentVersion: this.document.version,
        sourceText,
        requestCount: 1,
        authProfiles,
        model: masked,
        variablePreview,
        fileName: this.document.fileName,
      };
    }

    await this.panel.webview.postMessage({ type: 'state', state });
  }
}

/** Opens a URI with the request editor custom view type. */
export async function openRequestEditor(uri: Uri): Promise<void> {
  await commands.executeCommand(
    'vscode.openWith',
    uri,
    REQUEST_EDITOR_VIEW_TYPE,
  );
}
