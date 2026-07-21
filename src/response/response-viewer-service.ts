import { randomBytes } from 'node:crypto';

import type { TestReport } from '../assertions';
import type { ExecutionResult } from '../execution';
import {
  presentExecutionResult,
  type ResponseBodyPresentation,
  type ResponsePresentation,
} from './presentation';
import {
  parseResponseViewerMessage,
  type ResponseViewerMessage,
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

/**
 * Host-side clipboard and filesystem actions. The webview never receives
 * secrets; the service copies/saves from the already-masked presentation model.
 */
export interface ResponseViewerHostActions {
  copyText(text: string): void | Promise<void>;
  saveText(fileName: string, content: string): void | Promise<void>;
}

const NOOP_HOST_ACTIONS: ResponseViewerHostActions = {
  copyText: () => undefined,
  saveText: () => undefined,
};

/**
 * Owns one reusable response panel. It consumes execution contracts only and
 * delegates VS Code specifics to a narrow panel factory and host actions.
 */
export class ResponseViewerService implements ResponseViewerDisposable {
  private panel: ResponseViewerPanel | undefined;
  private panelDisposables: ResponseViewerDisposable[] = [];
  private lastModel: ResponsePresentation | undefined;

  public constructor(
    private readonly panelFactory: ResponseViewerPanelFactory,
    private readonly createNonce: ResponseViewerNonceFactory = () =>
      randomBytes(18).toString('base64url'),
    private readonly hostActions: ResponseViewerHostActions = NOOP_HOST_ACTIONS,
  ) {}

  /** Shows the result, creating or revealing the shared panel as needed. */
  public show(result: ExecutionResult, assertions?: TestReport): void {
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
      this.update(result, assertions);
    } else {
      // Set the new response before revealing to avoid flashing stale content.
      this.update(result, assertions);
      this.panel.reveal();
    }
  }

  /** Replaces the current panel state, creating the panel when necessary. */
  public update(result: ExecutionResult, assertions?: TestReport): void {
    if (this.panel === undefined) {
      this.show(result, assertions);
      return;
    }
    const model = presentExecutionResult(result, assertions);
    this.lastModel = model;
    this.panel.setHtml(renderResponseViewerHtml(model, this.createNonce()));
  }

  public dispose(): void {
    this.releasePanel(true);
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
      }
    } catch {
      // Host clipboard/FS failures must not crash the message loop.
    }
  }

  private releasePanel(disposePanel: boolean): void {
    const panel = this.panel;
    this.panel = undefined;
    this.lastModel = undefined;
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
    if (disposePanel) {
      panel?.dispose();
    }
  }
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
