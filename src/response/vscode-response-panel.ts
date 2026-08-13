import type { WebviewPanel } from 'vscode';
import {
  commands,
  env,
  Position,
  Range,
  Uri,
  ViewColumn,
  window,
  workspace,
  WorkspaceEdit,
} from 'vscode';

import { sanitizeTypeName } from '../codegen';
import { COMMAND_IDS } from '../constants';
import type { VariableWriteTargetScope, VariableWriter } from '../extraction';
import type { RequestSourceExtractionRule } from '../request-source';
import {
  collidingGeneratedTypeNames,
  prepareGeneratedTypeInsertion,
} from '../source-integration/type-insertion';
import { isTypeScriptLanguageId } from '../source-integration/languages';
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
    notifyGenerateTypeScriptError(message: string): void {
      void window.showErrorMessage(message);
    },
    async presentGeneratedTypeScript(input): Promise<void> {
      await presentGeneratedTypeScriptUx(input);
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

async function presentGeneratedTypeScriptUx(input: {
  readonly code: string;
  readonly rootName: string;
  readonly suggestedFileName: string;
  readonly declarationNames: readonly string[];
  readonly regenerate: (rootName: string) => {
    readonly code: string;
    readonly declarationNames: readonly string[];
  };
}): Promise<void> {
  const copy = 'Copy';
  const preview = 'Preview';
  const insert = 'Insert into editor';
  const createFile = 'Create .ts';
  const editor = window.activeTextEditor;
  const canInsert =
    editor !== undefined && isTypeScriptLanguageId(editor.document.languageId);
  const items = [
    {
      label: copy,
      description: 'Copy generated TypeScript to the clipboard',
    },
    {
      label: preview,
      description: 'Open generated types in an untitled editor (not saved)',
    },
    ...(canInsert
      ? [
          {
            label: insert,
            description: 'Append generated types to the current file',
          },
        ]
      : []),
    {
      label: createFile,
      description: 'Choose a type name and save a .ts file',
    },
  ];
  const choice = await window.showQuickPick(items, {
    title: 'Generate TypeScript',
    placeHolder:
      'Types are inferred from one observed response — not a complete API schema',
  });
  if (choice === undefined) {
    return;
  }
  if (choice.label === copy) {
    await env.clipboard.writeText(input.code);
    window.setStatusBarMessage('TypeScript copied to clipboard', 2_000);
    return;
  }
  if (choice.label === preview) {
    const document = await workspace.openTextDocument({
      language: 'typescript',
      content: input.code,
    });
    await window.showTextDocument(document, { preview: true });
    return;
  }

  const named = await promptGeneratedRootName(input);
  if (named === undefined) {
    return;
  }

  if (choice.label === insert) {
    await insertGeneratedTypes(named.code, named.declarationNames);
    return;
  }

  const suggestedName =
    named.rootName === input.rootName
      ? input.suggestedFileName
      : `${toKebabFileStem(named.rootName)}.ts`;

  const workspaceFolder = workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = workspaceFolder === undefined
    ? Uri.file(suggestedName)
    : Uri.joinPath(workspaceFolder, suggestedName);
  const uri = await window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create TypeScript',
    filters: { TypeScript: ['ts'] },
  });
  if (uri === undefined) {
    return;
  }

  let exists: boolean;
  try {
    await workspace.fs.stat(uri);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    const overwrite = await window.showWarningMessage(
      `"${uri.fsPath}" already exists. Overwrite?`,
      { modal: true },
      'Overwrite',
    );
    if (overwrite !== 'Overwrite') {
      return;
    }
  }

  await workspace.fs.writeFile(uri, Buffer.from(named.code, 'utf8'));
  window.setStatusBarMessage(`TypeScript saved to ${uri.fsPath}`, 3_000);
  const openFile = 'Open';
  const opened = await window.showInformationMessage(
    `Created ${uri.fsPath}`,
    openFile,
  );
  if (opened === openFile) {
    const document = await workspace.openTextDocument(uri);
    await window.showTextDocument(document, { preview: false });
  }
}

async function promptGeneratedRootName(input: {
  readonly code: string;
  readonly rootName: string;
  readonly declarationNames: readonly string[];
  readonly regenerate: (rootName: string) => {
    readonly code: string;
    readonly declarationNames: readonly string[];
  };
}): Promise<
  | {
      readonly rootName: string;
      readonly code: string;
      readonly declarationNames: readonly string[];
    }
  | undefined
> {
  const nameInput = await window.showInputBox({
    title: 'Generate TypeScript — type name',
    prompt: 'Root interface or type name',
    value: input.rootName,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Type name is required.';
      }
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(trimmed)) {
        return 'Enter a valid TypeScript identifier (e.g. User or ApiResponse).';
      }
      return undefined;
    },
  });
  if (nameInput === undefined) {
    return undefined;
  }
  const rootName = sanitizeTypeName(nameInput.trim());
  if (rootName === input.rootName) {
    return {
      rootName,
      code: input.code,
      declarationNames: input.declarationNames,
    };
  }
  const regenerated = input.regenerate(rootName);
  return {
    rootName,
    code: regenerated.code,
    declarationNames: regenerated.declarationNames,
  };
}

async function insertGeneratedTypes(
  code: string,
  declarationNames: readonly string[],
): Promise<void> {
  const editor = window.activeTextEditor;
  if (editor === undefined || !isTypeScriptLanguageId(editor.document.languageId)) {
    await window.showInformationMessage(
      'Insert into editor is available in TypeScript files.',
    );
    return;
  }
  const collisions = collidingGeneratedTypeNames(
    declarationNames,
    editor.document.getText(),
  );
  if (collisions.length > 0) {
    const proceed = await window.showWarningMessage(
      `These types already exist in the current file: ${collisions.join(', ')}. Insert anyway?`,
      { modal: true },
      'Insert',
    );
    if (proceed !== 'Insert') {
      return;
    }
  }
  const next = prepareGeneratedTypeInsertion(editor.document.getText(), code);
  const edit = new WorkspaceEdit();
  const fullRange = new Range(
    new Position(0, 0),
    editor.document.lineAt(editor.document.lineCount - 1).range.end,
  );
  edit.replace(editor.document.uri, fullRange, next);
  const applied = await workspace.applyEdit(edit);
  if (!applied) {
    await window.showErrorMessage('API Hero could not insert the generated types.');
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
