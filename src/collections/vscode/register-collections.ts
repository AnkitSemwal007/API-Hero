import {
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { COMMAND_IDS, VIEW_IDS } from '../../constants';
import type { Logger } from '../../shared';
import {
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
} from '../index';
import { CollectionTreeDataProvider } from './collection-tree-provider';
import { CollectionNavigationService } from './navigation-service';
import {
  VsCodeApiFileReader,
  VsCodeWorkspaceScanner,
} from './workspace-scanner';

/**
 * Composes collection discovery, tree view, navigation, and commands.
 * Called from `extension.ts` only — keeps activate composition-only.
 */
export function registerCollections(
  context: ExtensionContext,
  logger: Logger,
): CollectionsRegistration {
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: new VsCodeWorkspaceScanner(),
    reader: new VsCodeApiFileReader(),
    repository,
  });
  const treeProvider = new CollectionTreeDataProvider(discovery);
  const treeView = window.createTreeView(VIEW_IDS.collections, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  treeProvider.attachTreeView(treeView);
  const navigation = new CollectionNavigationService(discovery, treeProvider);

  const disposables: Disposable[] = [
    treeView,
    navigation,
    commands.registerCommand(COMMAND_IDS.refreshCollections, async () => {
      logger.debug('Refreshing collections');
      await discovery.refresh();
    }),
    commands.registerCommand(COMMAND_IDS.revealActiveRequest, async () => {
      await navigation.revealActiveRequest();
    }),
    commands.registerCommand(
      COMMAND_IDS.openCollectionRequest,
      async (target: unknown) => {
        if (target === undefined || target === null) {
          await navigation.revealActiveRequest();
          return;
        }
        await navigation.openRequest(
          target as Parameters<CollectionNavigationService['openRequest']>[0],
        );
      },
    ),
    commands.registerCommand(COMMAND_IDS.focusCollections, async () => {
      await commands.executeCommand(`${VIEW_IDS.collections}.focus`);
    }),
    workspace.onDidChangeWorkspaceFolders(() => {
      void discovery.invalidateAll();
    }),
    workspace.onDidCreateFiles((event) => {
      if (event.files.some((uri) => uri.path.toLowerCase().endsWith('.api'))) {
        void discovery.refresh();
      }
    }),
    workspace.onDidDeleteFiles((event) => {
      if (event.files.some((uri) => uri.path.toLowerCase().endsWith('.api'))) {
        void discovery.refresh();
      }
    }),
    workspace.onDidRenameFiles((event) => {
      if (
        event.files.some(
          (item) =>
            item.oldUri.path.toLowerCase().endsWith('.api') ||
            item.newUri.path.toLowerCase().endsWith('.api'),
        )
      ) {
        void discovery.refresh();
      }
    }),
    workspace.onDidSaveTextDocument((document) => {
      if (
        document.languageId === 'api' ||
        document.uri.path.toLowerCase().endsWith('.api')
      ) {
        void discovery.invalidateFile(document.uri.toString());
      }
    }),
  ];

  void discovery.refresh().then(
    () => logger.info('Collections discovered'),
    (error: unknown) => {
      logger.warning('Collections discovery failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );

  context.subscriptions.push(...disposables);
  return { disposables, discovery, treeView };
}

/** Services returned by {@link registerCollections} for composition. */
export interface CollectionsRegistration {
  readonly disposables: readonly Disposable[];
  readonly discovery: CollectionDiscoveryService;
  readonly treeView: import('vscode').TreeView<
    import('../tree-projection').CollectionTreeNode
  >;
}
