import {
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { COMMAND_IDS, VIEW_IDS } from '../../constants';
import type { Logger } from '../../shared';
import { COLLECTION_MARKER_FILENAME } from '../constants';
import {
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
} from '../index';
import { CollectionMutationService } from '../mutation';
import { CollectionTreeDragAndDropController } from './collection-dnd-controller';
import { CollectionTreeDataProvider } from './collection-tree-provider';
import { VsCodeCollectionFilesystem } from './mutation-filesystem';
import { CollectionNavigationService } from './navigation-service';
import { registerMutationCommands } from './register-mutation-commands';
import {
  VsCodeApiFileReader,
  VsCodeWorkspaceScanner,
} from './workspace-scanner';

/**
 * Composes collection discovery, mutation, tree view, navigation, and commands.
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
  const mutation = new CollectionMutationService({
    filesystem: new VsCodeCollectionFilesystem(),
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });
  const treeProvider = new CollectionTreeDataProvider(discovery);
  const dragAndDropController = new CollectionTreeDragAndDropController(
    discovery,
    mutation,
    logger,
  );
  const treeView = window.createTreeView(VIEW_IDS.collections, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController,
  });
  treeProvider.attachTreeView(treeView);
  const navigation = new CollectionNavigationService(discovery, treeProvider);
  const markerWatcher = workspace.createFileSystemWatcher(
    `**/${COLLECTION_MARKER_FILENAME}`,
  );

  const disposables: Disposable[] = [
    treeView,
    navigation,
    markerWatcher,
    ...registerMutationCommands({
      discovery,
      mutation,
      treeView,
      logger,
    }),
    commands.registerCommand(COMMAND_IDS.refreshCollections, async () => {
      logger.debug('Refreshing collections');
      await discovery.refresh();
    }),
    commands.registerCommand(COMMAND_IDS.filterCollections, async () => {
      const value = await window.showInputBox({
        title: 'Filter Collections',
        prompt: 'Filter by name, method, or path. Clear the box to show all.',
        value: treeProvider.getFilterQuery() ?? '',
        placeHolder: 'GET /users',
      });
      if (value === undefined) {
        return;
      }
      treeProvider.setFilterQuery(value.length === 0 ? undefined : value);
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
      if (
        event.files.some(
          (uri) =>
            uri.path.toLowerCase().endsWith('.api') ||
            uri.path
              .toLowerCase()
              .endsWith(`/${COLLECTION_MARKER_FILENAME.toLowerCase()}`),
        )
      ) {
        void discovery.refresh();
      }
    }),
    workspace.onDidDeleteFiles((event) => {
      if (
        event.files.some(
          (uri) =>
            uri.path.toLowerCase().endsWith('.api') ||
            uri.path
              .toLowerCase()
              .endsWith(`/${COLLECTION_MARKER_FILENAME.toLowerCase()}`),
        )
      ) {
        void discovery.refresh();
      }
    }),
    workspace.onDidRenameFiles((event) => {
      if (
        event.files.some(
          (item) =>
            item.oldUri.path.toLowerCase().endsWith('.api') ||
            item.newUri.path.toLowerCase().endsWith('.api') ||
            item.oldUri.path
              .toLowerCase()
              .endsWith(`/${COLLECTION_MARKER_FILENAME.toLowerCase()}`) ||
            item.newUri.path
              .toLowerCase()
              .endsWith(`/${COLLECTION_MARKER_FILENAME.toLowerCase()}`),
        )
      ) {
        void discovery.refresh();
      }
    }),
    workspace.onDidSaveTextDocument((document) => {
      if (
        document.languageId === 'api' ||
        document.uri.path.toLowerCase().endsWith('.api') ||
        document.uri.path
          .toLowerCase()
          .endsWith(`/${COLLECTION_MARKER_FILENAME.toLowerCase()}`)
      ) {
        void discovery.invalidateFile(document.uri.toString());
      }
    }),
    markerWatcher.onDidCreate(() => {
      void discovery.refresh();
    }),
    markerWatcher.onDidChange((uri) => {
      void discovery.invalidateFile(uri.toString());
    }),
    markerWatcher.onDidDelete(() => {
      void discovery.refresh();
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
  return { disposables, discovery, mutation, treeView };
}

/** Services returned by {@link registerCollections} for composition. */
export interface CollectionsRegistration {
  readonly disposables: readonly Disposable[];
  readonly discovery: CollectionDiscoveryService;
  readonly mutation: CollectionMutationService;
  readonly treeView: import('vscode').TreeView<
    import('../tree-projection').CollectionTreeNode
  >;
}
