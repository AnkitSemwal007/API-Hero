/**
 * Framework-free workspace scanning contracts.
 *
 * Implementations may use VS Code workspace APIs, Node `fs`, or an in-memory
 * fake for tests. Domain and discovery code never imports VS Code.
 */

export interface WorkspaceFolderDescriptor {
  /** Absolute filesystem path or file URI string. */
  readonly path: string;
  readonly name: string;
}

export interface DiscoveredApiFile {
  /** Absolute filesystem path or file URI string. */
  readonly path: string;
  /** Path relative to the owning workspace folder, `/`-separated. */
  readonly relativePath: string;
  /** Owning workspace folder absolute path. */
  readonly workspaceRootPath: string;
  /** File modification time in milliseconds since epoch, when known. */
  readonly mtimeMs?: number;
}

/**
 * A directory under `Collections/<Name>/` treated as a collection root.
 * Marker file is optional; missing markers still yield a native collection.
 */
export interface DiscoveredCollectionRoot {
  /** Absolute filesystem path or file URI of the collection directory. */
  readonly path: string;
  /** Directory name (`<CollectionName>`). */
  readonly name: string;
  /** Owning workspace folder absolute path. */
  readonly workspaceRootPath: string;
  /**
   * Path relative to the workspace folder (`Collections/<Name>`),
   * `/`-separated.
   */
  readonly relativePath: string;
  /** Absolute path of `api-hero.collection.json` when present. */
  readonly markerPath?: string;
  readonly markerMtimeMs?: number;
}

export interface WorkspaceScanResult {
  readonly folders: readonly WorkspaceFolderDescriptor[];
  readonly apiFiles: readonly DiscoveredApiFile[];
  /** Native collection directories discovered under `Collections/`. */
  readonly collectionRoots: readonly DiscoveredCollectionRoot[];
  readonly issues: readonly WorkspaceScanIssue[];
}

export interface WorkspaceScanIssue {
  readonly code: 'UNREADABLE' | 'MISSING' | 'INVALID';
  readonly message: string;
  readonly path?: string;
}

/**
 * Locates workspace folders, collection roots, and `.api` files beneath them.
 *
 * Implementations should treat discovery as a bulk scan; callers cache results
 * and avoid invoking a full scan on every tree expand.
 */
export interface WorkspaceScanner {
  scan(): Promise<WorkspaceScanResult> | WorkspaceScanResult;
}

/**
 * Reads file text for request projection and optional collection markers.
 * Missing or unreadable files must reject or return a structured failure
 * handled by discovery — never throw uncaught into the tree UI.
 */
export interface ApiFileReader {
  readText(path: string): Promise<string> | string;
}
