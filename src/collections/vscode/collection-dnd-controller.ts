/**
 * Tree drag-and-drop controller for Collections view mutations.
 */

import {
  DataTransferItem,
  window,
  type DataTransfer,
  type TreeDragAndDropController,
} from 'vscode';

import type { Logger } from '../../shared';
import type { CollectionDiscoveryService } from '../discovery';
import type { CollectionMutationService } from '../mutation';
import { pathBasename } from '../mutation';
import {
  isLegacyTreeTarget,
  type CollectionTreeNode,
} from '../tree-projection';

export const COLLECTIONS_DND_MIME =
  'application/vnd.code.tree.apiRunner.collections';

const LEGACY_DND_WARNING =
  'Legacy collections do not support drag-and-drop. Move requests into a Collections/ folder first.';

interface DragPayload {
  readonly nodes: readonly SerializedTreeNode[];
}

interface SerializedTreeNode {
  readonly id: string;
  readonly kind: CollectionTreeNode['kind'];
  readonly collectionId?: string;
  readonly folderId?: string;
  readonly requestId?: string;
}

export class CollectionTreeDragAndDropController
  implements TreeDragAndDropController<CollectionTreeNode>
{
  public readonly dragMimeTypes = [COLLECTIONS_DND_MIME];
  public readonly dropMimeTypes = [COLLECTIONS_DND_MIME];

  /** Ensures at most one Legacy warning per drop gesture. */
  private legacyWarnedForDrop = false;

  public constructor(
    private readonly discovery: CollectionDiscoveryService,
    private readonly mutation: CollectionMutationService,
    private readonly logger: Logger,
  ) {}

  public handleDrag(
    source: CollectionTreeNode[],
    dataTransfer: DataTransfer,
  ): void {
    const payload: DragPayload = {
      nodes: source.map((node) => ({
        id: node.id,
        kind: node.kind,
        collectionId: node.collectionId,
        folderId: node.folderId,
        requestId: node.requestId,
      })),
    };
    dataTransfer.set(
      COLLECTIONS_DND_MIME,
      new DataTransferItem(JSON.stringify(payload)),
    );
  }

  public async handleDrop(
    target: CollectionTreeNode | undefined,
    dataTransfer: DataTransfer,
  ): Promise<void> {
    const transferItem = dataTransfer.get(COLLECTIONS_DND_MIME);
    if (transferItem === undefined) {
      return;
    }
    let payload: DragPayload;
    try {
      payload = JSON.parse(String(transferItem.value)) as DragPayload;
    } catch {
      return;
    }
    if (!Array.isArray(payload.nodes) || payload.nodes.length === 0) {
      return;
    }

    this.legacyWarnedForDrop = false;
    try {
      await this.applyDrop(target, payload.nodes);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.warning('Collections drag-and-drop failed', { message });
      throw error;
    }
  }

  private warnLegacyNoOp(): void {
    if (this.legacyWarnedForDrop) {
      return;
    }
    this.legacyWarnedForDrop = true;
    void window.showWarningMessage(LEGACY_DND_WARNING);
  }

  private async applyDrop(
    target: CollectionTreeNode | undefined,
    sources: readonly SerializedTreeNode[],
  ): Promise<void> {
    const aggregate = this.discovery.snapshot;
    if (aggregate === undefined) {
      return;
    }

    // Collection reorder among roots (drop on another collection or empty).
    const collectionSources = sources.filter(
      (node) => node.kind === 'collection',
    );
    if (collectionSources.length > 0) {
      await this.reorderCollections(collectionSources, target);
      return;
    }

    if (target === undefined) {
      return;
    }

    for (const source of sources) {
      if (source.kind === 'folder' && source.collectionId !== undefined) {
        await this.dropFolder(source, target);
      } else if (
        source.kind === 'request' &&
        source.collectionId !== undefined &&
        source.requestId !== undefined
      ) {
        await this.dropRequest(source, target);
      }
    }
  }

  private async reorderCollections(
    sources: readonly SerializedTreeNode[],
    target: CollectionTreeNode | undefined,
  ): Promise<void> {
    const aggregate = this.discovery.snapshot;
    if (aggregate === undefined || sources[0] === undefined) {
      return;
    }
    const dragged = aggregate.collections[sources[0].id];
    if (dragged === undefined) {
      return;
    }
    if (dragged.kind !== 'native') {
      this.warnLegacyNoOp();
      return;
    }

    const workspaceRoot = aggregate.workspaceRoots.find((root) =>
      root.collectionIds.includes(dragged.id),
    );
    if (workspaceRoot === undefined) {
      return;
    }

    const nativeNames = workspaceRoot.collectionIds
      .map((id) => aggregate.collections[id])
      .filter(
        (collection): collection is NonNullable<typeof collection> =>
          collection !== undefined && collection.kind === 'native',
      )
      .map((collection) => pathBasename(collection.rootPath));

    const draggedName = pathBasename(dragged.rootPath);
    const without = nativeNames.filter((name) => name !== draggedName);
    let insertAt = without.length;
    if (target?.kind === 'collection') {
      const targetCollection = aggregate.collections[target.id];
      if (
        targetCollection !== undefined &&
        targetCollection.kind === 'native' &&
        targetCollection.workspaceRootPath === dragged.workspaceRootPath
      ) {
        const targetName = pathBasename(targetCollection.rootPath);
        const index = without.indexOf(targetName);
        if (index >= 0) {
          insertAt = index;
        }
      }
    }
    without.splice(insertAt, 0, draggedName);
    await this.mutation.reorderCollections(
      dragged.workspaceRootPath,
      without,
    );
  }

  private async dropFolder(
    source: SerializedTreeNode,
    target: CollectionTreeNode,
  ): Promise<void> {
    const aggregate = this.discovery.snapshot;
    if (aggregate === undefined || source.collectionId === undefined) {
      return;
    }
    const sourceCollection = aggregate.collections[source.collectionId];
    const folder = sourceCollection?.folders[source.id];
    if (sourceCollection === undefined || folder === undefined) {
      return;
    }
    if (sourceCollection.kind !== 'native') {
      this.warnLegacyNoOp();
      return;
    }

    if (isLegacyTreeTarget(aggregate, target)) {
      this.warnLegacyNoOp();
      return;
    }

    const destination = resolveFolderDropTarget(aggregate, target);
    if (destination === undefined) {
      return;
    }

    // Same parent → reorder siblings.
    if (
      destination.collectionId === source.collectionId &&
      destination.parentRelativePath ===
        (folder.parentId !== undefined
          ? sourceCollection.folders[folder.parentId]?.relativePath ?? ''
          : '')
    ) {
      const parentPath = destination.parentRelativePath;
      const siblingIds =
        parentPath.length === 0
          ? sourceCollection.rootFolderIds
          : sourceCollection.folders[
              Object.values(sourceCollection.folders).find(
                (item) => item.relativePath === parentPath,
              )?.id ?? ''
            ]?.folderIds ?? [];
      const names = siblingIds
        .map((id) => sourceCollection.folders[id]?.display.label)
        .filter((label): label is string => label !== undefined);
      const without = names.filter((name) => name !== folder.display.label);
      const targetFolder =
        target.kind === 'folder'
          ? sourceCollection.folders[target.id]
          : undefined;
      let insertAt = without.length;
      if (targetFolder !== undefined) {
        const index = without.indexOf(targetFolder.display.label);
        if (index >= 0) {
          insertAt = index;
        }
      }
      without.splice(insertAt, 0, folder.display.label);
      await this.mutation.reorderFolders(
        source.collectionId,
        parentPath,
        without,
      );
      return;
    }

    await this.mutation.moveFolder(
      source.collectionId,
      folder.relativePath,
      destination.collectionId,
      destination.parentRelativePath,
    );
  }

  private async dropRequest(
    source: SerializedTreeNode,
    target: CollectionTreeNode,
  ): Promise<void> {
    const aggregate = this.discovery.snapshot;
    if (
      aggregate === undefined ||
      source.collectionId === undefined ||
      source.requestId === undefined
    ) {
      return;
    }
    const sourceCollection = aggregate.collections[source.collectionId];
    const request = sourceCollection?.requests[source.requestId];
    if (sourceCollection === undefined || request === undefined) {
      return;
    }

    if (isLegacyTreeTarget(aggregate, target)) {
      this.warnLegacyNoOp();
      return;
    }

    const destination = resolveFolderDropTarget(aggregate, target);
    if (destination === undefined) {
      return;
    }

    const targetCollection = aggregate.collections[destination.collectionId];
    if (targetCollection === undefined || targetCollection.kind !== 'native') {
      this.warnLegacyNoOp();
      return;
    }

    // Same folder → reorder.
    const sourceFolderPath =
      request.folderId !== undefined
        ? sourceCollection.folders[request.folderId]?.relativePath ?? ''
        : '';
    if (
      destination.collectionId === source.collectionId &&
      destination.parentRelativePath === sourceFolderPath
    ) {
      const siblingIds =
        sourceFolderPath.length === 0
          ? sourceCollection.rootRequestIds
          : sourceCollection.folders[request.folderId ?? '']?.requestIds ?? [];
      const names = uniqueFileNames(siblingIds, sourceCollection);
      const fileName = pathBasename(request.filePath);
      const without = names.filter((name) => name !== fileName);
      let insertAt = without.length;
      if (target.kind === 'request' && target.requestId !== undefined) {
        const targetRequest = sourceCollection.requests[target.requestId];
        if (targetRequest !== undefined) {
          const index = without.indexOf(pathBasename(targetRequest.filePath));
          if (index >= 0) {
            insertAt = index;
          }
        }
      }
      without.splice(insertAt, 0, fileName);
      await this.mutation.reorderRequests(
        source.collectionId,
        sourceFolderPath,
        without,
      );
      return;
    }

    await this.mutation.moveRequest(
      source.collectionId,
      request.filePath,
      destination.collectionId,
      destination.parentRelativePath,
    );
  }
}

function resolveFolderDropTarget(
  aggregate: NonNullable<CollectionDiscoveryService['snapshot']>,
  target: CollectionTreeNode,
): { collectionId: string; parentRelativePath: string } | undefined {
  if (target.kind === 'collection' && target.collectionId !== undefined) {
    const collection = aggregate.collections[target.collectionId];
    if (collection === undefined || collection.kind !== 'native') {
      return undefined;
    }
    return { collectionId: target.collectionId, parentRelativePath: '' };
  }
  if (
    target.kind === 'folder' &&
    target.collectionId !== undefined &&
    target.folderId !== undefined
  ) {
    const collection = aggregate.collections[target.collectionId];
    const folder = collection?.folders[target.folderId];
    if (
      collection === undefined ||
      folder === undefined ||
      collection.kind !== 'native'
    ) {
      return undefined;
    }
    return {
      collectionId: target.collectionId,
      parentRelativePath: folder.relativePath,
    };
  }
  if (
    target.kind === 'request' &&
    target.collectionId !== undefined &&
    target.requestId !== undefined
  ) {
    const collection = aggregate.collections[target.collectionId];
    const request = collection?.requests[target.requestId];
    if (collection === undefined || request === undefined) {
      return undefined;
    }
    if (collection.kind !== 'native') {
      return undefined;
    }
    const parentRelativePath =
      request.folderId !== undefined
        ? collection.folders[request.folderId]?.relativePath ?? ''
        : '';
    return { collectionId: target.collectionId, parentRelativePath };
  }
  return undefined;
}

function uniqueFileNames(
  requestIds: readonly string[],
  collection: NonNullable<
    NonNullable<CollectionDiscoveryService['snapshot']>['collections'][string]
  >,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of requestIds) {
    const request = collection.requests[id];
    if (request === undefined) {
      continue;
    }
    const name = pathBasename(request.filePath);
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
