import type { TestReport } from '../assertions';
import { detectAuthTokensInJson } from '../auth/detect-auth-tokens';
import type { ExecutionResult } from '../execution';
import type {
  ExtractionReport,
  VariableWriteTargetScope,
  VariableWriter,
} from '../extraction';
import {
  coerceExtractionValue,
  isExtractableJsonPath,
  resolveJsonPath,
  stripBodyPrefix,
} from '../extraction';
import type { RequestSourceExtractionRule } from '../request-source';
import { createWebviewNonce } from '../ui/webview';
import {
  isCreateVariableScope,
  isValidVariableName,
  looksSensitiveForExtract,
} from './create-variable';
import {
  presentExecutionResult,
  type ResponseBodyPresentation,
  type ResponsePresentation,
} from './presentation';
import {
  parseResponseViewerMessage,
  type ResponseViewerMessage,
  type ResponseViewerRenderOptions,
  renderResponseViewerHtml,
} from './viewer-html';

export interface ResponseViewerDisposable {
  dispose(): void;
}

export interface ResponseViewerPanel {
  setHtml(html: string): void;
  reveal(): void;
  onDidDispose(listener: () => void): ResponseViewerDisposable;
  onDidReceiveMessage(
    listener: (message: unknown) => void | Promise<void>,
  ): ResponseViewerDisposable;
  dispose(): void;
}

export interface ResponseViewerPanelFactory {
  create(): ResponseViewerPanel;
}

export type ResponseViewerNonceFactory = () => string;

/** Identity of the request that produced the last presented result. */
export interface ResponseViewerExecutionContext {
  readonly sourceId: string;
  readonly requestKey: string;
  readonly offset: number;
}

/**
 * Host-side clipboard and filesystem actions. The webview posts paths (and
 * presentation-model copy/save payloads); leaf scalars in the JSON tree are
 * still rendered for display like any response viewer.
 */
export interface ResponseViewerHostActions {
  copyText(text: string): void | Promise<void>;
  saveText(fileName: string, content: string): void | Promise<void>;
  /**
   * Mode B Create Variable: persist `@extract` into the request source and
   * write the current value via {@link VariableWriter}.
   */
  createVariableFromResponse?(input: {
    readonly sourceId: string;
    readonly requestKey: string;
    readonly rule: RequestSourceExtractionRule;
    readonly value: string;
    readonly scope: VariableWriteTargetScope;
    readonly sensitive: boolean;
  }): void | Promise<void>;
  /** Surface Create Variable validation / host failures to the user. */
  notifyCreateVariableError?(message: string): void | Promise<void>;
  /** Apply JSON body tokens to Authentication Session (host-side; no webview secrets). */
  useResponseAsAuthentication?(body: unknown): void | Promise<void>;
}

export interface ResponseViewerServiceOptions {
  readonly getKnownVariableNames?: (
    context?: ResponseViewerExecutionContext,
  ) => readonly string[];
  readonly variableWriter?: VariableWriter;
}

const NOOP_HOST_ACTIONS: ResponseViewerHostActions = {
  copyText: () => undefined,
  saveText: () => undefined,
};

/** Defense-in-depth cap for webview-supplied `copyText` (paths / rare fallbacks). */
const COPY_TEXT_MAX_CHARS = 8_192;

/**
 * Owns one reusable response panel. It consumes execution contracts only and
 * delegates VS Code specifics to a narrow panel factory and host actions.
 */
export class ResponseViewerService implements ResponseViewerDisposable {
  private panel: ResponseViewerPanel | undefined;
  private panelDisposables: ResponseViewerDisposable[] = [];
  private lastModel: ResponsePresentation | undefined;
  private lastExtraction: ExtractionReport | undefined;
  private lastResult: ExecutionResult | undefined;
  private lastContext: ResponseViewerExecutionContext | undefined;

  public constructor(
    private readonly panelFactory: ResponseViewerPanelFactory,
    private readonly createNonce: ResponseViewerNonceFactory = () =>
      createWebviewNonce(),
    private readonly hostActions: ResponseViewerHostActions = NOOP_HOST_ACTIONS,
    private readonly options: ResponseViewerServiceOptions = {},
  ) {}

  /** Shows the result, creating or revealing the shared panel as needed. */
  public show(
    result: ExecutionResult,
    assertions?: TestReport,
    extraction?: ExtractionReport,
    context?: ResponseViewerExecutionContext,
  ): void {
    if (context !== undefined) {
      this.lastContext = context;
    }
    if (this.panel === undefined) {
      this.panel = this.panelFactory.create();
      const ownedPanel = this.panel;
      this.panelDisposables = [
        ownedPanel.onDidDispose(() => {
          if (this.panel === ownedPanel) {
            this.releasePanel(false);
          }
        }),
        ownedPanel.onDidReceiveMessage((message) => {
          const parsed = parseResponseViewerMessage(message);
          if (parsed === undefined) {
            return;
          }
          return this.handleMessage(parsed);
        }),
      ];
      this.update(result, assertions, extraction, context);
    } else {
      // Set the new response before revealing to avoid flashing stale content.
      this.update(result, assertions, extraction, context);
      this.panel.reveal();
    }
  }

  /** Replaces the current panel state, creating the panel when necessary. */
  public update(
    result: ExecutionResult,
    assertions?: TestReport,
    extraction?: ExtractionReport,
    context?: ResponseViewerExecutionContext,
  ): void {
    if (context !== undefined) {
      this.lastContext = context;
    }
    if (this.panel === undefined) {
      this.show(result, assertions, extraction, context);
      return;
    }
    this.lastResult = result;
    this.lastExtraction = extraction;
    const model = presentExecutionResult(result, assertions, extraction);
    this.lastModel = model;
    this.panel.setHtml(
      renderResponseViewerHtml(model, this.createNonce(), this.renderOptions()),
    );
  }

  public dispose(): void {
    this.releasePanel(true);
  }

  private renderOptions(): ResponseViewerRenderOptions {
    let knownVariableNames: readonly string[];
    try {
      knownVariableNames =
        this.options.getKnownVariableNames?.(this.lastContext) ?? [];
    } catch {
      // Known-name lookup must never block opening the response panel.
      knownVariableNames = [];
    }
    const detectedAuthTokenCount = countDetectedAuthTokens(this.lastResult);
    return {
      enableCreateVariable: this.lastContext !== undefined,
      knownVariableNames,
      ...(detectedAuthTokenCount > 0 ? { detectedAuthTokenCount } : {}),
    };
  }

  private async handleMessage(message: ResponseViewerMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          return;
        case 'copyBody': {
          const text = bodyTextForMode(this.lastModel?.body, message.mode);
          if (text !== undefined) {
            await this.hostActions.copyText(text);
          }
          return;
        }
        case 'copyHeaders': {
          const headers = this.lastModel?.headers;
          if (headers === undefined) {
            return;
          }
          const text = headers
            .map((header) => `${header.name}: ${header.value}`)
            .join('\n');
          await this.hostActions.copyText(text);
          return;
        }
        case 'saveBody': {
          const body = this.lastModel?.body;
          if (body?.truncated === true) {
            return;
          }
          const text = bodyTextForMode(body, message.mode);
          if (text === undefined || body === undefined) {
            return;
          }
          await this.hostActions.saveText(
            suggestedBodyFileName(body.language),
            text,
          );
          return;
        }
        case 'copyText': {
          const text =
            message.text.length > COPY_TEXT_MAX_CHARS
              ? message.text.slice(0, COPY_TEXT_MAX_CHARS)
              : message.text;
          await this.hostActions.copyText(text);
          return;
        }
        case 'copyJsonPathValue': {
          await this.handleCopyJsonPathValue(message.path);
          return;
        }
        case 'createVariable': {
          await this.handleCreateVariable(message);
          return;
        }
        case 'useAsAuthentication': {
          await this.handleUseAsAuthentication();
          return;
        }
      }
    } catch (error: unknown) {
      if (message.type === 'createVariable') {
        const detail =
          error instanceof Error ? error.message : 'Unexpected error.';
        await this.notifyCreateVariableError(
          `Could not create variable: ${detail}`,
        );
      }
      // Host clipboard/FS failures must not crash the message loop.
    }
  }

  private async handleCopyJsonPathValue(path: string): Promise<void> {
    const result = this.lastResult;
    if (result === undefined) {
      return;
    }
    const value = resolveCreateVariableValue(result, path);
    if (value === undefined) {
      return;
    }
    await this.hostActions.copyText(value);
  }

  private async handleCreateVariable(
    message: Extract<ResponseViewerMessage, { type: 'createVariable' }>,
  ): Promise<void> {
    const context = this.lastContext;
    const result = this.lastResult;
    if (context === undefined || result === undefined) {
      await this.notifyCreateVariableError(
        'Cannot create variable: no active response context.',
      );
      return;
    }
    if (!isValidVariableName(message.name)) {
      await this.notifyCreateVariableError(
        'Cannot create variable: invalid variable name.',
      );
      return;
    }
    if (!isCreateVariableScope(message.scope)) {
      await this.notifyCreateVariableError(
        'Cannot create variable: unsupported scope.',
      );
      return;
    }
    const path = message.path.trim();
    if (path.length === 0) {
      await this.notifyCreateVariableError(
        'Cannot create variable: path is required.',
      );
      return;
    }
    if (!isExtractableJsonPath(path)) {
      await this.notifyCreateVariableError(
        'Cannot create variable: unsupported path syntax.',
      );
      return;
    }

    const value = resolveCreateVariableValue(result, path);
    if (value === undefined) {
      await this.notifyCreateVariableError(
        'Cannot create variable: could not resolve a scalar value at that path.',
      );
      return;
    }

    const scope: VariableWriteTargetScope = message.scope;
    const sensitive =
      message.sensitive
      || looksSensitiveForExtract(message.name, path);
    const ruleWithScope: RequestSourceExtractionRule = {
      name: message.name,
      from: path,
      ...(scope === 'run' ? {} : { scope }),
      ...(sensitive ? { sensitive: true } : {}),
    };

    if (this.hostActions.createVariableFromResponse !== undefined) {
      await this.hostActions.createVariableFromResponse({
        sourceId: context.sourceId,
        requestKey: context.requestKey,
        rule: ruleWithScope,
        value,
        scope,
        sensitive,
      });
      return;
    }

    // Fallback: write value only when no host persist hook is wired (tests).
    if (this.options.variableWriter !== undefined) {
      await this.options.variableWriter.write({
        name: message.name,
        value,
        scope,
        sensitive,
        requestKey: context.requestKey,
      });
    }
  }

  private async notifyCreateVariableError(message: string): Promise<void> {
    if (this.hostActions.notifyCreateVariableError !== undefined) {
      await this.hostActions.notifyCreateVariableError(message);
    }
  }

  private async handleUseAsAuthentication(): Promise<void> {
    const result = this.lastResult;
    if (result === undefined || !result.success) {
      await this.notifyCreateVariableError(
        'Cannot use as Authentication: no successful response body.',
      );
      return;
    }
    const body =
      result.response.body.json ??
      (result.response.body.text !== undefined
        ? (() => {
            try {
              return JSON.parse(result.response.body.text) as unknown;
            } catch {
              return undefined;
            }
          })()
        : undefined);
    if (body === undefined) {
      await this.notifyCreateVariableError(
        'Cannot use as Authentication: response body is not JSON.',
      );
      return;
    }
    if (this.hostActions.useResponseAsAuthentication === undefined) {
      await this.notifyCreateVariableError(
        'Use as Authentication is not available.',
      );
      return;
    }
    await this.hostActions.useResponseAsAuthentication(body);
  }

  private releasePanel(disposePanel: boolean): void {
    const panel = this.panel;
    this.panel = undefined;
    this.lastModel = undefined;
    this.lastExtraction = undefined;
    this.lastResult = undefined;
    this.lastContext = undefined;
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
    if (disposePanel) {
      panel?.dispose();
    }
  }
}

/** Resolves a Create Variable path against the last execution result. */
export function resolveCreateVariableValue(
  result: ExecutionResult,
  path: string,
): string | undefined {
  if (!result.success) {
    return undefined;
  }
  const bodyText = result.response.body.text;
  if (bodyText === undefined) {
    return undefined;
  }
  let root: unknown;
  try {
    root = JSON.parse(bodyText) as unknown;
  } catch {
    return undefined;
  }
  const resolved = resolveJsonPath(root, stripBodyPrefix(path));
  if (!resolved.found) {
    return undefined;
  }
  if (
    resolved.value !== null
    && typeof resolved.value === 'object'
  ) {
    // Scalars only for Extract Variable (ADR preference).
    return undefined;
  }
  return coerceExtractionValue(resolved.value);
}

function bodyTextForMode(
  body: ResponseBodyPresentation | undefined,
  mode: 'pretty' | 'raw',
): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  return mode === 'raw' ? body.raw : body.pretty;
}

function countDetectedAuthTokens(result: ExecutionResult | undefined): number {
  if (result === undefined || !result.success) {
    return 0;
  }
  const body =
    result.response.body.json ??
    (result.response.body.text !== undefined
      ? (() => {
          try {
            return JSON.parse(result.response.body.text) as unknown;
          } catch {
            return undefined;
          }
        })()
      : undefined);
  if (body === undefined) {
    return 0;
  }
  return detectAuthTokensInJson(body).filter(
    (candidate) =>
      candidate.kind === 'access_token' ||
      candidate.kind === 'id_token' ||
      candidate.kind === 'generic_token' ||
      candidate.kind === 'refresh_token',
  ).length;
}

function suggestedBodyFileName(
  language: ResponseBodyPresentation['language'],
): string {
  switch (language) {
    case 'json':
      return 'response.json';
    case 'html':
      return 'response.html';
    case 'xml':
      return 'response.xml';
    case 'binary':
      return 'response.bin';
    default:
      return 'response.txt';
  }
}
