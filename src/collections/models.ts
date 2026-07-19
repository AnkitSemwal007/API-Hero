import type { Range } from '../parser/types';
import { cloneDetached, deepFreeze } from '../shared';

/**
 * Opaque, stable collection identity. String form is suitable for maps and
 * tree element IDs without embedding VS Code types.
 */
export type CollectionIdentifier = string;

/** Display-facing labels and optional detail for tree and UI surfaces. */
export interface DisplayMetadata {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly tooltip?: string;
}

/**
 * Extensible collection summary. Unknown future keys belong in {@link ExtensionBag}
 * bags rather than widening required fields.
 */
export interface CollectionMetadata {
  readonly name: string;
  readonly description?: string;
  /** Absolute filesystem or URI path of the collection root. */
  readonly workspacePath: string;
  readonly lastModified?: number;
  readonly requestCount: number;
  readonly folderCount: number;
}

/**
 * Reserved extension bags for deferred features. Keys are documented; values
 * remain opaque so organization can evolve without breaking consumers.
 */
export interface ExtensionBag {
  readonly runCollection?: Readonly<Record<string, unknown>>;
  readonly ordering?: Readonly<Record<string, unknown>>;
  readonly collectionVariables?: Readonly<Record<string, unknown>>;
  readonly tags?: Readonly<Record<string, unknown>>;
  readonly favorites?: Readonly<Record<string, unknown>>;
  readonly history?: Readonly<Record<string, unknown>>;
  readonly openApi?: Readonly<Record<string, unknown>>;
  readonly cloudSync?: Readonly<Record<string, unknown>>;
  readonly teamSharing?: Readonly<Record<string, unknown>>;
  readonly [key: string]: Readonly<Record<string, unknown>> | undefined;
}

/** Reference to one request inside a `.api` file. */
export interface RequestReference {
  readonly id: string;
  readonly collectionId: CollectionIdentifier;
  /** Parent folder id, or undefined when the request lives at collection root. */
  readonly folderId: string | undefined;
  /** Absolute URI/path of the owning `.api` file. */
  readonly filePath: string;
  /** Zero-based request index within the parsed document. */
  readonly requestIndex: number;
  readonly method: string;
  readonly url: string;
  readonly display: DisplayMetadata;
  /** Canonical request range from `parseApiDocument`. */
  readonly range: Range;
  readonly extensions?: ExtensionBag;
}

/** Nested folder within a collection (relative path segments). */
export interface Folder {
  readonly id: string;
  readonly collectionId: CollectionIdentifier;
  readonly parentId: string | undefined;
  /** Path relative to the collection root using `/` separators. */
  readonly relativePath: string;
  readonly display: DisplayMetadata;
  readonly folderIds: readonly string[];
  readonly requestIds: readonly string[];
  readonly extensions?: ExtensionBag;
}

/** One collection: currently 1:1 with a workspace folder root. */
export interface Collection {
  readonly id: CollectionIdentifier;
  /** Absolute URI/path of the collection root (workspace folder). */
  readonly rootPath: string;
  /** Owning workspace folder absolute URI/path. */
  readonly workspaceRootPath: string;
  readonly metadata: CollectionMetadata;
  readonly display: DisplayMetadata;
  readonly rootFolderIds: readonly string[];
  readonly rootRequestIds: readonly string[];
  readonly folders: Readonly<Record<string, Folder>>;
  readonly requests: Readonly<Record<string, RequestReference>>;
  readonly extensions?: ExtensionBag;
}

/** One VS Code workspace folder and its collections. */
export interface WorkspaceRoot {
  readonly id: string;
  readonly path: string;
  readonly display: DisplayMetadata;
  readonly collectionIds: readonly string[];
}

/**
 * Immutable aggregate of everything discovered for the current workspace.
 * Empty when no folders are open.
 */
export interface WorkspaceCollections {
  readonly workspaceRoots: readonly WorkspaceRoot[];
  readonly collections: Readonly<Record<string, Collection>>;
  readonly discoveredAt: number;
  readonly issues: readonly CollectionDiscoveryIssue[];
}

export type CollectionDiscoveryIssueCode =
  | 'NO_WORKSPACE'
  | 'UNREADABLE_FILE'
  | 'MISSING_FILE'
  | 'PARSE_FAILURE'
  | 'INVALID_STRUCTURE';

export interface CollectionDiscoveryIssue {
  readonly code: CollectionDiscoveryIssueCode;
  readonly message: string;
  readonly path?: string;
}

/** Creates a deeply frozen detached copy of a workspace collections aggregate. */
export function freezeWorkspaceCollections(
  value: WorkspaceCollections,
): WorkspaceCollections {
  return deepFreeze(cloneDetached(value));
}

/** Builds a stable collection id from the collection root path. */
export function collectionIdForRoot(rootPath: string): CollectionIdentifier {
  return `collection:${normalizePathKey(rootPath)}`;
}

/** Builds a stable workspace-root id. */
export function workspaceRootIdForPath(rootPath: string): string {
  return `workspace:${normalizePathKey(rootPath)}`;
}

/** Builds a stable folder id under a collection. */
export function folderIdFor(
  collectionId: CollectionIdentifier,
  relativePath: string,
): string {
  return `folder:${collectionId}:${normalizeRelativePath(relativePath)}`;
}

/** Builds a stable request reference id. */
export function requestIdFor(filePath: string, requestIndex: number): string {
  return `request:${normalizePathKey(filePath)}#${requestIndex}`;
}

/** Normalizes absolute path/URI keys for identity comparison. */
export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Normalizes relative folder paths to `/`-separated form without leading `/`. */
export function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}
