import type {
  Collection,
  Folder,
  RequestReference,
  WorkspaceCollections,
  WorkspaceRoot,
} from './models';

export type CollectionTreeNodeKind =
  | 'workspace'
  | 'collection'
  | 'folder'
  | 'request';

/**
 * Framework-neutral tree projection used by the VS Code TreeDataProvider and
 * by unit tests. Children are resolved lazily via {@link getTreeChildren}.
 */
export interface CollectionTreeNode {
  readonly id: string;
  readonly kind: CollectionTreeNodeKind;
  readonly label: string;
  readonly description?: string;
  readonly collapsible: boolean;
  /** Present for request nodes — used by open/reveal commands. */
  readonly requestId?: string;
  readonly collectionId?: string;
  readonly workspaceRootId?: string;
  readonly folderId?: string;
}

/** Top-level tree roots for the collections explorer. */
export function getTreeRoots(
  aggregate: WorkspaceCollections,
): readonly CollectionTreeNode[] {
  return aggregate.workspaceRoots.map((root) => projectWorkspace(root));
}

/**
 * Children of a projected node. Returns an empty list for unknown or leaf
 * nodes so expand never throws.
 */
export function getTreeChildren(
  aggregate: WorkspaceCollections,
  parent: CollectionTreeNode | undefined,
): readonly CollectionTreeNode[] {
  if (parent === undefined) {
    return getTreeRoots(aggregate);
  }

  switch (parent.kind) {
    case 'workspace': {
      const root = aggregate.workspaceRoots.find((item) => item.id === parent.id);
      if (root === undefined) {
        return [];
      }
      return root.collectionIds
        .map((id) => aggregate.collections[id])
        .filter((collection): collection is Collection => collection !== undefined)
        .map((collection) => projectCollection(collection));
    }
    case 'collection': {
      const collection = aggregate.collections[parent.id];
      if (collection === undefined) {
        return [];
      }
      return [
        ...collection.rootFolderIds
          .map((id) => collection.folders[id])
          .filter((folder): folder is Folder => folder !== undefined)
          .map((folder) => projectFolder(folder)),
        ...collection.rootRequestIds
          .map((id) => collection.requests[id])
          .filter((request): request is RequestReference => request !== undefined)
          .map((request) => projectRequest(request)),
      ];
    }
    case 'folder': {
      if (parent.collectionId === undefined || parent.folderId === undefined) {
        return [];
      }
      const collection = aggregate.collections[parent.collectionId];
      const folder = collection?.folders[parent.folderId];
      if (collection === undefined || folder === undefined) {
        return [];
      }
      return [
        ...folder.folderIds
          .map((id) => collection.folders[id])
          .filter((child): child is Folder => child !== undefined)
          .map((child) => projectFolder(child)),
        ...folder.requestIds
          .map((id) => collection.requests[id])
          .filter((request): request is RequestReference => request !== undefined)
          .map((request) => projectRequest(request)),
      ];
    }
    case 'request':
      return [];
    default:
      return [];
  }
}

function projectWorkspace(root: WorkspaceRoot): CollectionTreeNode {
  return {
    id: root.id,
    kind: 'workspace',
    label: root.display.label,
    description: root.display.description,
    collapsible: true,
    workspaceRootId: root.id,
  };
}

function projectCollection(collection: Collection): CollectionTreeNode {
  return {
    id: collection.id,
    kind: 'collection',
    label: collection.display.label,
    description: collection.metadata.requestCount === 1
      ? '1 request'
      : `${collection.metadata.requestCount} requests`,
    collapsible:
      collection.rootFolderIds.length > 0 || collection.rootRequestIds.length > 0,
    collectionId: collection.id,
  };
}

function projectFolder(folder: Folder): CollectionTreeNode {
  return {
    id: folder.id,
    kind: 'folder',
    label: folder.display.label,
    description: folder.relativePath,
    collapsible: folder.folderIds.length > 0 || folder.requestIds.length > 0,
    collectionId: folder.collectionId,
    folderId: folder.id,
  };
}

function projectRequest(request: RequestReference): CollectionTreeNode {
  return {
    id: request.id,
    kind: 'request',
    label: request.display.label,
    description: request.display.description,
    collapsible: false,
    requestId: request.id,
    collectionId: request.collectionId,
    folderId: request.folderId,
  };
}

/** Locates a projected request node by request id, walking the tree. */
export function findTreeNodeByRequestId(
  aggregate: WorkspaceCollections,
  requestId: string,
): CollectionTreeNode | undefined {
  const walk = (
    parent: CollectionTreeNode | undefined,
  ): CollectionTreeNode | undefined => {
    for (const child of getTreeChildren(aggregate, parent)) {
      if (child.kind === 'request' && child.requestId === requestId) {
        return child;
      }
      if (child.collapsible) {
        const nested = walk(child);
        if (nested !== undefined) {
          return nested;
        }
      }
    }
    return undefined;
  };
  return walk(undefined);
}

/** Ancestor chain from root to the request node (inclusive), for reveal. */
export function treePathToRequest(
  aggregate: WorkspaceCollections,
  requestId: string,
): readonly CollectionTreeNode[] {
  const path: CollectionTreeNode[] = [];

  const walk = (parent: CollectionTreeNode | undefined): boolean => {
    for (const child of getTreeChildren(aggregate, parent)) {
      path.push(child);
      if (child.kind === 'request' && child.requestId === requestId) {
        return true;
      }
      if (child.collapsible && walk(child)) {
        return true;
      }
      path.pop();
    }
    return false;
  };

  return walk(undefined) ? [...path] : [];
}
