import type {
  Collection,
  Folder,
  RequestReference,
  WorkspaceCollections,
} from './models';

export type CollectionTreeNodeKind =
  | 'workspace'
  | 'collection'
  | 'folder'
  | 'request'
  /** Non-interactive tree message (e.g. filter empty). */
  | 'info';

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
  /** HTTP method for request nodes (e.g. GET), used for description/icons. */
  readonly method?: string;
}

/**
 * Top-level tree roots for the collections explorer.
 *
 * Collections are roots (native `Collections/<Name>/` plus optional Legacy).
 * Workspace nodes are not shown; multi-root workspaces qualify collection
 * descriptions with the workspace folder name when more than one root exists.
 */
export function getTreeRoots(
  aggregate: WorkspaceCollections,
): readonly CollectionTreeNode[] {
  const multiRoot = aggregate.workspaceRoots.length > 1;
  const nodes: CollectionTreeNode[] = [];
  for (const root of aggregate.workspaceRoots) {
    for (const id of root.collectionIds) {
      const collection = aggregate.collections[id];
      if (collection === undefined) {
        continue;
      }
      nodes.push(
        projectCollection(
          collection,
          multiRoot ? root.display.label : undefined,
        ),
      );
    }
  }
  return nodes;
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

/**
 * Children of a projected node, optionally filtered by a free-text query.
 * Ancestors of matches remain visible so the tree stays navigable.
 */
export function getFilteredTreeChildren(
  aggregate: WorkspaceCollections,
  parent: CollectionTreeNode | undefined,
  query: string | undefined,
): readonly CollectionTreeNode[] {
  const children = getTreeChildren(aggregate, parent);
  const normalized = normalizeFilterQuery(query);
  if (normalized === undefined) {
    return children;
  }
  return children.filter(
    (child) =>
      nodeMatchesFilter(child, normalized) ||
      (child.collapsible && hasMatchingDescendant(aggregate, child, normalized)),
  );
}

/** Case-insensitive match against label, description, method, and request id. */
export function nodeMatchesFilter(
  node: CollectionTreeNode,
  normalizedQuery: string,
): boolean {
  const haystacks = [
    node.label,
    node.description,
    node.method,
    node.requestId,
  ];
  return haystacks.some(
    (value) =>
      value !== undefined && value.toLowerCase().includes(normalizedQuery),
  );
}

/** Trims and lowercases a filter query; empty becomes undefined. */
export function normalizeFilterQuery(
  query: string | undefined,
): string | undefined {
  if (query === undefined) {
    return undefined;
  }
  const trimmed = query.trim().toLowerCase();
  return trimmed.length === 0 ? undefined : trimmed;
}

function hasMatchingDescendant(
  aggregate: WorkspaceCollections,
  parent: CollectionTreeNode,
  normalizedQuery: string,
): boolean {
  for (const child of getTreeChildren(aggregate, parent)) {
    if (nodeMatchesFilter(child, normalizedQuery)) {
      return true;
    }
    if (child.collapsible && hasMatchingDescendant(aggregate, child, normalizedQuery)) {
      return true;
    }
  }
  return false;
}

function projectCollection(
  collection: Collection,
  workspaceLabel?: string,
): CollectionTreeNode {
  const requestDescription =
    collection.metadata.requestCount === 1
      ? '1 request'
      : `${collection.metadata.requestCount} requests`;
  const kindSuffix = collection.kind === 'legacy' ? ' · Legacy' : '';
  const baseDescription = `${requestDescription}${kindSuffix}`;
  return {
    id: collection.id,
    kind: 'collection',
    label: collection.display.label,
    description:
      workspaceLabel !== undefined
        ? `${baseDescription} · ${workspaceLabel}`
        : baseDescription,
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
  const method = request.method.trim().toUpperCase();
  const path = request.url.trim();
  return {
    id: request.id,
    kind: 'request',
    label: request.display.label,
    description: formatRequestDescription(method, path),
    collapsible: false,
    requestId: request.id,
    collectionId: request.collectionId,
    folderId: request.folderId,
    method,
  };
}

/** Formats a request tree description as `GET · /path`. */
export function formatRequestDescription(method: string, url: string): string {
  const normalizedMethod = method.trim().toUpperCase();
  const path = url.trim();
  if (normalizedMethod.length === 0) {
    return path;
  }
  return path.length > 0 ? `${normalizedMethod} · ${path}` : normalizedMethod;
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

/** True when the drop target belongs to a Legacy collection. */
export function isLegacyTreeTarget(
  aggregate: WorkspaceCollections,
  target: CollectionTreeNode,
): boolean {
  if (target.kind === 'collection' && target.collectionId !== undefined) {
    return aggregate.collections[target.collectionId]?.kind === 'legacy';
  }
  if (
    (target.kind === 'folder' || target.kind === 'request') &&
    target.collectionId !== undefined
  ) {
    return aggregate.collections[target.collectionId]?.kind === 'legacy';
  }
  return false;
}

