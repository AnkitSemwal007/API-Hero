import {
  EventEmitter,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  type Event,
  type TreeDataProvider,
  type TreeView,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { CollectionDiscoveryService } from '../discovery';
import type { CollectionTreeNode, WorkspaceCollections } from '../index';
import {
  findTreeNodeByRequestId,
  getFilteredTreeChildren,
  normalizeFilterQuery,
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
  private filterQuery: string | undefined;

  public constructor(
    private readonly discovery: CollectionDiscoveryService,
  ) {
    discovery.onDidChange(() => {
      this.changeEmitter.fire(undefined);
    });
  }

  public attachTreeView(treeView: TreeView<CollectionTreeNode>): void {
    this.treeView = treeView;
    this.updateFilterMessage();
  }

  public setFilterQuery(query: string | undefined): void {
    this.filterQuery = normalizeFilterQuery(query);
    this.updateFilterMessage();
    this.changeEmitter.fire(undefined);
  }

  public getFilterQuery(): string | undefined {
    return this.filterQuery;
  }

  private updateFilterMessage(): void {
    const view = this.treeView;
    if (view === undefined) {
      return;
    }
    view.message =
      this.filterQuery !== undefined
        ? `Filtered · ${this.filterQuery}`
        : undefined;
  }

  public getTreeItem(element: CollectionTreeNode): TreeItem {
    const aggregate = this.discovery.snapshot;
    const item = new TreeItem(
      element.label,
      element.collapsible
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.description = element.description;
    item.iconPath = iconFor(element);
    item.contextValue = contextValueFor(element, aggregate);
    item.tooltip = tooltipFor(element, aggregate);
    item.resourceUri = resourceUriFor(element, aggregate);
    item.accessibilityInformation = {
      label: accessibilityLabelFor(element),
    };
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
    const children = [
      ...getFilteredTreeChildren(aggregate, element, this.filterQuery),
    ];
    // Avoid viewsWelcome false empty when a filter matches nothing.
    if (
      element === undefined &&
      this.filterQuery !== undefined &&
      children.length === 0 &&
      Object.keys(aggregate.collections).length > 0
    ) {
      return [
        {
          id: '__filter_empty__',
          kind: 'info',
          label: 'No matching items',
          description: 'Clear filter to show all collections',
          collapsible: false,
        },
      ];
    }
    return children;
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
    // Collections are tree roots (Phase 1a); workspace nodes are not projected.
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

function tooltipFor(
  element: CollectionTreeNode,
  aggregate: WorkspaceCollections | undefined,
): string {
  if (element.kind === 'collection') {
    const collection = aggregate?.collections[element.id];
    const lines = [element.label];
    if (element.description !== undefined && element.description.length > 0) {
      lines.push(element.description);
    }
    if (collection?.metadata.defaultAuthenticationId) {
      lines.push(
        `Default Authentication: ${collection.metadata.defaultAuthenticationId}`,
      );
    }
    if (collection?.metadata.workspacePath) {
      lines.push(collection.metadata.workspacePath);
    }
    if (collection?.kind === 'legacy') {
      lines.push('Legacy files outside Collections/');
    }
    return lines.join('\n');
  }
  if (element.kind === 'folder') {
    const lines = [element.label];
    if (element.description !== undefined && element.description.length > 0) {
      lines.push(element.description);
    }
    const collection =
      element.collectionId !== undefined
        ? aggregate?.collections[element.collectionId]
        : undefined;
    const folder =
      collection !== undefined && element.folderId !== undefined
        ? collection.folders[element.folderId]
        : undefined;
    if (folder !== undefined && folder.relativePath.length > 0) {
      lines.push(folder.relativePath);
    }
    return lines.join('\n');
  }
  if (element.kind === 'request') {
    const lines = [element.label];
    if (element.description !== undefined && element.description.length > 0) {
      lines.push(element.description);
    }
    return lines.join('\n');
  }
  if (element.kind === 'info') {
    return element.description !== undefined
      ? `${element.label}\n${element.description}`
      : element.label;
  }
  return element.label;
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
      return iconForMethod(element.method);
    case 'info':
      return new ThemeIcon('search');
    default:
      return new ThemeIcon('circle-outline');
  }
}

/**
 * Prefer hierarchy-friendly ThemeIcons. Method variants use distinct Codicons
 * with subtle charts ThemeColors when available.
 */
function iconForMethod(method: string | undefined): ThemeIcon {
  const normalized = (method ?? '').trim().toUpperCase();
  switch (normalized) {
    case 'GET':
      return new ThemeIcon('arrow-down', new ThemeColor('charts.blue'));
    case 'POST':
      return new ThemeIcon('add', new ThemeColor('charts.green'));
    case 'PUT':
      return new ThemeIcon('edit', new ThemeColor('charts.orange'));
    case 'PATCH':
      return new ThemeIcon('edit', new ThemeColor('charts.purple'));
    case 'DELETE':
      return new ThemeIcon('trash', new ThemeColor('charts.red'));
    case 'HEAD':
    case 'OPTIONS':
      return new ThemeIcon('info', new ThemeColor('descriptionForeground'));
    default:
      return new ThemeIcon('symbol-method');
  }
}

function contextValueFor(
  element: CollectionTreeNode,
  aggregate: WorkspaceCollections | undefined,
): string {
  if (element.kind === 'info') {
    return 'info';
  }
  if (element.kind === 'collection') {
    const collection = aggregate?.collections[element.id];
    return collection?.kind === 'legacy' ? 'collectionLegacy' : 'collection';
  }
  if (element.kind === 'folder') {
    const collection =
      element.collectionId !== undefined
        ? aggregate?.collections[element.collectionId]
        : undefined;
    return collection?.kind === 'legacy' ? 'folderLegacy' : 'folder';
  }
  if (element.kind === 'request') {
    const collection =
      element.collectionId !== undefined
        ? aggregate?.collections[element.collectionId]
        : undefined;
    return collection?.kind === 'legacy' ? 'requestLegacy' : 'request';
  }
  return element.kind;
}

function resourceUriFor(
  element: CollectionTreeNode,
  aggregate: WorkspaceCollections | undefined,
): Uri | undefined {
  if (aggregate === undefined) {
    return undefined;
  }
  if (element.kind === 'collection') {
    const collection = aggregate.collections[element.id];
    if (collection === undefined || collection.kind !== 'native') {
      return undefined;
    }
    return pathToUri(collection.rootPath);
  }
  if (element.kind === 'folder' && element.collectionId !== undefined) {
    const collection = aggregate.collections[element.collectionId];
    const folder =
      collection !== undefined && element.folderId !== undefined
        ? collection.folders[element.folderId]
        : undefined;
    if (collection === undefined || folder === undefined) {
      return undefined;
    }
    const relative = folder.relativePath.replace(/\\/g, '/');
    const absolute =
      relative.length === 0
        ? collection.rootPath
        : `${collection.rootPath.replace(/\/+$/, '')}/${relative}`;
    return pathToUri(absolute);
  }
  if (
    element.kind === 'request' &&
    element.collectionId !== undefined &&
    element.requestId !== undefined
  ) {
    const collection = aggregate.collections[element.collectionId];
    const request = collection?.requests[element.requestId];
    if (request === undefined) {
      return undefined;
    }
    return pathToUri(request.filePath);
  }
  return undefined;
}

function accessibilityLabelFor(element: CollectionTreeNode): string {
  switch (element.kind) {
    case 'collection':
      return `Collection ${element.label}`;
    case 'folder':
      return `Folder ${element.label}`;
    case 'request': {
      const method = element.method?.trim();
      return method !== undefined && method.length > 0
        ? `Request ${method} ${element.label}`
        : `Request ${element.label}`;
    }
    case 'info':
      return element.label;
    default:
      return element.label;
  }
}

function pathToUri(path: string): Uri {
  return path.includes('://') ? Uri.parse(path) : Uri.file(path);
}
