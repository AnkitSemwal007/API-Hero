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
import {
  normalizePathKey,
  type CollectionDiscoveryService,
  type WorkspaceCollections,
} from '../../collections';
import type { ExecutionOrchestrator } from '../../orchestration';
import type { RequestSourceDocument } from '../../request-source';
import type { VariableDefinition } from '../../models';
import {
  MASKED_VARIABLE_VALUE,
  VARIABLE_SCOPE_UI,
  VariableCompletionService,
  type DefaultVariableResolver,
} from '../../variables';
import { formatVariablePreviewError } from '../format-variable-preview-error';
import { REQUEST_EDITOR_VIEW_TYPE } from './constants';
import { cascadeDependRefRenameOnNameChange } from './cascade-depend-ref-rename';
import { buildRequestEditorDependencyCatalog } from './dependency-catalog';
import {
  openRequestEditor,
  RequestEditorProvider,
} from './request-editor-provider';
import type {
  RequestEditorAuthProfileOption,
  RequestEditorVariableCompletion,
} from './request-editor-messages';

export interface RegisterRequestEditorOptions {
  readonly context: ExtensionContext;
  readonly orchestrator: ExecutionOrchestrator;
  readonly getAuthProfiles: () => readonly RequestEditorAuthProfileOption[];
  readonly variableResolver: DefaultVariableResolver;
  readonly getExternalVariableDefinitions: () => readonly VariableDefinition[];
  /** Active environment display name for Variables-tab discoverability. */
  readonly getActiveEnvironmentLabel?: () => string | undefined;
  /** Collections discovery for same-collection Depends-on picker. */
  readonly discovery?: CollectionDiscoveryService;
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
  const completionService = new VariableCompletionService(options.variableResolver);

  const provider = new RequestEditorProvider({
    getAuthProfiles: options.getAuthProfiles,
    getVariablePreview: (model) =>
      buildVariablePreview(
        options.variableResolver,
        options.getExternalVariableDefinitions(),
        model,
      ),
    getVariableCompletions: (model) =>
      buildVariableCompletions(
        completionService,
        options.getExternalVariableDefinitions(),
        model,
      ),
    getActiveEnvironmentLabel: options.getActiveEnvironmentLabel,
    getDependencyCatalog: (documentPath) => {
      const aggregate = options.discovery?.snapshot;
      const currentRequestId = findRequestIdForDocumentPath(
        aggregate,
        documentPath,
      );
      return buildRequestEditorDependencyCatalog({
        aggregate,
        documentPath,
        ...(currentRequestId !== undefined ? { currentRequestId } : {}),
      });
    },
    cascadeDependRefRename: async ({ documentPath, oldName, newName }) =>
      cascadeDependRefRenameOnNameChange({
        aggregate: options.discovery?.snapshot,
        documentPath,
        oldName,
        newName,
      }),
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

function collectDefinitions(
  external: readonly VariableDefinition[],
  model: RequestSourceDocument,
): VariableDefinition[] {
  return [
    ...external,
    ...(model.variables ?? []).map((variable) => ({
      name: variable.name,
      value: variable.value,
      scope: 'document' as const,
      sensitive: variable.sensitive === true,
    })),
  ];
}

function buildVariablePreview(
  resolver: DefaultVariableResolver,
  external: readonly VariableDefinition[],
  model: RequestSourceDocument,
): Readonly<Record<string, string>> {
  const definitions = collectDefinitions(external, model);
  const analysis = resolver.analyze({ definitions });
  const preview: Record<string, string> = {};
  for (const [name, value] of analysis.values) {
    const scopeLabel = VARIABLE_SCOPE_UI[value.scope].sourceLabel;
    const display = value.sensitive ? MASKED_VARIABLE_VALUE : value.value;
    preview[name] = `${display} · ${scopeLabel} (effective)`;
  }
  for (const error of analysis.errors) {
    if (preview[error.variableName] === undefined) {
      preview[error.variableName] = formatVariablePreviewError(error);
    }
  }
  return preview;
}

function buildVariableCompletions(
  completionService: VariableCompletionService,
  external: readonly VariableDefinition[],
  model: RequestSourceDocument,
): readonly RequestEditorVariableCompletion[] {
  completionService.setDefinitions(collectDefinitions(external, model));
  return completionService.getCompletions('').map((item) => ({
    name: item.name,
    scope: item.scope,
    sourceLabel: item.sourceLabel,
    icon: item.icon,
    sensitive: item.sensitive,
    ...(item.description !== undefined ? { description: item.description } : {}),
    ...(item.valuePreview !== undefined ? { valuePreview: item.valuePreview } : {}),
  }));
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

function findRequestIdForDocumentPath(
  aggregate: WorkspaceCollections | undefined,
  documentPath: string,
): string | undefined {
  if (aggregate === undefined) {
    return undefined;
  }
  const key = normalizePathKey(documentPath);
  for (const collection of Object.values(aggregate.collections)) {
    for (const request of Object.values(collection.requests)) {
      if (normalizePathKey(request.filePath) === key) {
        return request.id;
      }
    }
  }
  return undefined;
}
