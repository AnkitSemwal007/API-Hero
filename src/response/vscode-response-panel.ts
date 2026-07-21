import type { WebviewPanel } from 'vscode';
import { env, Uri, ViewColumn, window, workspace } from 'vscode';

import type {
  ResponseViewerDisposable,
  ResponseViewerHostActions,
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

/** Clipboard and save-dialog actions for the response viewer host. */
export function createVsCodeResponseViewerHostActions(): ResponseViewerHostActions {
  return {
    async copyText(text: string): Promise<void> {
      await env.clipboard.writeText(text);
      window.setStatusBarMessage('Response copied to clipboard', 2_000);
    },
    async saveText(fileName: string, content: string): Promise<void> {
      const workspaceFolder = workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = workspaceFolder === undefined
        ? Uri.file(fileName)
        : Uri.joinPath(workspaceFolder, fileName);
      const uri = await window.showSaveDialog({
        defaultUri,
        saveLabel: 'Save Response',
      });
      if (uri === undefined) {
        return;
      }
      await workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      window.setStatusBarMessage(`Response saved to ${uri.fsPath}`, 3_000);
    },
  };
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
    listener: (message: unknown) => void | Promise<void>,
  ): ResponseViewerDisposable {
    return this.panel.webview.onDidReceiveMessage(listener);
  }

  public dispose(): void {
    this.panel.dispose();
  }
}
