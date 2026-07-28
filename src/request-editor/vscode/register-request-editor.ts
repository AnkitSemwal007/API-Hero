/**
 * Registers the Custom Text Editor and related commands for `.api` request editing.
 */

import {
  Uri,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type TextDocument,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands/register-command-with-legacy-alias';
import {
  COMMAND_IDS,
  LEGACY_REQUEST_EDITOR_VIEW_TYPE,
} from '../../constants';
import {
  normalizePathKey,
  type Collection,
  type CollectionDiscoveryService,
  type CollectionMutationService,
  type Folder,
  type RequestReference,
  type WorkspaceCollections,
} from '../../collections';
import type { ExecutionOrchestrator } from '../../orchestration';
import type { RequestSourceDocument } from '../../request-source';
import type { VariableDefinition } from '../../models';
import {
  analyzeCollectionDependencies,
  isProjectionFailure,
  projectVariableDependencies,
  type RequestDependencyAnalysis,
} from '../../dependencies';
import {
  MASKED_VARIABLE_VALUE,
  VARIABLE_SCOPE_UI,
  VariableCompletionService,
  type DefaultVariableResolver,
} from '../../variables';
import { formatVariablePreviewError } from '../format-variable-preview-error';
import { alignCollectionOrderOnDepends } from './align-collection-order-on-depends';
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

/** Workspace Memento key for Q3 unknown-variable suppression (ADR 0003). */
const IGNORED_UNKNOWN_VARIABLES_KEY =
  'apiHero.dependencies.ignoredUnknownVariables';

export interface RegisterRequestEditorOptions {
  readonly context: ExtensionContext;
  readonly orchestrator: ExecutionOrchestrator;
  readonly getAuthProfiles: () => readonly RequestEditorAuthProfileOption[];
  readonly variableResolver: DefaultVariableResolver;
  readonly getExternalVariableDefinitions: () => readonly VariableDefinition[];
  /**
   * Static scope names (env/workspace/collection/global) for Unknown filtering
   * only — must not create dependency edges (Q2).
   */
  readonly getStaticVariableNames?: () => ReadonlySet<string>;
  /** Active environment display name for Variables-tab discoverability. */
  readonly getActiveEnvironmentLabel?: () => string | undefined;
  /** Collections discovery for same-collection Depends-on picker. */
  readonly discovery?: CollectionDiscoveryService;
  /** Mutation service for same-folder requestOrder alignment after depends-on. */
  readonly mutation?: CollectionMutationService;
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
  /** Content-fingerprint analysis cache (RULE 9) — reused across postState. */
  const analysisCache = new Map<string, RequestDependencyAnalysis>();

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
    getVariableDependencyProjection: async (documentUri) =>
      buildVariableDependencyProjection({
        aggregate: options.discovery?.snapshot,
        documentUri,
        analysisCache,
        getStaticVariableNames: options.getStaticVariableNames,
        getIgnoredVariableNames: () =>
          readIgnoredUnknownVariables(context),
        readText: (filePath) => readApiTextPreferOpen(filePath),
      }),
    ignoreUnknownVariable: async (name) => {
      await persistIgnoredUnknownVariable(context, name);
    },
    cascadeDependRefRename: async ({ documentPath, oldName, newName }) =>
      cascadeDependRefRenameOnNameChange({
        aggregate: options.discovery?.snapshot,
        documentPath,
        oldName,
        newName,
      }),
    alignCollectionOrderAfterDependsOn: (() => {
      const mutation = options.mutation;
      if (mutation === undefined) {
        return undefined;
      }
      return async ({
        documentPath,
        previousDependsOn,
        nextDependsOn,
      }: {
        readonly documentPath: string;
        readonly previousDependsOn: readonly string[];
        readonly nextDependsOn: readonly string[];
      }) => {
        await alignCollectionOrderOnDepends({
          aggregate: options.discovery?.snapshot,
          documentPath,
          previousDependsOn,
          nextDependsOn,
          mutation,
          readText: (filePath) => readApiTextPreferOpen(filePath),
          analysisCache,
        });
      };
    })(),
    runDocument: (document) => runRequestDocument(orchestrator, document),
  });

  const editorOptions = {
    webviewOptions: {
      retainContextWhenHidden: true,
    },
    supportsMultipleEditorsPerDocument: false,
  } as const;

  const disposables: Disposable[] = [
    window.registerCustomEditorProvider(
      REQUEST_EDITOR_VIEW_TYPE,
      provider,
      editorOptions,
    ),
    // Legacy alias: priority "option" in package.json; same provider instance.
    window.registerCustomEditorProvider(
      LEGACY_REQUEST_EDITOR_VIEW_TYPE,
      provider,
      editorOptions,
    ),
    registerCommandWithLegacyAlias(COMMAND_IDS.openRequestEditor, async () => {
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

async function buildVariableDependencyProjection(options: {
  readonly aggregate: WorkspaceCollections | undefined;
  readonly documentUri: string;
  readonly analysisCache: Map<string, RequestDependencyAnalysis>;
  readonly getStaticVariableNames?: () => ReadonlySet<string>;
  readonly getIgnoredVariableNames: () => ReadonlySet<string>;
  readonly readText: (filePath: string) => Promise<string>;
}): Promise<
  | {
      readonly autoDependencies: readonly {
        readonly dependRef: string;
        readonly fromRequestId: string;
        readonly variables: readonly string[];
      }[];
      readonly manualDependencies: readonly {
        readonly dependRef: string;
        readonly fromRequestId: string;
      }[];
      readonly unknownVariables: readonly string[];
      readonly ambiguousProducers: readonly {
        readonly variable: string;
        readonly producers: readonly {
          readonly dependRef: string;
          readonly requestId: string;
        }[];
      }[];
      readonly dependencyProjectionError?: {
        readonly code: string;
        readonly message: string;
      };
    }
  | undefined
> {
  const collection = findCollectionForDocumentPath(
    options.aggregate,
    options.documentUri,
  );
  if (collection === undefined) {
    return undefined;
  }

  const focusRequestId = findRequestIdForDocumentPath(
    options.aggregate,
    options.documentUri,
  );
  if (focusRequestId === undefined) {
    return undefined;
  }

  const requests = Object.values(collection.requests);
  const labelByRequestId = new Map<string, string>();
  const folderPathByRequestId = new Map<string, string>();
  for (const request of requests) {
    labelByRequestId.set(request.id, request.display.label);
    folderPathByRequestId.set(request.id, folderPathFor(collection, request));
  }

  const analyses = await analyzeCollectionDependencies({
    requests: requests.map((request) => ({
      requestId: request.id,
      filePath: request.filePath,
      offset: request.range.start.offset,
    })),
    readText: options.readText,
    analysisCache: options.analysisCache,
  });

  const projected = projectVariableDependencies({
    analyses,
    labelByRequestId,
    folderPathByRequestId,
    focusRequestId,
    staticVariableNames: options.getStaticVariableNames?.(),
    ignoredVariableNames: options.getIgnoredVariableNames(),
  });

  if (isProjectionFailure(projected)) {
    return {
      autoDependencies: [],
      manualDependencies: [],
      unknownVariables: [],
      ambiguousProducers: [],
      dependencyProjectionError: {
        code: projected.code,
        message: projected.message,
      },
    };
  }

  return {
    autoDependencies: projected.auto,
    manualDependencies: projected.manual,
    unknownVariables: projected.unknownVariables,
    ambiguousProducers: projected.ambiguousProducers,
  };
}

async function readApiTextPreferOpen(filePath: string): Promise<string> {
  const uri = filePath.includes('://')
    ? Uri.parse(filePath)
    : Uri.file(filePath);
  const open = workspace.textDocuments.find(
    (document) =>
      document.uri.toString() === uri.toString() ||
      normalizePathKey(document.uri.fsPath) === normalizePathKey(uri.fsPath),
  );
  if (open !== undefined) {
    return open.getText();
  }
  const bytes = await workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

function readIgnoredUnknownVariables(
  context: ExtensionContext,
): ReadonlySet<string> {
  const stored = context.workspaceState.get<unknown>(
    IGNORED_UNKNOWN_VARIABLES_KEY,
  );
  if (!Array.isArray(stored)) {
    return new Set();
  }
  return new Set(
    stored.filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    ),
  );
}

async function persistIgnoredUnknownVariable(
  context: ExtensionContext,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  const next = new Set(readIgnoredUnknownVariables(context));
  next.add(trimmed);
  await context.workspaceState.update(
    IGNORED_UNKNOWN_VARIABLES_KEY,
    [...next].sort((left, right) => left.localeCompare(right)),
  );
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

function findCollectionForDocumentPath(
  aggregate: WorkspaceCollections | undefined,
  documentPath: string,
): Collection | undefined {
  if (aggregate === undefined) {
    return undefined;
  }
  for (const collection of Object.values(aggregate.collections)) {
    for (const request of Object.values(collection.requests)) {
      if (pathsMatch(request.filePath, documentPath)) {
        return collection;
      }
    }
  }
  return undefined;
}

function findRequestIdForDocumentPath(
  aggregate: WorkspaceCollections | undefined,
  documentPath: string,
): string | undefined {
  if (aggregate === undefined) {
    return undefined;
  }
  for (const collection of Object.values(aggregate.collections)) {
    for (const request of Object.values(collection.requests)) {
      if (pathsMatch(request.filePath, documentPath)) {
        return request.id;
      }
    }
  }
  return undefined;
}

function pathsMatch(left: string, right: string): boolean {
  if (normalizePathKey(left) === normalizePathKey(right)) {
    return true;
  }
  try {
    const leftFs = left.includes('://') ? Uri.parse(left).fsPath : left;
    const rightFs = right.includes('://') ? Uri.parse(right).fsPath : right;
    return normalizePathKey(leftFs) === normalizePathKey(rightFs);
  } catch {
    return false;
  }
}

function folderPathFor(
  collection: Collection,
  request: RequestReference,
): string {
  if (request.folderId === undefined) {
    return '';
  }
  const folder: Folder | undefined = collection.folders[request.folderId];
  return folder?.relativePath ?? '';
}
