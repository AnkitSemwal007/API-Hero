/**
 * Registers the Custom Text Editor and related commands for `.api` request editing.
 */

import {
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type TextDocument,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { ExecutionOrchestrator } from '../../orchestration';
import type { RequestSourceDocument } from '../../request-source';
import type { VariableDefinition } from '../../models';
import type { DefaultVariableResolver } from '../../variables';
import { REQUEST_EDITOR_VIEW_TYPE } from './constants';
import {
  openRequestEditor,
  RequestEditorProvider,
} from './request-editor-provider';
import type { RequestEditorAuthProfileOption } from './request-editor-messages';

export interface RegisterRequestEditorOptions {
  readonly context: ExtensionContext;
  readonly orchestrator: ExecutionOrchestrator;
  readonly getAuthProfiles: () => readonly RequestEditorAuthProfileOption[];
  readonly variableResolver: DefaultVariableResolver;
  readonly getExternalVariableDefinitions: () => readonly VariableDefinition[];
}

export interface RequestEditorRegistration {
  readonly viewType: typeof REQUEST_EDITOR_VIEW_TYPE;
  readonly disposables: readonly Disposable[];
}

/** Wires the request editor into the extension host. */
export function registerRequestEditor(
  options: RegisterRequestEditorOptions,
): RequestEditorRegistration {
  const { context, orchestrator } = options;

  const provider = new RequestEditorProvider({
    getAuthProfiles: options.getAuthProfiles,
    getVariablePreview: (model) =>
      buildVariablePreview(
        options.variableResolver,
        options.getExternalVariableDefinitions(),
        model,
      ),
    runDocument: (document) => runRequestDocument(orchestrator, document),
  });

  const disposables: Disposable[] = [
    window.registerCustomEditorProvider(REQUEST_EDITOR_VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
    commands.registerCommand(COMMAND_IDS.openRequestEditor, async () => {
      const active = window.activeTextEditor?.document;
      const document =
        active?.languageId === 'api'
          ? active
          : await pickApiDocument();
      if (document === undefined) {
        void window.showInformationMessage(
          'Open an API Hero (.api) file to use the Request Editor.',
        );
        return;
      }
      await openRequestEditor(document.uri);
    }),
  ];

  context.subscriptions.push(...disposables);
  return { viewType: REQUEST_EDITOR_VIEW_TYPE, disposables };
}

async function runRequestDocument(
  orchestrator: ExecutionOrchestrator,
  document: TextDocument,
): Promise<void> {
  await orchestrator.runAtPosition({
    text: document.getText(),
    sourceId: document.uri.toString(),
    offset: 0,
  });
}

function buildVariablePreview(
  resolver: DefaultVariableResolver,
  external: readonly VariableDefinition[],
  model: RequestSourceDocument,
): Readonly<Record<string, string>> {
  const definitions: VariableDefinition[] = [
    ...external,
    ...(model.variables ?? []).map((variable) => ({
      name: variable.name,
      value: variable.value,
      scope: 'document' as const,
      sensitive: variable.sensitive === true,
    })),
  ];
  const analysis = resolver.analyze({ definitions });
  const preview: Record<string, string> = {};
  for (const [name, value] of analysis.values) {
    preview[name] = value.sensitive ? '••••••••' : value.value;
  }
  for (const error of analysis.errors) {
    if (preview[error.variableName] === undefined) {
      preview[error.variableName] = `(${error.code})`;
    }
  }
  return preview;
}

async function pickApiDocument(): Promise<TextDocument | undefined> {
  const open = workspace.textDocuments.filter(
    (document) => document.languageId === 'api',
  );
  if (open.length === 1) {
    return open[0];
  }
  if (open.length === 0) {
    return undefined;
  }
  const picked = await window.showQuickPick(
    open.map((document) => ({
      label: document.fileName,
      document,
    })),
    { placeHolder: 'Select an .api file' },
  );
  return picked?.document;
}
