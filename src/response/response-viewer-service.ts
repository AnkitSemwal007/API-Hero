import { randomBytes } from 'node:crypto';

import type { TestReport } from '../assertions';
import type { ExecutionResult } from '../execution';
import { presentExecutionResult } from './presentation';
import {
  parseResponseViewerMessage,
  renderResponseViewerHtml,
} from './viewer-html';


export interface ResponseViewerDisposable {
  dispose(): void;
}

export interface ResponseViewerPanel {
  setHtml(html: string): void;
  reveal(): void;
  onDidDispose(listener: () => void): ResponseViewerDisposable;
  onDidReceiveMessage(listener: (message: unknown) => void): ResponseViewerDisposable;
  dispose(): void;
}

export interface ResponseViewerPanelFactory {
  create(): ResponseViewerPanel;
}

export type ResponseViewerNonceFactory = () => string;

/**
 * Owns one reusable response panel. It consumes execution contracts only and
 * delegates VS Code specifics to a narrow panel factory.
 */
export class ResponseViewerService implements ResponseViewerDisposable {
  private panel: ResponseViewerPanel | undefined;
  private panelDisposables: ResponseViewerDisposable[] = [];

  public constructor(
    private readonly panelFactory: ResponseViewerPanelFactory,
    private readonly createNonce: ResponseViewerNonceFactory = () =>
      randomBytes(18).toString('base64url'),
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
          // Parsing is intentionally the only accepted trust boundary. The
          // current ready message requires no host-side action.
          parseResponseViewerMessage(message);
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
    this.panel.setHtml(renderResponseViewerHtml(model, this.createNonce()));
  }

  public dispose(): void {
    this.releasePanel(true);
  }

  private releasePanel(disposePanel: boolean): void {
    const panel = this.panel;
    this.panel = undefined;
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
    if (disposePanel) {
      panel?.dispose();
    }
  }
}
