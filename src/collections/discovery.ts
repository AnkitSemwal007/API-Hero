import {
  ApiFileParseCache,
  type ApiFileParseResult,
} from './api-file-parse-cache';
import {
  collectionIdForRoot,
  folderIdFor,
  freezeWorkspaceCollections,
  normalizeRelativePath,
  requestIdFor,
  workspaceRootIdForPath,
  type Collection,
  type CollectionDiscoveryIssue,
  type Folder,
  type RequestReference,
  type WorkspaceCollections,
  type WorkspaceRoot,
} from './models';
import type { CollectionRepository } from './repository';
import type {
  ApiFileReader,
  DiscoveredApiFile,
  WorkspaceScanner,
} from './scanner';

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
 * 2. Each workspace folder is currently one {@link Collection} rooted at that
 *    folder (1:1). Future collection markers can add siblings without changing
 *    identity helpers.
 * 3. Directories that contain `.api` files (directly) appear as {@link Folder}
 *    nodes under the collection; nested paths create parent folders as needed.
 * 4. Each `.api` file is a request source — not a tree node. Parsed requests
 *    become {@link RequestReference} children of the containing folder (or the
 *    collection root when the file sits at the collection root).
 * 5. Request labels and ranges come from `parseApiDocument` via
 *    {@link ApiFileParseCache} keyed by path + mtime.
 */
export class CollectionDiscoveryService {
  private readonly parseCache: ApiFileParseCache;
  private readonly listeners = new Set<() => void>();

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

  /** Full rescan of workspace folders and `.api` files. */
  public async refresh(): Promise<WorkspaceCollections> {
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

    for (const folder of scanned.folders) {
      const files = scanned.apiFiles.filter(
        (file) => file.workspaceRootPath === folder.path,
      );
      const collection = await this.buildCollection(folder.path, folder.name, files, issues);
      collections[collection.id] = collection;
      workspaceRoots.push({
        id: workspaceRootIdForPath(folder.path),
        path: folder.path,
        display: { label: folder.name },
        collectionIds: [collection.id],
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

  private async buildCollection(
    rootPath: string,
    name: string,
    files: readonly DiscoveredApiFile[],
    issues: CollectionDiscoveryIssue[],
  ): Promise<Collection> {
    const collectionId = collectionIdForRoot(rootPath);
    const folders: Record<string, Folder> = {};
    const requests: Record<string, RequestReference> = {};
    const rootFolderIds = new Set<string>();
    const rootRequestIds: string[] = [];
    let lastModified: number | undefined;

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

    sortIds(rootRequestIds, requests);
    for (const folder of Object.values(folders)) {
      const sortedRequests = [...folder.requestIds];
      sortIds(sortedRequests, requests);
      const sortedFolders = [...folder.folderIds].sort((left, right) =>
        (folders[left]?.display.label ?? left).localeCompare(
          folders[right]?.display.label ?? right,
        ),
      );
      folders[folder.id] = {
        ...folder,
        folderIds: sortedFolders,
        requestIds: sortedRequests,
      };
    }

    const sortedRootFolders = [...rootFolderIds].sort((left, right) =>
      (folders[left]?.display.label ?? left).localeCompare(
        folders[right]?.display.label ?? right,
      ),
    );

    return {
      id: collectionId,
      rootPath,
      workspaceRootPath: rootPath,
      metadata: {
        name,
        workspacePath: rootPath,
        lastModified,
        requestCount: Object.keys(requests).length,
        folderCount: Object.keys(folders).length,
      },
      display: {
        label: name,
        description: rootPath,
      },
      rootFolderIds: sortedRootFolders,
      rootRequestIds,
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

function parentDirectory(relativeFilePath: string): string {
  const normalized = normalizeRelativePath(relativeFilePath);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '';
  }
  return normalized.slice(0, index);
}

function sortIds(
  ids: string[],
  requests: Readonly<Record<string, RequestReference>>,
): void {
  ids.sort((left, right) => {
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
  });
}
