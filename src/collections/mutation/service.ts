/**
 * CollectionMutationService — filesystem CRUD for native collections.
 * Discovery stays read-only; callers refresh after every successful mutation.
 */

import {
  MARKER_ROOT_ORDER_KEY,
  normalizeOrderKey,
  normalizeOrderMap,
  parseCollectionMarker,
  removeOrderName,
  renameOrderName,
  serializeCollectionMarker,
  upsertOrderName,
  type MutableCollectionMarker,
} from '../marker';
import {
  collectionIdForRoot,
  normalizeRelativePath,
  type Collection,
  type WorkspaceCollections,
} from '../models';
import {
  serializeRequestDocument,
  type RequestSourceDocument,
} from '../../request-source';
import type { CollectionFilesystem } from './ports';
import {
  collectionExportDestinationPath,
  looksLikeCollectionRoot,
  preferredCollectionDirectoryName,
  resolveCollectionNameCollision,
  type CollectionNameCollisionChoice,
} from '../transfer';
import {
  allocateUniqueName,
  buildPlaceholderRequestSource,
  collectionMarkerPath,
  collectionRootPath,
  joinUnderCollection,
  pathBasename,
  pathDirname,
  sanitizeDirectoryName,
  sanitizeRequestFileName,
  stripApiExtension,
} from './paths';

export interface CollectionMutationOptions {
  readonly filesystem: CollectionFilesystem;
  readonly getSnapshot: () => WorkspaceCollections | undefined;
  /** Called after every successful mutation to refresh discovery. */
  readonly refresh: () => Promise<WorkspaceCollections>;
}

export interface CreateCollectionResult {
  readonly collectionId: string;
  readonly rootPath: string;
}

export interface CreateRequestResult {
  readonly filePath: string;
  readonly fileName: string;
}

export interface ExportCollectionResult {
  readonly exportPath: string;
}

export interface ExportCollectionOptions {
  /** Destination directory name; defaults to the collection folder basename. */
  readonly directoryName?: string;
  /**
   * Collision policy when `<destinationParent>/<name>` already exists.
   * Defaults to `abort` (throws).
   */
  readonly collision?: CollectionNameCollisionChoice;
}

export interface ImportCollectionOptions {
  /** Destination directory name under `Collections/`; derived from source when omitted. */
  readonly directoryName?: string;
  /**
   * Collision policy when `Collections/<name>` already exists.
   * Defaults to `abort` (throws).
   */
  readonly collision?: CollectionNameCollisionChoice;
}

export class CollectionMutationService {
  public constructor(private readonly options: CollectionMutationOptions) {}

  public async createCollection(
    workspaceRootPath: string,
    rawName: string,
  ): Promise<CreateCollectionResult> {
    const name = requireDirectoryName(rawName, 'Collection');
    const rootPath = collectionRootPath(workspaceRootPath, name);
    if (await this.options.filesystem.exists(rootPath)) {
      throw new CollectionMutationError(
        `A collection named "${name}" already exists.`,
      );
    }

    const siblingNames = await this.listNativeCollectionNames(workspaceRootPath);
    const order = siblingNames.length;
    await this.options.filesystem.createDirectory(rootPath);
    await this.writeMarker(rootPath, {
      name,
      description: '',
      order,
      folderOrder: [],
      requestOrder: { [MARKER_ROOT_ORDER_KEY]: [] },
    });
    await this.options.refresh();
    return { collectionId: collectionIdForRoot(rootPath), rootPath };
  }

  public async renameCollection(
    collectionId: string,
    rawNewName: string,
  ): Promise<void> {
    const collection = this.requireNativeCollection(collectionId);
    const newName = requireDirectoryName(rawNewName, 'Collection');
    const oldName = pathBasename(collection.rootPath);
    if (newName === oldName) {
      await this.updateMarker(collection.rootPath, (marker) => {
        marker.name = newName;
      });
      await this.options.refresh();
      return;
    }

    const newRoot = collectionRootPath(collection.workspaceRootPath, newName);
    if (await this.options.filesystem.exists(newRoot)) {
      throw new CollectionMutationError(
        `A collection named "${newName}" already exists.`,
      );
    }

    await this.options.filesystem.rename(collection.rootPath, newRoot);
    await this.updateMarker(newRoot, (marker) => {
      marker.name = newName;
    });
    await this.options.refresh();
  }

  public async deleteCollection(collectionId: string): Promise<void> {
    const collection = this.requireNativeCollection(collectionId);
    await this.options.filesystem.delete(collection.rootPath, {
      recursive: true,
    });
    await this.options.refresh();
  }

  public async duplicateCollection(
    collectionId: string,
    rawNewName?: string,
  ): Promise<CreateCollectionResult> {
    const collection = this.requireNativeCollection(collectionId);
    const existing = await this.listNativeCollectionNames(
      collection.workspaceRootPath,
    );
    const baseName =
      rawNewName !== undefined
        ? requireDirectoryName(rawNewName, 'Collection')
        : `${pathBasename(collection.rootPath)} Copy`;
    const newName = allocateUniqueName(baseName, (candidate) =>
      existing.includes(candidate),
    );
    const newRoot = collectionRootPath(collection.workspaceRootPath, newName);
    await this.options.filesystem.copy(collection.rootPath, newRoot);
    await this.updateMarker(newRoot, (marker) => {
      marker.name = newName;
      marker.order = existing.length;
    });
    await this.options.refresh();
    return { collectionId: collectionIdForRoot(newRoot), rootPath: newRoot };
  }

  /**
   * Copies a native collection tree (including `api-hero.collection.json`)
   * into `<destinationParentPath>/<directoryName>/`. Does not refresh discovery
   * (workspace files are unchanged).
   */
  public async exportCollection(
    collectionId: string,
    destinationParentPath: string,
    options?: ExportCollectionOptions,
  ): Promise<ExportCollectionResult> {
    const collection = this.requireNativeCollection(collectionId);
    const preferred =
      options?.directoryName !== undefined
        ? requireDirectoryName(options.directoryName, 'Collection')
        : pathBasename(collection.rootPath);

    await this.ensureMarker(collection.rootPath, preferred);

    const parent = destinationParentPath.replace(/\/+$/, '');
    if (!(await this.options.filesystem.exists(parent))) {
      await this.options.filesystem.createDirectory(parent);
    }

    const siblingNames = (await this.options.filesystem.readDirectory(parent))
      .filter((entry) => entry.type === 'directory')
      .map((entry) => entry.name);
    const resolved = resolveCollectionNameCollision(
      preferred,
      siblingNames,
      options?.collision ?? 'abort',
    );
    if (resolved === undefined) {
      throw new CollectionMutationError(
        `A folder named "${preferred}" already exists in the export destination.`,
      );
    }

    const exportPath = collectionExportDestinationPath(
      parent,
      resolved.directoryName,
    );
    if (resolved.overwrite) {
      await this.options.filesystem.delete(exportPath, { recursive: true });
    }
    await this.options.filesystem.copy(collection.rootPath, exportPath);
    return { exportPath };
  }

  /**
   * Imports a collection folder into `Collections/<name>/`, ensures a marker,
   * and refreshes discovery.
   */
  public async importCollection(
    workspaceRootPath: string,
    sourceCollectionPath: string,
    options?: ImportCollectionOptions,
  ): Promise<CreateCollectionResult> {
    const source = sourceCollectionPath.replace(/\/+$/, '');
    if (!(await this.options.filesystem.exists(source))) {
      throw new CollectionMutationError(
        'The selected collection folder does not exist.',
      );
    }

    const sourceEntries = await this.options.filesystem.readDirectory(source);
    if (!looksLikeCollectionRoot(sourceEntries.map((entry) => entry.name))) {
      throw new CollectionMutationError(
        'Select a collection folder that contains api-hero.collection.json or .api files.',
      );
    }

    const preferred = await this.resolveImportDirectoryName(source, options);
    const existing = await this.listNativeCollectionNames(workspaceRootPath);
    const resolved = resolveCollectionNameCollision(
      preferred,
      existing,
      options?.collision ?? 'abort',
    );
    if (resolved === undefined) {
      throw new CollectionMutationError(
        `A collection named "${preferred}" already exists.`,
      );
    }

    const newRoot = collectionRootPath(
      workspaceRootPath,
      resolved.directoryName,
    );
    if (resolved.overwrite) {
      await this.options.filesystem.delete(newRoot, { recursive: true });
    }
    await this.options.filesystem.copy(source, newRoot);
    await this.ensureMarker(newRoot, resolved.directoryName);
    await this.updateMarker(newRoot, (marker) => {
      marker.name = resolved.directoryName;
      marker.order = resolved.overwrite
        ? (marker.order ?? existing.indexOf(resolved.directoryName))
        : existing.length;
    });
    await this.options.refresh();
    return { collectionId: collectionIdForRoot(newRoot), rootPath: newRoot };
  }

  private async resolveImportDirectoryName(
    sourceCollectionPath: string,
    options: ImportCollectionOptions | undefined,
  ): Promise<string> {
    if (options?.directoryName !== undefined) {
      return requireDirectoryName(options.directoryName, 'Collection');
    }

    let markerName: string | undefined;
    const markerPath = collectionMarkerPath(sourceCollectionPath);
    if (await this.options.filesystem.exists(markerPath)) {
      try {
        const parsed = parseCollectionMarker(
          await this.options.filesystem.readText(markerPath),
        );
        markerName = parsed?.name;
      } catch {
        // Fall back to the folder basename when the marker is unreadable.
      }
    }

    const preferred = preferredCollectionDirectoryName({
      folderBasename: pathBasename(sourceCollectionPath),
      ...(markerName !== undefined ? { markerName } : {}),
    });
    if (preferred === undefined) {
      throw new CollectionMutationError(
        'Could not derive a valid collection name from the selected folder.',
      );
    }
    return preferred;
  }

  /**
   * Writes numeric `order` on each native collection marker to match
   * `orderedNames` (directory names under `Collections/`).
   */
  public async reorderCollections(
    workspaceRootPath: string,
    orderedNames: readonly string[],
  ): Promise<void> {
    const existing = await this.listNativeCollectionNames(workspaceRootPath);
    const ordered = orderedNames.filter((name) => existing.includes(name));
    const rest = existing.filter((name) => !ordered.includes(name));
    const finalOrder = [...ordered, ...rest];
    for (let index = 0; index < finalOrder.length; index += 1) {
      const name = finalOrder[index]!;
      const root = collectionRootPath(workspaceRootPath, name);
      await this.ensureMarker(root, name);
      await this.updateMarker(root, (marker) => {
        marker.order = index;
      });
    }
    await this.options.refresh();
  }

  public async createFolder(
    collectionId: string,
    parentRelativePath: string,
    rawName: string,
  ): Promise<{ relativePath: string }> {
    const collection = this.requireNativeCollection(collectionId);
    const name = requireDirectoryName(rawName, 'Folder');
    const parent = normalizeRelativePath(parentRelativePath);
    const relativePath =
      parent.length === 0 ? name : `${parent}/${name}`;
    const absolute = joinUnderCollection(collection.rootPath, relativePath);
    if (await this.options.filesystem.exists(absolute)) {
      throw new CollectionMutationError(
        `A folder named "${name}" already exists here.`,
      );
    }
    await this.options.filesystem.createDirectory(absolute);
    await this.updateMarker(collection.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.folderOrder);
      const key = normalizeOrderKey(parent);
      map[key] = upsertOrderName(map[key], name);
      marker.folderOrder = map;
    });
    await this.options.refresh();
    return { relativePath };
  }

  public async renameFolder(
    collectionId: string,
    folderRelativePath: string,
    rawNewName: string,
  ): Promise<void> {
    const collection = this.requireNativeCollection(collectionId);
    const relative = normalizeRelativePath(folderRelativePath);
    if (relative.length === 0) {
      throw new CollectionMutationError('Cannot rename the collection root.');
    }
    const newName = requireDirectoryName(rawNewName, 'Folder');
    const oldName = pathBasename(relative);
    const parent = pathDirname(relative);
    const newRelative =
      parent.length === 0 ? newName : `${parent}/${newName}`;
    if (newRelative === relative) {
      await this.options.refresh();
      return;
    }

    const from = joinUnderCollection(collection.rootPath, relative);
    const to = joinUnderCollection(collection.rootPath, newRelative);
    if (await this.options.filesystem.exists(to)) {
      throw new CollectionMutationError(
        `A folder named "${newName}" already exists here.`,
      );
    }
    await this.options.filesystem.rename(from, to);
    await this.updateMarker(collection.rootPath, (marker) => {
      remapMarkerAfterFolderMove(marker, relative, newRelative);
      const map = normalizeOrderMap(marker.folderOrder);
      const parentKey = normalizeOrderKey(parent);
      map[parentKey] = renameOrderName(map[parentKey], oldName, newName);
      marker.folderOrder = map;
    });
    await this.options.refresh();
  }

  public async deleteFolder(
    collectionId: string,
    folderRelativePath: string,
  ): Promise<void> {
    const collection = this.requireNativeCollection(collectionId);
    const relative = normalizeRelativePath(folderRelativePath);
    if (relative.length === 0) {
      throw new CollectionMutationError('Cannot delete the collection root.');
    }
    const absolute = joinUnderCollection(collection.rootPath, relative);
    await this.options.filesystem.delete(absolute, { recursive: true });
    await this.updateMarker(collection.rootPath, (marker) => {
      removeFolderFromMarker(marker, relative);
    });
    await this.options.refresh();
  }

  public async duplicateFolder(
    collectionId: string,
    folderRelativePath: string,
    rawNewName?: string,
  ): Promise<{ relativePath: string }> {
    const collection = this.requireNativeCollection(collectionId);
    const relative = normalizeRelativePath(folderRelativePath);
    if (relative.length === 0) {
      throw new CollectionMutationError('Cannot duplicate the collection root.');
    }
    const parent = pathDirname(relative);
    const oldName = pathBasename(relative);
    const siblings = await this.listChildDirectoryNames(
      joinUnderCollection(collection.rootPath, parent),
    );
    const baseName =
      rawNewName !== undefined
        ? requireDirectoryName(rawNewName, 'Folder')
        : `${oldName} Copy`;
    const newName = allocateUniqueName(baseName, (candidate) =>
      siblings.includes(candidate),
    );
    const newRelative =
      parent.length === 0 ? newName : `${parent}/${newName}`;
    await this.options.filesystem.copy(
      joinUnderCollection(collection.rootPath, relative),
      joinUnderCollection(collection.rootPath, newRelative),
    );
    await this.updateMarker(collection.rootPath, (marker) => {
      duplicateFolderInMarker(marker, relative, newRelative);
      const map = normalizeOrderMap(marker.folderOrder);
      const parentKey = normalizeOrderKey(parent);
      map[parentKey] = upsertOrderName(map[parentKey], newName);
      marker.folderOrder = map;
    });
    await this.options.refresh();
    return { relativePath: newRelative };
  }

  public async moveFolder(
    sourceCollectionId: string,
    folderRelativePath: string,
    targetCollectionId: string,
    targetParentRelativePath: string,
  ): Promise<{ relativePath: string }> {
    const source = this.requireNativeCollection(sourceCollectionId);
    const target = this.requireNativeCollection(targetCollectionId);
    const relative = normalizeRelativePath(folderRelativePath);
    if (relative.length === 0) {
      throw new CollectionMutationError('Cannot move the collection root.');
    }
    const folderName = pathBasename(relative);
    const targetParent = normalizeRelativePath(targetParentRelativePath);
    const newRelative =
      targetParent.length === 0 ? folderName : `${targetParent}/${folderName}`;

    if (
      source.id === target.id &&
      (newRelative === relative || newRelative.startsWith(`${relative}/`))
    ) {
      throw new CollectionMutationError(
        'Cannot move a folder into itself or a descendant.',
      );
    }

    const from = joinUnderCollection(source.rootPath, relative);
    const to = joinUnderCollection(target.rootPath, newRelative);
    if (await this.options.filesystem.exists(to)) {
      throw new CollectionMutationError(
        `A folder named "${folderName}" already exists at the destination.`,
      );
    }

    if (targetParent.length > 0) {
      await this.options.filesystem.createDirectory(
        joinUnderCollection(target.rootPath, targetParent),
      );
    }
    await this.options.filesystem.rename(from, to);

    if (source.id === target.id) {
      await this.updateMarker(source.rootPath, (marker) => {
        const oldParent = pathDirname(relative);
        const oldName = pathBasename(relative);
        remapMarkerAfterFolderMove(marker, relative, newRelative);
        const map = normalizeOrderMap(marker.folderOrder);
        const oldParentKey = normalizeOrderKey(oldParent);
        map[oldParentKey] = removeOrderName(map[oldParentKey], oldName);
        const newParentKey = normalizeOrderKey(targetParent);
        map[newParentKey] = upsertOrderName(map[newParentKey], folderName);
        marker.folderOrder = map;
      });
    } else {
      let remappedFolderOrder: Record<string, string[]> = {};
      let remappedRequestOrder: Record<string, string[]> = {};
      await this.updateMarker(source.rootPath, (marker) => {
        remappedFolderOrder = extractRemappedOrderSubtree(
          normalizeOrderMap(marker.folderOrder),
          relative,
          newRelative,
        );
        remappedRequestOrder = extractRemappedOrderSubtree(
          normalizeOrderMap(marker.requestOrder),
          relative,
          newRelative,
        );
        removeFolderFromMarker(marker, relative);
      });
      await this.ensureMarker(target.rootPath, pathBasename(target.rootPath));
      await this.updateMarker(target.rootPath, (marker) => {
        const folderMap = {
          ...normalizeOrderMap(marker.folderOrder),
          ...remappedFolderOrder,
        };
        const parentKey = normalizeOrderKey(targetParent);
        folderMap[parentKey] = upsertOrderName(folderMap[parentKey], folderName);
        marker.folderOrder = folderMap;

        marker.requestOrder = {
          ...normalizeOrderMap(marker.requestOrder),
          ...remappedRequestOrder,
        };
      });
    }
    await this.options.refresh();
    return { relativePath: newRelative };
  }

  public async reorderFolders(
    collectionId: string,
    parentRelativePath: string,
    orderedNames: readonly string[],
  ): Promise<void> {
    const collection = this.requireNativeCollection(collectionId);
    await this.updateMarker(collection.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.folderOrder);
      const key = normalizeOrderKey(parentRelativePath);
      map[key] = [...orderedNames];
      marker.folderOrder = map;
    });
    await this.options.refresh();
  }

  /**
   * Creates a `.api` request file under a native collection folder.
   * When `content` is omitted, writes the standard GET placeholder.
   */
  public async createRequest(
    collectionId: string,
    folderRelativePath: string,
    rawName: string,
    content?: string,
  ): Promise<CreateRequestResult> {
    const collection = this.requireNativeCollection(collectionId);
    const fileName = requireRequestFileName(rawName);
    const folder = normalizeRelativePath(folderRelativePath);
    const absolute = joinUnderCollection(
      collection.rootPath,
      folder,
      fileName,
    );
    if (await this.options.filesystem.exists(absolute)) {
      throw new CollectionMutationError(
        `A request file named "${fileName}" already exists here.`,
      );
    }
    if (folder.length > 0) {
      await this.options.filesystem.createDirectory(
        joinUnderCollection(collection.rootPath, folder),
      );
    }
    const label = stripApiExtension(fileName);
    const source =
      content !== undefined && content.length > 0
        ? content
        : buildPlaceholderRequestSource(label);
    await this.options.filesystem.writeText(absolute, source);
    await this.updateMarker(collection.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.requestOrder);
      const key = normalizeOrderKey(folder);
      map[key] = upsertOrderName(map[key], fileName);
      marker.requestOrder = map;
    });
    await this.options.refresh();
    return { filePath: absolute, fileName };
  }

  /**
   * Serializes a request-source model and writes it as a new `.api` file.
   * File stem comes from `model.name`.
   */
  public async createRequestFromModel(
    collectionId: string,
    folderRelativePath: string,
    model: RequestSourceDocument,
  ): Promise<CreateRequestResult> {
    return this.createRequest(
      collectionId,
      folderRelativePath,
      model.name,
      serializeRequestDocument(model),
    );
  }

  public async renameRequest(
    collectionId: string,
    filePath: string,
    rawNewName: string,
  ): Promise<{ filePath: string }> {
    const collection = this.requireNativeCollection(collectionId);
    const newFileName = requireRequestFileName(rawNewName);
    const oldFileName = pathBasename(filePath);
    const folder = relativeParentOfFile(collection.rootPath, filePath);
    const newPath = joinUnderCollection(
      collection.rootPath,
      folder,
      newFileName,
    );
    if (newPath === filePath) {
      await this.options.refresh();
      return { filePath };
    }
    if (await this.options.filesystem.exists(newPath)) {
      throw new CollectionMutationError(
        `A request file named "${newFileName}" already exists here.`,
      );
    }
    await this.options.filesystem.rename(filePath, newPath);
    await this.updateMarker(collection.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.requestOrder);
      const key = normalizeOrderKey(folder);
      map[key] = renameOrderName(map[key], oldFileName, newFileName);
      marker.requestOrder = map;
    });
    await this.options.refresh();
    return { filePath: newPath };
  }

  public async deleteRequest(
    collectionId: string,
    filePath: string,
  ): Promise<void> {
    const collection = this.requireCollection(collectionId);
    const fileName = pathBasename(filePath);
    const folder = relativeParentOfFile(collection.rootPath, filePath);

    await this.options.filesystem.delete(filePath);

    if (collection.kind === 'native') {
      await this.updateMarker(collection.rootPath, (marker) => {
        const map = normalizeOrderMap(marker.requestOrder);
        const key = normalizeOrderKey(folder);
        map[key] = removeOrderName(map[key], fileName);
        marker.requestOrder = map;
      });
    }
    await this.options.refresh();
  }

  public async duplicateRequest(
    collectionId: string,
    filePath: string,
    rawNewName?: string,
  ): Promise<CreateRequestResult> {
    const collection = this.requireNativeCollection(collectionId);
    const folder = relativeParentOfFile(collection.rootPath, filePath);
    const oldName = pathBasename(filePath);
    const siblings = await this.listChildFileNames(
      joinUnderCollection(collection.rootPath, folder),
    );
    const baseName =
      rawNewName !== undefined
        ? requireRequestFileName(rawNewName)
        : allocateUniqueName(
            `${stripApiExtension(oldName)} Copy.api`,
            (candidate) => siblings.includes(candidate),
          );
    const newFileName =
      rawNewName !== undefined
        ? allocateUniqueName(baseName, (candidate) =>
            siblings.includes(candidate),
          )
        : baseName;
    const newPath = joinUnderCollection(
      collection.rootPath,
      folder,
      newFileName,
    );
    await this.options.filesystem.copy(filePath, newPath);
    await this.updateMarker(collection.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.requestOrder);
      const key = normalizeOrderKey(folder);
      map[key] = upsertOrderName(map[key], newFileName);
      marker.requestOrder = map;
    });
    await this.options.refresh();
    return { filePath: newPath, fileName: newFileName };
  }

  /**
   * Moves a `.api` file into a native collection folder. Source may be Legacy
   * or another native collection.
   */
  public async moveRequest(
    sourceCollectionId: string,
    filePath: string,
    targetCollectionId: string,
    targetFolderRelativePath: string,
  ): Promise<{ filePath: string }> {
    const source = this.requireCollection(sourceCollectionId);
    const target = this.requireNativeCollection(targetCollectionId);
    const fileName = pathBasename(filePath);
    const targetFolder = normalizeRelativePath(targetFolderRelativePath);
    const newPath = joinUnderCollection(
      target.rootPath,
      targetFolder,
      fileName,
    );
    if (newPath === filePath) {
      await this.options.refresh();
      return { filePath };
    }
    if (await this.options.filesystem.exists(newPath)) {
      throw new CollectionMutationError(
        `A request file named "${fileName}" already exists at the destination.`,
      );
    }
    if (targetFolder.length > 0) {
      await this.options.filesystem.createDirectory(
        joinUnderCollection(target.rootPath, targetFolder),
      );
    }
    await this.options.filesystem.rename(filePath, newPath);

    if (source.kind === 'native') {
      const sourceFolder = relativeParentOfFile(source.rootPath, filePath);
      await this.updateMarker(source.rootPath, (marker) => {
        const map = normalizeOrderMap(marker.requestOrder);
        const key = normalizeOrderKey(sourceFolder);
        map[key] = removeOrderName(map[key], fileName);
        marker.requestOrder = map;
      });
    }

    await this.ensureMarker(target.rootPath, pathBasename(target.rootPath));
    await this.updateMarker(target.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.requestOrder);
      const key = normalizeOrderKey(targetFolder);
      map[key] = upsertOrderName(map[key], fileName);
      marker.requestOrder = map;
    });
    await this.options.refresh();
    return { filePath: newPath };
  }

  public async reorderRequests(
    collectionId: string,
    folderRelativePath: string,
    orderedFileNames: readonly string[],
  ): Promise<void> {
    const collection = this.requireNativeCollection(collectionId);
    await this.updateMarker(collection.rootPath, (marker) => {
      const map = normalizeOrderMap(marker.requestOrder);
      const key = normalizeOrderKey(folderRelativePath);
      map[key] = [...orderedFileNames];
      marker.requestOrder = map;
    });
    await this.options.refresh();
  }

  private requireNativeCollection(collectionId: string): Collection {
    const collection = this.requireCollection(collectionId);
    if (collection.kind !== 'native') {
      throw new CollectionMutationError(
        'This action is only available for collections under Collections/.',
      );
    }
    return collection;
  }

  private requireCollection(collectionId: string): Collection {
    const snapshot = this.options.getSnapshot();
    const collection = snapshot?.collections[collectionId];
    if (collection === undefined) {
      throw new CollectionMutationError(
        'Collection not found. Refresh collections and try again.',
      );
    }
    return collection;
  }

  private async listNativeCollectionNames(
    workspaceRootPath: string,
  ): Promise<string[]> {
    // joinPathKey drops `.`, yielding `<workspace>/Collections`.
    const collectionsPath = collectionRootPath(workspaceRootPath, '.');
    if (!(await this.options.filesystem.exists(collectionsPath))) {
      return [];
    }
    const entries =
      await this.options.filesystem.readDirectory(collectionsPath);
    return entries
      .filter(
        (entry) => entry.type === 'directory' && !entry.name.startsWith('.'),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  }

  private async listChildDirectoryNames(path: string): Promise<string[]> {
    if (!(await this.options.filesystem.exists(path))) {
      return [];
    }
    const entries = await this.options.filesystem.readDirectory(path);
    return entries
      .filter((entry) => entry.type === 'directory')
      .map((entry) => entry.name);
  }

  private async listChildFileNames(path: string): Promise<string[]> {
    if (!(await this.options.filesystem.exists(path))) {
      return [];
    }
    const entries = await this.options.filesystem.readDirectory(path);
    return entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.name);
  }

  private async ensureMarker(
    collectionRoot: string,
    fallbackName: string,
  ): Promise<void> {
    const markerPath = collectionMarkerPath(collectionRoot);
    if (await this.options.filesystem.exists(markerPath)) {
      return;
    }
    await this.writeMarker(collectionRoot, {
      name: fallbackName,
      description: '',
      folderOrder: [],
      requestOrder: { [MARKER_ROOT_ORDER_KEY]: [] },
    });
  }

  private async writeMarker(
    collectionRoot: string,
    document: MutableCollectionMarker,
  ): Promise<void> {
    await this.options.filesystem.writeText(
      collectionMarkerPath(collectionRoot),
      serializeCollectionMarker(document),
    );
  }

  private async updateMarker(
    collectionRoot: string,
    mutate: (marker: MutableCollectionMarker) => void,
  ): Promise<void> {
    const markerPath = collectionMarkerPath(collectionRoot);
    let marker: MutableCollectionMarker = {
      name: pathBasename(collectionRoot),
      description: '',
    };
    if (await this.options.filesystem.exists(markerPath)) {
      try {
        const parsed = parseCollectionMarker(
          await this.options.filesystem.readText(markerPath),
        );
        if (parsed !== undefined) {
          marker = {
            ...parsed,
            folderOrder: parsed.folderOrder
              ? normalizeOrderMap(parsed.folderOrder)
              : undefined,
            requestOrder: parsed.requestOrder
              ? normalizeOrderMap(parsed.requestOrder)
              : undefined,
          };
        }
      } catch {
        // Replace unreadable markers with a fresh document.
      }
    }
    mutate(marker);
    await this.writeMarker(collectionRoot, marker);
  }
}

export class CollectionMutationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CollectionMutationError';
  }
}

function requireDirectoryName(raw: string, label: string): string {
  const name = sanitizeDirectoryName(raw);
  if (name === undefined) {
    throw new CollectionMutationError(`Enter a valid ${label.toLowerCase()} name.`);
  }
  return name;
}

function requireRequestFileName(raw: string): string {
  const name = sanitizeRequestFileName(raw);
  if (name === undefined) {
    throw new CollectionMutationError('Enter a valid request name.');
  }
  return name;
}

function relativeParentOfFile(
  collectionRootPath: string,
  filePath: string,
): string {
  const root = collectionRootPath.replace(/\/+$/, '').replace(/\\/g, '/');
  const file = filePath.replace(/\\/g, '/');
  const rootKey = root.toLowerCase();
  const fileKey = file.toLowerCase();
  if (!fileKey.startsWith(`${rootKey}/`) && fileKey !== rootKey) {
    return pathDirname(pathBasename(filePath) === file ? '' : file);
  }
  const relative = file.slice(root.length).replace(/^\/+/, '');
  return pathDirname(relative);
}

function removeFolderFromMarker(
  marker: MutableCollectionMarker,
  folderRelativePath: string,
): void {
  const relative = normalizeRelativePath(folderRelativePath);
  const folderName = pathBasename(relative);
  const parent = pathDirname(relative);
  const folderMap = normalizeOrderMap(marker.folderOrder);
  const parentKey = normalizeOrderKey(parent);
  folderMap[parentKey] = removeOrderName(folderMap[parentKey], folderName);

  for (const key of Object.keys(folderMap)) {
    if (key === relative || key.startsWith(`${relative}/`)) {
      delete folderMap[key];
    }
  }
  marker.folderOrder = folderMap;

  const requestMap = normalizeOrderMap(marker.requestOrder);
  for (const key of Object.keys(requestMap)) {
    if (key === relative || key.startsWith(`${relative}/`)) {
      delete requestMap[key];
    }
  }
  marker.requestOrder = requestMap;
}

function remapMarkerAfterFolderMove(
  marker: MutableCollectionMarker,
  fromRelative: string,
  toRelative: string,
): void {
  const from = normalizeRelativePath(fromRelative);
  const to = normalizeRelativePath(toRelative);
  marker.folderOrder = remapOrderMapKeys(
    normalizeOrderMap(marker.folderOrder),
    from,
    to,
  );
  marker.requestOrder = remapOrderMapKeys(
    normalizeOrderMap(marker.requestOrder),
    from,
    to,
  );
}

/**
 * Returns only the order-map entries under `from`, remapped under `to`.
 * Used when moving a folder across collections so nested order survives.
 */
function extractRemappedOrderSubtree(
  map: Record<string, string[]>,
  fromRelative: string,
  toRelative: string,
): Record<string, string[]> {
  const from = normalizeRelativePath(fromRelative);
  const to = normalizeRelativePath(toRelative);
  const next: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(map)) {
    if (key === from || key.startsWith(`${from}/`)) {
      const remappedKey =
        key === from ? to : `${to}${key.slice(from.length)}`;
      next[normalizeOrderKey(remappedKey)] = [...names];
    }
  }
  return next;
}

function remapOrderMapKeys(
  map: Record<string, string[]>,
  from: string,
  to: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(map)) {
    if (key === from || key.startsWith(`${from}/`)) {
      const remappedKey =
        key === from ? to : `${to}${key.slice(from.length)}`;
      next[normalizeOrderKey(remappedKey)] = names;
    } else {
      next[key] = names;
    }
  }
  return next;
}

function duplicateFolderInMarker(
  marker: MutableCollectionMarker,
  fromRelative: string,
  toRelative: string,
): void {
  const from = normalizeRelativePath(fromRelative);
  const to = normalizeRelativePath(toRelative);
  const folderMap = normalizeOrderMap(marker.folderOrder);
  for (const [key, names] of Object.entries({ ...folderMap })) {
    if (key === from || key.startsWith(`${from}/`)) {
      const remappedKey =
        key === from ? to : `${to}${key.slice(from.length)}`;
      folderMap[normalizeOrderKey(remappedKey)] = [...names];
    }
  }
  marker.folderOrder = folderMap;

  const requestMap = normalizeOrderMap(marker.requestOrder);
  for (const [key, names] of Object.entries({ ...requestMap })) {
    if (key === from || key.startsWith(`${from}/`)) {
      const remappedKey =
        key === from ? to : `${to}${key.slice(from.length)}`;
      requestMap[normalizeOrderKey(remappedKey)] = [...names];
    }
  }
  marker.requestOrder = requestMap;
}
