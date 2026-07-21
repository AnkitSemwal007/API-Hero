import {
  COLLECTIONS_DIRECTORY_NAME,
  COLLECTION_MARKER_FILENAME,
  LEGACY_COLLECTION_LABEL,
} from './constants';
import {
  ApiFileParseCache,
  type ApiFileParseResult,
} from './api-file-parse-cache';
import {
  MARKER_ROOT_ORDER_KEY,
  normalizeOrderMap,
  orderIdsByNames,
  parseCollectionMarker,
  type CollectionMarkerDocument,
} from './marker';
import {
  collectionIdForRoot,
  folderIdFor,
  freezeWorkspaceCollections,
  isUnderRelativeRoot,
  joinPathKey,
  legacyCollectionIdForWorkspace,
  normalizeRelativePath,
  relativePathUnderCollection,
  requestIdFor,
  workspaceRootIdForPath,
  type Collection,
  type CollectionDiscoveryIssue,
  type CollectionKind,
  type Folder,
  type RequestReference,
  type WorkspaceCollections,
  type WorkspaceRoot,
} from './models';
import type { CollectionRepository } from './repository';
import type {
  ApiFileReader,
  DiscoveredApiFile,
  DiscoveredCollectionRoot,
  WorkspaceScanner,
} from './scanner';

export type { CollectionMarkerDocument } from './marker';
export { parseCollectionMarker } from './marker';

export interface CollectionDiscoveryOptions {
  readonly scanner: WorkspaceScanner;
  readonly reader: ApiFileReader;
  readonly repository: CollectionRepository;
  readonly parseCache?: ApiFileParseCache;
}

/**
 * Orchestrates workspace scanning into an immutable {@link WorkspaceCollections}
 * graph. Results are cached in the repository until an explicit refresh or
 * targeted invalidation.
 *
 * ## Discovery rule
 *
 * 1. Each workspace folder is one {@link WorkspaceRoot}.
 * 2. Each immediate subdirectory of `Collections/` is a **native**
 *    {@link Collection} (marker `api-hero.collection.json` optional).
 * 3. `.api` files not under any native collection root join one **Legacy**
 *    synthetic collection per workspace folder (omitted when empty).
 * 4. Directories that contain `.api` files (directly) appear as {@link Folder}
 *    nodes under the owning collection; nested paths create parents as needed.
 * 5. Each `.api` file is a request source — not a tree node. Parsed requests
 *    become {@link RequestReference} children of the containing folder (or the
 *    collection root when the file sits at the collection root).
 * 6. Request labels and ranges come from `parseApiDocument` via
 *    {@link ApiFileParseCache} keyed by path + mtime.
 *
 * Refresh is single-flight with a trailing re-run when invalidate/refresh
 * arrives while a scan is in progress (avoids out-of-order last-write-wins).
 */
export class CollectionDiscoveryService {
  private readonly parseCache: ApiFileParseCache;
  private readonly listeners = new Set<() => void>();
  private refreshInFlight: Promise<WorkspaceCollections> | undefined;
  private refreshQueued = false;

  public constructor(private readonly options: CollectionDiscoveryOptions) {
    this.parseCache = options.parseCache ?? new ApiFileParseCache();
  }

  public get snapshot(): WorkspaceCollections | undefined {
    return this.options.repository.get();
  }

  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /** Full rescan of workspace folders, collection roots, and `.api` files. */
  public async refresh(): Promise<WorkspaceCollections> {
    this.refreshQueued = true;
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight.then((result) =>
        this.refreshQueued ? this.refresh() : result,
      );
    }

    this.refreshInFlight = this.drainRefreshQueue();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = undefined;
    }
  }

  /**
   * Invalidates cached parse results for a file and refreshes the aggregate.
   * Missing paths still trigger a refresh so deletions disappear from the tree.
   */
  public async invalidateFile(path: string): Promise<WorkspaceCollections> {
    this.parseCache.invalidate(path);
    return this.refresh();
  }

  public async invalidateAll(): Promise<WorkspaceCollections> {
    this.parseCache.invalidateAll();
    return this.refresh();
  }

  private async drainRefreshQueue(): Promise<WorkspaceCollections> {
    let latest!: WorkspaceCollections;
    do {
      this.refreshQueued = false;
      latest = await this.performRefresh();
    } while (this.refreshQueued);
    return latest;
  }

  private async performRefresh(): Promise<WorkspaceCollections> {
    const scanned = await Promise.resolve(this.options.scanner.scan());
    const issues: CollectionDiscoveryIssue[] = scanned.issues.map((issue) => ({
      code:
        issue.code === 'MISSING'
          ? 'MISSING_FILE'
          : issue.code === 'UNREADABLE'
            ? 'UNREADABLE_FILE'
            : 'INVALID_STRUCTURE',
      message: issue.message,
      path: issue.path,
    }));

    if (scanned.folders.length === 0) {
      const empty = freezeWorkspaceCollections({
        workspaceRoots: [],
        collections: {},
        discoveredAt: Date.now(),
        issues: [
          ...issues,
          {
            code: 'NO_WORKSPACE',
            message: 'No workspace folder is open.',
          },
        ],
      });
      this.options.repository.set(empty);
      this.notify();
      return empty;
    }

    const collections: Record<string, Collection> = {};
    const workspaceRoots: WorkspaceRoot[] = [];
    const collectionRoots = scanned.collectionRoots ?? [];

    for (const folder of scanned.folders) {
      const files = scanned.apiFiles.filter(
        (file) => file.workspaceRootPath === folder.path,
      );
      const rootsForFolder = collectionRoots.filter(
        (root) => root.workspaceRootPath === folder.path,
      );
      const collectionIds: string[] = [];

      const claimed = new Set<string>();
      const nativeBuilt: Collection[] = [];

      for (const root of rootsForFolder) {
        const marker = await this.readMarker(root, issues);
        const ownedFiles = files.filter((file) =>
          isUnderRelativeRoot(file.relativePath, root.relativePath),
        );
        for (const file of ownedFiles) {
          claimed.add(file.path);
        }
        const relativeFiles = ownedFiles.map((file) => ({
          ...file,
          relativePath: relativePathUnderCollection(
            file.relativePath,
            root.relativePath,
          ),
        }));
        const collection = await this.buildCollection({
          collectionId: collectionIdForRoot(root.path),
          rootPath: root.path,
          workspaceRootPath: folder.path,
          kind: 'native',
          name: marker?.name?.trim() || root.name,
          description: marker?.description,
          order: marker?.order,
          folderOrder: marker?.folderOrder,
          requestOrder: marker?.requestOrder,
          files: relativeFiles,
          issues,
        });
        nativeBuilt.push(collection);
      }

      nativeBuilt.sort(compareCollections);
      for (const collection of nativeBuilt) {
        collections[collection.id] = collection;
        collectionIds.push(collection.id);
      }

      const legacyFiles = files.filter((file) => !claimed.has(file.path));
      if (legacyFiles.length > 0) {
        const legacy = await this.buildCollection({
          collectionId: legacyCollectionIdForWorkspace(folder.path),
          rootPath: folder.path,
          workspaceRootPath: folder.path,
          kind: 'legacy',
          name: LEGACY_COLLECTION_LABEL,
          description: `Files outside ${COLLECTIONS_DIRECTORY_NAME}/`,
          files: legacyFiles,
          issues,
        });
        collections[legacy.id] = legacy;
        collectionIds.push(legacy.id);
      }

      workspaceRoots.push({
        id: workspaceRootIdForPath(folder.path),
        path: folder.path,
        display: { label: folder.name },
        collectionIds,
      });
    }

    const aggregate = freezeWorkspaceCollections({
      workspaceRoots,
      collections,
      discoveredAt: Date.now(),
      issues,
    });
    this.options.repository.set(aggregate);
    this.notify();
    return aggregate;
  }

  private async readMarker(
    root: DiscoveredCollectionRoot,
    issues: CollectionDiscoveryIssue[],
  ): Promise<CollectionMarkerDocument | undefined> {
    if (root.markerPath === undefined) {
      return undefined;
    }
    try {
      const text = await Promise.resolve(
        this.options.reader.readText(root.markerPath),
      );
      const parsed = parseCollectionMarker(text);
      if (parsed === undefined) {
        issues.push({
          code: 'INVALID_STRUCTURE',
          message: `Invalid ${COLLECTION_MARKER_FILENAME} (expected a JSON object).`,
          path: root.markerPath,
        });
      }
      return parsed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to read collection marker.';
      issues.push({
        code: 'UNREADABLE_FILE',
        message,
        path: root.markerPath,
      });
      return undefined;
    }
  }

  private async buildCollection(input: {
    readonly collectionId: string;
    readonly rootPath: string;
    readonly workspaceRootPath: string;
    readonly kind: CollectionKind;
    readonly name: string;
    readonly description?: string;
    readonly order?: number;
    readonly folderOrder?: CollectionMarkerDocument['folderOrder'];
    readonly requestOrder?: CollectionMarkerDocument['requestOrder'];
    readonly files: readonly DiscoveredApiFile[];
    readonly issues: CollectionDiscoveryIssue[];
  }): Promise<Collection> {
    const {
      collectionId,
      rootPath,
      workspaceRootPath,
      kind,
      name,
      description,
      order,
      folderOrder,
      requestOrder,
      files,
      issues,
    } = input;
    const folders: Record<string, Folder> = {};
    const requests: Record<string, RequestReference> = {};
    const rootFolderIds = new Set<string>();
    const rootRequestIds: string[] = [];
    let lastModified: number | undefined;

    const folderOrderMap = normalizeOrderMap(folderOrder);
    const requestOrderMap = normalizeOrderMap(requestOrder);

    // Materialize empty folders declared in the marker (UI-created folders).
    for (const [parentKey, names] of Object.entries(folderOrderMap)) {
      for (const folderName of names) {
        const relative =
          parentKey === MARKER_ROOT_ORDER_KEY
            ? folderName
            : `${parentKey}/${folderName}`;
        this.ensureFolderChain(
          collectionId,
          relative,
          folders,
          rootFolderIds,
        );
      }
    }

    for (const file of files) {
      if (file.mtimeMs !== undefined) {
        lastModified =
          lastModified === undefined
            ? file.mtimeMs
            : Math.max(lastModified, file.mtimeMs);
      }

      let parseResult: ApiFileParseResult;
      try {
        const text = await Promise.resolve(this.options.reader.readText(file.path));
        parseResult = this.parseCache.getOrParse(file.path, text, file.mtimeMs);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to read API file.';
        issues.push({
          code: 'UNREADABLE_FILE',
          message,
          path: file.path,
        });
        continue;
      }

      if (parseResult.error !== undefined) {
        issues.push({
          code: 'PARSE_FAILURE',
          message: parseResult.error,
          path: file.path,
        });
      }

      const parentRelative = parentDirectory(file.relativePath);
      const folderId =
        parentRelative.length === 0
          ? undefined
          : this.ensureFolderChain(
              collectionId,
              parentRelative,
              folders,
              rootFolderIds,
            );

      for (const summary of parseResult.requests) {
        const id = requestIdFor(file.path, summary.index);
        const reference: RequestReference = {
          id,
          collectionId,
          folderId,
          filePath: file.path,
          requestIndex: summary.index,
          method: summary.method,
          url: summary.url,
          display: {
            label: summary.label,
            description: `${summary.method} ${summary.url}`.trim(),
            detail: file.relativePath,
          },
          range: summary.range,
        };
        requests[id] = reference;
        if (folderId === undefined) {
          rootRequestIds.push(id);
        } else {
          const folder = folders[folderId];
          if (folder !== undefined) {
            folders[folderId] = {
              ...folder,
              requestIds: [...folder.requestIds, id],
            };
          }
        }
      }
    }

    const sortedRootRequests = orderRequestIds(
      rootRequestIds,
      requests,
      requestOrderMap[MARKER_ROOT_ORDER_KEY],
    );

    for (const folder of Object.values(folders)) {
      const parentKey = normalizeRelativePath(folder.relativePath);
      const sortedRequests = orderRequestIds(
        folder.requestIds,
        requests,
        requestOrderMap[parentKey],
      );
      const sortedFolders = orderIdsByNames(
        folder.folderIds,
        (id) => folders[id]?.display.label ?? id,
        folderOrderMap[parentKey],
      );
      folders[folder.id] = {
        ...folder,
        folderIds: sortedFolders,
        requestIds: sortedRequests,
      };
    }

    const sortedRootFolders = orderIdsByNames(
      [...rootFolderIds],
      (id) => folders[id]?.display.label ?? id,
      folderOrderMap[MARKER_ROOT_ORDER_KEY],
    );

    return {
      id: collectionId,
      rootPath,
      workspaceRootPath,
      kind,
      metadata: {
        name,
        ...(description !== undefined ? { description } : {}),
        workspacePath: rootPath,
        ...(order !== undefined ? { order } : {}),
        lastModified,
        requestCount: Object.keys(requests).length,
        folderCount: Object.keys(folders).length,
      },
      display: {
        label: name,
        description: description ?? rootPath,
      },
      rootFolderIds: sortedRootFolders,
      rootRequestIds: sortedRootRequests,
      folders,
      requests,
    };
  }

  private ensureFolderChain(
    collectionId: string,
    relativePath: string,
    folders: Record<string, Folder>,
    rootFolderIds: Set<string>,
  ): string {
    const normalized = normalizeRelativePath(relativePath);
    const segments = normalized.split('/').filter((segment) => segment.length > 0);
    let parentId: string | undefined;
    let currentRelative = '';

    for (const segment of segments) {
      currentRelative =
        currentRelative.length === 0 ? segment : `${currentRelative}/${segment}`;
      const id = folderIdFor(collectionId, currentRelative);
      if (folders[id] === undefined) {
        folders[id] = {
          id,
          collectionId,
          parentId,
          relativePath: currentRelative,
          display: { label: segment },
          folderIds: [],
          requestIds: [],
        };
        if (parentId === undefined) {
          rootFolderIds.add(id);
        } else {
          const parent = folders[parentId];
          if (parent !== undefined && !parent.folderIds.includes(id)) {
            folders[parentId] = {
              ...parent,
              folderIds: [...parent.folderIds, id],
            };
          }
        }
      }
      parentId = id;
    }

    return folderIdFor(collectionId, normalized);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Builds a workspace-relative `Collections/<Name>` path for a collection name.
 * Pure helper for tests and mutation.
 */
export function collectionRelativeRootForName(collectionName: string): string {
  return joinPathKey(COLLECTIONS_DIRECTORY_NAME, collectionName);
}

function compareCollections(left: Collection, right: Collection): number {
  const leftOrder = left.metadata.order;
  const rightOrder = right.metadata.order;
  if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder !== undefined && rightOrder === undefined) {
    return -1;
  }
  if (leftOrder === undefined && rightOrder !== undefined) {
    return 1;
  }
  return left.display.label.localeCompare(right.display.label);
}

function parentDirectory(relativeFilePath: string): string {
  const normalized = normalizeRelativePath(relativeFilePath);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '';
  }
  return normalized.slice(0, index);
}

/**
 * Orders request ids by marker file-name lists, then locale path + index.
 * Multi-request `.api` files stay grouped; index order within a file is kept.
 */
function orderRequestIds(
  ids: readonly string[],
  requests: Readonly<Record<string, RequestReference>>,
  orderedFileNames: readonly string[] | undefined,
): string[] {
  const byPathThenIndex = (left: string, right: string): number => {
    const a = requests[left];
    const b = requests[right];
    if (a === undefined || b === undefined) {
      return left.localeCompare(right);
    }
    const pathOrder = a.filePath.localeCompare(b.filePath);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    return a.requestIndex - b.requestIndex;
  };

  const sorted = [...ids].sort(byPathThenIndex);
  if (orderedFileNames === undefined || orderedFileNames.length === 0) {
    return sorted;
  }

  const groups = new Map<string, string[]>();
  for (const id of sorted) {
    const request = requests[id];
    const base = fileBasename(request?.filePath ?? id);
    const group = groups.get(base);
    if (group === undefined) {
      groups.set(base, [id]);
    } else {
      group.push(id);
    }
  }

  const result: string[] = [];
  const used = new Set<string>();
  for (const name of orderedFileNames) {
    const group = groups.get(name);
    if (group !== undefined && !used.has(name)) {
      result.push(...group);
      used.add(name);
    }
  }
  for (const [name, group] of groups) {
    if (!used.has(name)) {
      result.push(...group);
    }
  }
  return result;
}

function fileBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? normalized : normalized.slice(index + 1);
}
