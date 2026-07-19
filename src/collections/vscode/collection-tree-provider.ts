import {
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  type Event,
  type TreeDataProvider,
  type TreeView,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { CollectionDiscoveryService } from '../discovery';
import type { CollectionTreeNode, WorkspaceCollections } from '../index';
import {
  findTreeNodeByRequestId,
  getTreeChildren,
  treePathToRequest,
} from '../tree-projection';

/**
 * VS Code tree adapter over the framework-neutral collection projection.
 * Expand calls never rescan the workspace; they read the cached aggregate.
 */
export class CollectionTreeDataProvider
  implements TreeDataProvider<CollectionTreeNode>
{
  private readonly changeEmitter = new EventEmitter<
    CollectionTreeNode | undefined | null | void
  >();

  public readonly onDidChangeTreeData: Event<
    CollectionTreeNode | undefined | null | void
  > = this.changeEmitter.event;

  private treeView: TreeView<CollectionTreeNode> | undefined;

  public constructor(
    private readonly discovery: CollectionDiscoveryService,
  ) {
    discovery.onDidChange(() => {
      this.changeEmitter.fire(undefined);
    });
  }

  public attachTreeView(treeView: TreeView<CollectionTreeNode>): void {
    this.treeView = treeView;
  }

  public getTreeItem(element: CollectionTreeNode): TreeItem {
    const item = new TreeItem(
      element.label,
      element.collapsible
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.description = element.description;
    item.iconPath = iconFor(element);
    item.contextValue = element.kind;
    if (element.kind === 'request' && element.requestId !== undefined) {
      item.command = {
        command: COMMAND_IDS.openCollectionRequest,
        title: 'Open Request',
        arguments: [element],
      };
    }
    return item;
  }

  public getChildren(
    element?: CollectionTreeNode,
  ): CollectionTreeNode[] {
    const aggregate = this.discovery.snapshot;
    if (aggregate === undefined) {
      return [];
    }
    return [...getTreeChildren(aggregate, element)];
  }

  public getParent(
    element: CollectionTreeNode,
  ): CollectionTreeNode | undefined {
    const aggregate = this.discovery.snapshot;
    if (aggregate === undefined) {
      return undefined;
    }
    if (element.kind === 'request' && element.requestId !== undefined) {
      const path = treePathToRequest(aggregate, element.requestId);
      return path.length >= 2 ? path[path.length - 2] : undefined;
    }
    if (element.kind === 'folder' && element.collectionId !== undefined) {
      const collection = aggregate.collections[element.collectionId];
      const folder = collection?.folders[element.id];
      if (collection === undefined || folder === undefined) {
        return undefined;
      }
      if (folder.parentId !== undefined) {
        const parentFolder = collection.folders[folder.parentId];
        if (parentFolder !== undefined) {
          return {
            id: parentFolder.id,
            kind: 'folder',
            label: parentFolder.display.label,
            description: parentFolder.relativePath,
            collapsible: true,
            collectionId: collection.id,
            folderId: parentFolder.id,
          };
        }
      }
      return {
        id: collection.id,
        kind: 'collection',
        label: collection.display.label,
        collapsible: true,
        collectionId: collection.id,
      };
    }
    if (element.kind === 'collection') {
      const root = aggregate.workspaceRoots.find((item) =>
        item.collectionIds.includes(element.id),
      );
      if (root === undefined) {
        return undefined;
      }
      return {
        id: root.id,
        kind: 'workspace',
        label: root.display.label,
        collapsible: true,
        workspaceRootId: root.id,
      };
    }
    return undefined;
  }

  public async revealRequest(requestId: string): Promise<boolean> {
    const aggregate = this.discovery.snapshot;
    const view = this.treeView;
    if (aggregate === undefined || view === undefined) {
      return false;
    }
    const node = findTreeNodeByRequestId(aggregate, requestId);
    if (node === undefined) {
      return false;
    }
    await view.reveal(node, { select: true, focus: false, expand: true });
    return true;
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public get aggregate(): WorkspaceCollections | undefined {
    return this.discovery.snapshot;
  }
}

function iconFor(element: CollectionTreeNode): ThemeIcon {
  switch (element.kind) {
    case 'workspace':
      return new ThemeIcon('root-folder');
    case 'collection':
      return new ThemeIcon('library');
    case 'folder':
      return new ThemeIcon('folder');
    case 'request':
      return new ThemeIcon('symbol-method');
    default:
      return new ThemeIcon('circle-outline');
  }
}
