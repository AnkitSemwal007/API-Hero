import type { WebviewPanel } from 'vscode';
import {
  commands,
  env,
  Uri,
  ViewColumn,
  window,
  workspace,
} from 'vscode';

import { COMMAND_IDS } from '../constants';
import type { VariableWriteTargetScope, VariableWriter } from '../extraction';
import type { RequestSourceExtractionRule } from '../request-source';
import { insertExtractionRuleIntoSource } from './vscode-insert-extraction-rule';
import type {
  ResponseViewerDisposable,
  ResponseViewerHostActions,
  ResponseViewerPanel,
  ResponseViewerPanelFactory,
} from './response-viewer-service';

const RESPONSE_PANEL_VIEW_TYPE = 'apiHero.response';

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

export interface CreateVariableHostOptions {
  readonly writer: VariableWriter;
  /** Optional host handler for Use as Authentication (body never re-sent to webview). */
  readonly useResponseAsAuthentication?: (body: unknown) => void | Promise<void>;
}

/** Clipboard, save-dialog, and Create Variable actions for the response viewer. */
export function createVsCodeResponseViewerHostActions(
  createVariable?: CreateVariableHostOptions,
): ResponseViewerHostActions {
  return {
    async copyText(text: string): Promise<void> {
      await env.clipboard.writeText(text);
      window.setStatusBarMessage('Copied to clipboard', 2_000);
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
    notifyCreateVariableError(message: string): void {
      void window.showErrorMessage(message);
    },
    ...(createVariable?.useResponseAsAuthentication === undefined
      ? {}
      : {
          useResponseAsAuthentication:
            createVariable.useResponseAsAuthentication,
        }),
    ...(createVariable?.writer === undefined
      ? {}
      : {
          createVariableFromResponse: async (input: {
            readonly sourceId: string;
            readonly requestKey: string;
            readonly rule: RequestSourceExtractionRule;
            readonly value: string;
            readonly scope: VariableWriteTargetScope;
            readonly sensitive: boolean;
          }): Promise<void> => {
            const insert = await insertExtractionRuleIntoSource({
              sourceId: input.sourceId,
              requestKey: input.requestKey,
              rule: input.rule,
            });
            if (!insert.ok) {
              window.showErrorMessage(
                `Could not save extract rule: ${insert.message}`,
              );
              return;
            }

            const write = await createVariable.writer.write({
              name: input.rule.name,
              value: input.value,
              scope: input.scope,
              sensitive: input.sensitive,
              requestKey: input.requestKey,
            });
            if (!write.ok) {
              window.showErrorMessage(
                `Extract rule saved, but writing the value failed: ${write.message}`,
              );
              return;
            }

            const openVariables = 'Open Variables';
            const choice = await window.showInformationMessage(
              `Saved extract rule for {{${input.rule.name}}} (${input.scope}).`,
              openVariables,
            );
            if (choice === openVariables) {
              await commands.executeCommand(COMMAND_IDS.manageEnvironments);
            }
          },
        }),
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
