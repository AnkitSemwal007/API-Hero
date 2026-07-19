import type { WebviewPanel } from 'vscode';
import { ViewColumn, window } from 'vscode';

import type {
  ResponseViewerDisposable,
  ResponseViewerPanel,
  ResponseViewerPanelFactory,
} from './response-viewer-service';

const RESPONSE_PANEL_VIEW_TYPE = 'apiRunner.response';

/** VS Code webview adapter for the framework-neutral response viewer service. */
export class VsCodeResponsePanelFactory implements ResponseViewerPanelFactory {
  public create(): ResponseViewerPanel {
    const panel = window.createWebviewPanel(
      RESPONSE_PANEL_VIEW_TYPE,
      'API Response',
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [],
        retainContextWhenHidden: false,
      },
    );
    return new VsCodeResponsePanel(panel);
  }
}

class VsCodeResponsePanel implements ResponseViewerPanel {
  public constructor(private readonly panel: WebviewPanel) {}

  public setHtml(html: string): void {
    this.panel.webview.html = html;
  }

  public reveal(): void {
    this.panel.reveal(undefined, true);
  }

  public onDidDispose(listener: () => void): ResponseViewerDisposable {
    return this.panel.onDidDispose(listener);
  }

  public onDidReceiveMessage(
    listener: (message: unknown) => void,
  ): ResponseViewerDisposable {
    return this.panel.webview.onDidReceiveMessage(listener);
  }

  public dispose(): void {
    this.panel.dispose();
  }
}
