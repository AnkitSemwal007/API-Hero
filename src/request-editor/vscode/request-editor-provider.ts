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
import { describeFilesystemFailure, fireAndForget } from '../../shared';
import { createWebviewNonce } from '../../ui/webview';
import {
  parseSourceToRequestDocument,
  serializeRequestDocument,
  type RequestSourceDocument,
} from '../../request-source';
import {
  clearActiveRequestEditorDocument,
  setActiveRequestEditorDocument,
} from './active-request-editor';
import { REQUEST_EDITOR_SYNC_DEBOUNCE_MS } from './constants';
import { renderRequestEditorHtml } from './request-editor-html';
import {
  createRequestEditorAck,
  createRequestEditorResubmit,
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
  readonly getVariableCompletions?: (
    model: RequestSourceDocument,
  ) => readonly import('./request-editor-messages').RequestEditorVariableCompletion[];
  /** Active environment display name, or undefined when none is selected. */
  readonly getActiveEnvironmentLabel?: () => string | undefined;
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
  private textDebounce: ReturnType<typeof setTimeout> | undefined;
  /** Document versions written by the form — ignore echo change events. */
  private readonly ignoredVersions = new Set<number>();
  /** Latest form model waiting to apply (coalesced while an apply is in flight). */
  private pendingForm:
    | { readonly model: RequestSourceDocument; expectedVersion: number }
    | undefined;
  private applyInFlight = false;
  private readonly drainWaiters: Array<() => void> = [];

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

    if (this.panel.active) {
      setActiveRequestEditorDocument(this.document);
    }

    this.disposables.push(
      this.panel.onDidChangeViewState(() => {
        if (this.panel.active) {
          setActiveRequestEditorDocument(this.document);
        } else {
          clearActiveRequestEditorDocument(this.document);
        }
      }),
      this.panel.webview.onDidReceiveMessage((raw) => {
        fireAndForget(this.handleMessage(raw), (error: unknown) =>
          this.reportBackgroundError(error, 'Could not handle editor message.'),
        );
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
    clearActiveRequestEditorDocument(this.document);
    this.pendingForm = undefined;
    if (this.textDebounce !== undefined) {
      clearTimeout(this.textDebounce);
    }
    // Unblock waitUntilFormAppliesIdle if Run was waiting on a flush.
    const waiters = this.drainWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
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
        // Wait for any in-flight / pending form→text apply before executing.
        await this.waitUntilFormAppliesIdle();
        await this.options.runDocument(this.document);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await this.panel.webview.postMessage({ type: 'error', message: text });
      }
      return;
    }

    this.enqueueFormModel(message.model, message.documentVersion);
  }

  /**
   * Apply form→text immediately (webview already debounces). Serialize applies
   * and keep only the latest pending model while one is in flight.
   */
  private enqueueFormModel(
    model: RequestSourceDocument,
    expectedVersion: number,
  ): void {
    this.pendingForm = { model, expectedVersion };
    fireAndForget(this.drainFormApplies(), (error: unknown) =>
      this.reportBackgroundError(
        error,
        'Could not apply request editor changes.',
      ),
    );
  }

  /** Resolves when no form apply is in flight and nothing is queued. */
  private async waitUntilFormAppliesIdle(): Promise<void> {
    while (!this.disposed) {
      if (this.pendingForm !== undefined && !this.applyInFlight) {
        await this.drainFormApplies();
        continue;
      }
      if (!this.applyInFlight && this.pendingForm === undefined) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.drainWaiters.push(resolve);
      });
    }
  }

  private async drainFormApplies(): Promise<void> {
    if (this.applyInFlight) {
      return;
    }
    this.applyInFlight = true;
    try {
      while (this.pendingForm !== undefined && !this.disposed) {
        const pending = this.pendingForm;
        this.pendingForm = undefined;
        await this.applyFormModel(pending.model, pending.expectedVersion);
        // Do NOT rebase expectedVersion onto concurrent buffer edits — that can
        // clobber text changes. Version skew is handled inside applyFormModel
        // via postResubmit; drop any stale pending model that arrived mid-apply
        // with an outdated expectedVersion.
        if (this.dropStalePendingForm()) {
          await this.postResubmit();
        }
      }
    } finally {
      this.applyInFlight = false;
      const waiters = this.drainWaiters.splice(0);
      for (const waiter of waiters) {
        waiter();
      }
      if (this.pendingForm !== undefined && !this.disposed) {
        fireAndForget(this.drainFormApplies(), (error: unknown) =>
          this.reportBackgroundError(
            error,
            'Could not apply request editor changes.',
          ),
        );
      }
    }
  }

  /** Drops a coalesced form update whose expected version no longer matches. */
  private dropStalePendingForm(): boolean {
    const coalesced = this.pendingForm;
    if (
      coalesced === undefined ||
      coalesced.expectedVersion === this.document.version
    ) {
      return false;
    }
    this.pendingForm = undefined;
    return true;
  }

  private scheduleTextToForm(): void {
    if (this.textDebounce !== undefined) {
      clearTimeout(this.textDebounce);
    }
    this.textDebounce = setTimeout(() => {
      this.textDebounce = undefined;
      fireAndForget(this.postState(), (error: unknown) =>
        this.reportBackgroundError(
          error,
          'Could not refresh the request editor.',
        ),
      );
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
      await this.postResubmit();
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
      await this.postAck();
      return;
    }

    // Re-check immediately before applyEdit — concurrent text edits may land
    // after the earlier version check.
    if (this.document.version !== expectedVersion) {
      await this.postResubmit();
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
    let applied: boolean;
    try {
      applied = await workspace.applyEdit(edit);
    } catch (error) {
      this.ignoredVersions.delete(nextVersion);
      const filesystemHint = describeFilesystemFailure(error);
      await this.panel.webview.postMessage({
        type: 'error',
        message:
          filesystemHint ??
          (error instanceof Error
            ? error.message
            : 'Could not update the request document.'),
      });
      return;
    }
    if (!applied) {
      this.ignoredVersions.delete(nextVersion);
      await this.panel.webview.postMessage({
        type: 'error',
        message:
          'Could not update the request document. The file may be read-only.',
      });
      return;
    }
    await this.postAck();
  }

  private async reportBackgroundError(
    error: unknown,
    fallback: string,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const text =
      describeFilesystemFailure(error) ??
      (error instanceof Error && error.message.trim().length > 0
        ? error.message
        : fallback);
    try {
      await this.panel.webview.postMessage({ type: 'error', message: text });
    } catch {
      // Panel may already be disposed.
    }
  }

  private async postAck(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.panel.webview.postMessage(
      createRequestEditorAck(
        this.document.version,
        redactSensitiveVariablesInSource(this.document.getText()),
      ),
    );
  }

  private async postResubmit(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.panel.webview.postMessage(
      createRequestEditorResubmit(this.document.version),
    );
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
    const activeEnvironmentLabel = this.options.getActiveEnvironmentLabel?.();
    const withActiveEnv = <T extends RequestEditorState>(
      base: Omit<T, 'activeEnvironmentLabel'>,
    ): T =>
      (activeEnvironmentLabel === undefined
        ? base
        : { ...base, activeEnvironmentLabel }) as T;
    let state: RequestEditorState;

    if (parsed.kind === 'multi') {
      state = withActiveEnv({
        mode: 'multi',
        documentVersion: this.document.version,
        sourceText,
        requestCount: parsed.requestCount,
        authProfiles,
        fileName: this.document.fileName,
      });
    } else if (parsed.kind === 'empty') {
      state = withActiveEnv({
        mode: 'empty',
        documentVersion: this.document.version,
        sourceText,
        requestCount: 0,
        authProfiles,
        fileName: this.document.fileName,
      });
    } else {
      const masked = maskSensitiveVariablesForWebview(parsed.document);
      const variablePreview =
        this.options.getVariablePreview?.(parsed.document) ?? {};
      const variableCompletions =
        this.options.getVariableCompletions?.(parsed.document) ?? [];
      state = withActiveEnv({
        mode: 'form',
        documentVersion: this.document.version,
        sourceText,
        requestCount: 1,
        authProfiles,
        model: masked,
        variablePreview,
        variableCompletions,
        fileName: this.document.fileName,
      });
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
