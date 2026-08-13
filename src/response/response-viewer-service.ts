import {
  generateTypeScriptFromJsonText,
  sanitizeTypeName,
  type GenerateTypeScriptOptions,
} from '../codegen';
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
  type PresentExecutionOptions,
  type ResponseBodyPresentation,
  type ResponsePresentation,
} from './presentation';
import { PresentationRing } from './presentation-ring';
import {
  responseDiff,
  type ResponseDiffResult,
} from './response-diff';
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
  /**
   * Present Copy / Create .ts UX for generated TypeScript (host-owned dialogs).
   * `regenerate` rebuilds source when the user picks a custom root name.
   */
  presentGeneratedTypeScript?(input: {
    readonly code: string;
    readonly rootName: string;
    readonly suggestedFileName: string;
    readonly declarationNames: readonly string[];
    readonly regenerate: (rootName: string) => {
      readonly code: string;
      readonly declarationNames: readonly string[];
    };
  }): void | Promise<void>;
  /** Surface generation failures (no JSON body, parse errors, etc.). */
  notifyGenerateTypeScriptError?(message: string): void | Promise<void>;
}

export interface ResponseViewerServiceOptions {
  readonly getKnownVariableNames?: (
    context?: ResponseViewerExecutionContext,
  ) => readonly string[];
  readonly variableWriter?: VariableWriter;
  /**
   * Optional fallback PresentExecutionOptions when callers omit the explicit
   * argument (e.g. environment label from the active environment).
   */
  readonly getPresentOptions?: () => PresentExecutionOptions | undefined;
  /** In-session presentation ring capacity (Previous vs Current). Default 8. */
  readonly presentationRingCapacity?: number;
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
  private lastDiff: ResponseDiffResult | undefined;
  private readonly ring: PresentationRing;

  public constructor(
    private readonly panelFactory: ResponseViewerPanelFactory,
    private readonly createNonce: ResponseViewerNonceFactory = () =>
      createWebviewNonce(),
    private readonly hostActions: ResponseViewerHostActions = NOOP_HOST_ACTIONS,
    private readonly options: ResponseViewerServiceOptions = {},
  ) {
    this.ring = new PresentationRing({
      capacity: options.presentationRingCapacity,
    });
  }

  /** Shows the result, creating or revealing the shared panel as needed. */
  public show(
    result: ExecutionResult,
    assertions?: TestReport,
    extraction?: ExtractionReport,
    context?: ResponseViewerExecutionContext,
    presentOptions?: PresentExecutionOptions,
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
      this.update(result, assertions, extraction, context, presentOptions);
    } else {
      // Set the new response before revealing to avoid flashing stale content.
      this.update(result, assertions, extraction, context, presentOptions);
      this.panel.reveal();
    }
  }

  /** Replaces the current panel state, creating the panel when necessary. */
  public update(
    result: ExecutionResult,
    assertions?: TestReport,
    extraction?: ExtractionReport,
    context?: ResponseViewerExecutionContext,
    presentOptions?: PresentExecutionOptions,
  ): void {
    if (context !== undefined) {
      this.lastContext = context;
    }
    if (this.panel === undefined) {
      this.show(result, assertions, extraction, context, presentOptions);
      return;
    }
    this.lastResult = result;
    this.lastExtraction = extraction;
    this.lastDiff = undefined;
    const resolvedOptions = this.resolvePresentOptions(presentOptions);
    const model = presentExecutionResult(
      result,
      assertions,
      extraction,
      resolvedOptions,
    );
    this.lastModel = model;
    const ringKey = this.ringKey();
    if (ringKey !== undefined) {
      this.ring.push(ringKey, model);
    }
    this.panel.setHtml(
      renderResponseViewerHtml(model, this.createNonce(), this.renderOptions()),
    );
  }

  /**
   * Compares the newest presentation for the active request with the previous
   * in-session snapshot and re-renders the Diff section.
   */
  public compareWithPrevious(): ResponseDiffResult | undefined {
    const ringKey = this.ringKey();
    const current = this.lastModel;
    if (ringKey === undefined || current === undefined) {
      return undefined;
    }
    const previous = this.ring.previous(ringKey);
    if (previous === undefined) {
      return undefined;
    }
    const diff = responseDiff(previous, current, {
      leftLabel: 'Previous',
      rightLabel: 'Current',
    });
    this.lastDiff = diff;
    if (this.panel !== undefined) {
      this.panel.setHtml(
        renderResponseViewerHtml(current, this.createNonce(), this.renderOptions()),
      );
      this.panel.reveal();
    }
    return diff;
  }

  /** True when the active request has a prior in-session presentation. */
  public canCompareWithPrevious(): boolean {
    const ringKey = this.ringKey();
    return ringKey !== undefined && this.ring.hasPrevious(ringKey);
  }

  /**
   * True when the last successful response has a non-truncated JSON body suitable
   * for TypeScript generation.
   */
  public canGenerateTypeScript(): boolean {
    return this.resolveJsonForTypeScript() !== undefined;
  }

  /** Source id of the last presented execution, when any. */
  public lastExecutionSourceId(): string | undefined {
    return this.lastContext?.sourceId;
  }

  /** Offset of the last presented execution, when any. */
  public lastExecutionOffset(): number | undefined {
    return this.lastContext?.offset;
  }

  /**
   * Infers TypeScript from the last successful JSON response and hands off to
   * the host for Copy / Create .ts. Returns the generated source, or undefined
   * when generation is unavailable.
   */
  public async generateTypeScript(
    rootName?: string,
    options?: { readonly attribution?: GenerateTypeScriptOptions['attribution'] },
  ): Promise<string | undefined> {
    const jsonText = this.resolveJsonForTypeScript();
    if (jsonText === undefined) {
      await this.notifyGenerateTypeScriptError(
        'Generate TypeScript is available for successful JSON responses only.',
      );
      return undefined;
    }
    const generateOptions: GenerateTypeScriptOptions = {
      rootName: sanitizeTypeName(rootName ?? 'Root'),
      ...(options?.attribution === undefined
        ? {}
        : { attribution: options.attribution }),
    };
    const parsed = generateTypeScriptFromJsonText(jsonText, generateOptions);
    if (!parsed.ok) {
      await this.notifyGenerateTypeScriptError(parsed.message);
      return undefined;
    }
    const regenerate = (nextRootName: string): {
      readonly code: string;
      readonly declarationNames: readonly string[];
    } => {
      const again = generateTypeScriptFromJsonText(jsonText, {
        ...generateOptions,
        rootName: sanitizeTypeName(nextRootName),
      });
      return again.ok
        ? { code: again.result.code, declarationNames: again.result.declarationNames }
        : { code: parsed.result.code, declarationNames: parsed.result.declarationNames };
    };
    if (this.hostActions.presentGeneratedTypeScript !== undefined) {
      await this.hostActions.presentGeneratedTypeScript({
        code: parsed.result.code,
        rootName: parsed.result.rootName,
        suggestedFileName: `${toKebabFileStem(parsed.result.rootName)}.ts`,
        declarationNames: parsed.result.declarationNames,
        regenerate,
      });
    } else {
      await this.hostActions.copyText(parsed.result.code);
    }
    return parsed.result.code;
  }

  /**
   * Renders a diff between two arbitrary presentations (e.g. collection Run A
   * vs Run B) in the response panel.
   */
  public showDiff(
    left: ResponsePresentation,
    right: ResponsePresentation,
    labels?: { readonly leftLabel?: string; readonly rightLabel?: string },
  ): ResponseDiffResult {
    const diff = responseDiff(left, right, {
      leftLabel: labels?.leftLabel ?? 'A',
      rightLabel: labels?.rightLabel ?? 'B',
    });
    this.lastDiff = diff;
    this.lastModel = right;
    // Diff-only mode may show presentations that are not the last execution.
    // Clear execution bindings so Create Variable / Detected Auth / path copy
    // cannot target a different result than the shown presentation.
    this.lastResult = undefined;
    this.lastContext = undefined;
    this.lastExtraction = undefined;
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
    }
    this.panel.setHtml(
      renderResponseViewerHtml(right, this.createNonce(), this.renderOptions()),
    );
    this.panel.reveal();
    return diff;
  }

  public dispose(): void {
    this.releasePanel(true);
  }

  private resolvePresentOptions(
    explicit?: PresentExecutionOptions,
  ): PresentExecutionOptions | undefined {
    let fromProvider: PresentExecutionOptions | undefined;
    try {
      fromProvider = this.options.getPresentOptions?.();
    } catch {
      fromProvider = undefined;
    }
    if (explicit === undefined && fromProvider === undefined) {
      return undefined;
    }
    return {
      ...(fromProvider ?? {}),
      ...(explicit ?? {}),
    };
  }

  private ringKey(): string | undefined {
    const fromContext = this.lastContext?.requestKey?.trim();
    if (fromContext !== undefined && fromContext.length > 0) {
      return fromContext;
    }
    const fromModel = this.lastModel?.requestId?.trim();
    return fromModel !== undefined && fromModel.length > 0 ? fromModel : undefined;
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
    const canComparePrevious = this.canCompareWithPrevious();
    const canGenerateTypeScript = this.canGenerateTypeScript();
    return {
      enableCreateVariable: this.lastContext !== undefined,
      knownVariableNames,
      ...(detectedAuthTokenCount > 0 ? { detectedAuthTokenCount } : {}),
      ...(canComparePrevious ? { canComparePrevious: true } : {}),
      ...(canGenerateTypeScript ? { canGenerateTypeScript: true } : {}),
      ...(this.lastDiff === undefined ? {} : { diff: this.lastDiff }),
    };
  }

  private async handleMessage(message: ResponseViewerMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          return;
        case 'comparePrevious': {
          this.compareWithPrevious();
          return;
        }
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
        case 'generateTypeScript': {
          await this.generateTypeScript();
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
      if (message.type === 'generateTypeScript') {
        const detail =
          error instanceof Error ? error.message : 'Unexpected error.';
        await this.notifyGenerateTypeScriptError(
          `Could not generate TypeScript: ${detail}`,
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

  private async notifyGenerateTypeScriptError(message: string): Promise<void> {
    if (this.hostActions.notifyGenerateTypeScriptError !== undefined) {
      await this.hostActions.notifyGenerateTypeScriptError(message);
    } else if (this.hostActions.notifyCreateVariableError !== undefined) {
      await this.hostActions.notifyCreateVariableError(message);
    }
  }

  /** JSON body text for type generation, or undefined when unavailable. */
  private resolveJsonForTypeScript(): string | undefined {
    const model = this.lastModel;
    const result = this.lastResult;
    if (model === undefined || model.failure !== undefined) {
      return undefined;
    }
    // Prefer the canonical execution body. `prettyAvailable` is a UI flag
    // (pretty !== raw) and is false for already-pretty JSON such as
    // jsonplaceholder — it must not gate generation.
    if (result !== undefined && result.success) {
      const fromResult =
        result.response.body.text
        ?? (result.response.body.json !== undefined
          ? JSON.stringify(result.response.body.json)
          : undefined);
      if (fromResult !== undefined && fromResult.trim().length > 0) {
        try {
          JSON.parse(fromResult);
          return fromResult;
        } catch {
          // Fall through to presentation text.
        }
      }
    }
    const body = model.body;
    if (body === undefined || body.language !== 'json' || body.truncated) {
      return undefined;
    }
    const candidate = body.pretty?.trim() || body.raw.trim();
    if (candidate.length === 0) {
      return undefined;
    }
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return undefined;
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
    this.lastDiff = undefined;
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
    if (disposePanel) {
      // Extension shutdown: drop the last execution snapshot.
      this.lastModel = undefined;
      this.lastExtraction = undefined;
      this.lastResult = undefined;
      this.lastContext = undefined;
      panel?.dispose();
      return;
    }
    // Closing the webview must not drop the last JSON snapshot. Generate
    // TypeScript (command / CodeLens) is valid after a successful JSON run
    // even when VS Code disposes the panel (retainContextWhenHidden: false).
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

function toKebabFileStem(typeName: string): string {
  const stem = typeName
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  return stem.length > 0 ? stem : 'response';
}
