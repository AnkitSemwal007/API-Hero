import {
  languages,
  workspace,
  type Disposable,
  type ExtensionContext,
  type TextDocument,
} from 'vscode';

import {
  registerCommandWithLegacyAlias,
  type MappedRunRequestSource,
} from '../../commands';
import type { CollectionDiscoveryService } from '../../collections';
import { COMMAND_IDS } from '../../constants';
import { API_LANGUAGE_ID } from '../../language-support/constants';
import type { Logger } from '../../shared';
import {
  catalogFromWorkspace,
  type CatalogDocumentOverlay,
  type CatalogRequest,
  type SourceIntegrationCatalog,
} from '../index';
import {
  openMappedApiDefinition,
  openMappedRelatedSource,
  resolveMappedRequest,
} from './commands';
import { SOURCE_LANGUAGE_IDS } from '../languages';
import { resolveSourceRun as resolveSourceRunRequest } from './resolve-source-run';
import { SourceIntegrationCodeLensProvider } from './source-code-lens-provider';
import { SourceIntegrationHoverProvider } from './source-hover-provider';

export interface RegisterSourceIntegrationOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
}

/**
 * Registers VS Code CodeLens, hover, and navigation for explicit source ↔ `.api`
 * mappings, plus Quick Run from a detectable `fetch("https://...")` call.
 * Does not scan the workspace on activation.
 */
export function registerSourceIntegration(
  options: RegisterSourceIntegrationOptions,
): SourceIntegrationRegistration {
  const { discovery, logger } = options;
  let catalog = catalogFromWorkspace(discovery.snapshot);
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  const getWorkspaceRoots = (): readonly string[] =>
    (workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString());
  const getCatalog = (): SourceIntegrationCatalog => catalog;

  const rebuildCatalog = (): void => {
    catalog = catalogFromWorkspace(discovery.snapshot, collectOpenApiOverlays());
    codeLensProvider.refresh();
  };
  const scheduleRebuild = (): void => {
    if (rebuildTimer !== undefined) {
      clearTimeout(rebuildTimer);
    }
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      rebuildCatalog();
    }, 250);
  };

  const codeLensProvider = new SourceIntegrationCodeLensProvider(
    getCatalog,
    getWorkspaceRoots,
  );
  const hoverProvider = new SourceIntegrationHoverProvider(
    getCatalog,
    getWorkspaceRoots,
  );

  const selector = [
    { language: API_LANGUAGE_ID },
    ...[...SOURCE_LANGUAGE_IDS].map((language) => ({ language })),
  ];

  const disposables: Disposable[] = [
    languages.registerCodeLensProvider(selector, codeLensProvider),
    languages.registerHoverProvider(
      [...SOURCE_LANGUAGE_IDS].map((language) => ({ language })),
      hoverProvider,
    ),
    discovery.onDidChange(() => {
      rebuildCatalog();
    }),
    workspace.onDidOpenTextDocument((document) => {
      if (isApiTextDocument(document)) {
        rebuildCatalog();
      }
    }),
    workspace.onDidChangeTextDocument((event) => {
      if (isApiTextDocument(event.document)) {
        scheduleRebuild();
      }
    }),
    workspace.onDidCloseTextDocument((document) => {
      if (isApiTextDocument(document)) {
        rebuildCatalog();
      }
    }),
    workspace.onDidRenameFiles(() => {
      rebuildCatalog();
    }),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.openApiDefinition,
      async (argument: unknown) => {
        await openMappedApiDefinition(
          getCatalog(),
          getWorkspaceRoots(),
          argument,
        );
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.openRelatedSource,
      async (argument: unknown) => {
        await openMappedRelatedSource(
          getCatalog(),
          getWorkspaceRoots(),
          argument,
        );
      },
    ),
    {
      dispose: () => {
        if (rebuildTimer !== undefined) {
          clearTimeout(rebuildTimer);
        }
      },
    },
  ];

  rebuildCatalog();

  options.context.subscriptions.push(...disposables);
  logger.debug('Registered source integration providers');

  return {
    disposables,
    resolveMappedRun: async (suppliedArgument: unknown) =>
      resolveMappedRequest(
        getCatalog(),
        getWorkspaceRoots(),
        suppliedArgument,
      ),
    resolveSourceRun: async (suppliedArgument: unknown) =>
      resolveSourceRunRequest(getCatalog(), getWorkspaceRoots(), suppliedArgument),
  };
}

export interface SourceIntegrationRegistration {
  readonly disposables: readonly Disposable[];
  readonly resolveMappedRun: (
    suppliedArgument: unknown,
  ) => Promise<CatalogRequest | undefined>;
  readonly resolveSourceRun: (
    suppliedArgument: unknown,
  ) => Promise<MappedRunRequestSource | undefined>;
}

function collectOpenApiOverlays(): readonly CatalogDocumentOverlay[] {
  const folders = workspace.workspaceFolders ?? [];
  const overlays: CatalogDocumentOverlay[] = [];
  for (const document of workspace.textDocuments) {
    if (!isApiTextDocument(document) || document.isClosed) {
      continue;
    }
    const folder = workspace.getWorkspaceFolder(document.uri);
    const workspaceRootPath =
      folder?.uri.toString() ?? folders[0]?.uri.toString() ?? document.uri.toString();
    const relativePath = folder === undefined
      ? document.uri.path.replace(/^\/+/u, '')
      : workspace.asRelativePath(document.uri, false);
    overlays.push({
      filePath: document.uri.toString(),
      workspaceRootPath,
      relativePath,
      text: document.getText(),
    });
  }
  return overlays;
}

function isApiTextDocument(document: TextDocument): boolean {
  return (
    document.languageId === API_LANGUAGE_ID ||
    document.uri.path.toLowerCase().endsWith('.api')
  );
}
