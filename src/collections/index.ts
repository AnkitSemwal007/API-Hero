export type {
  Collection,
  CollectionDiscoveryIssue,
  CollectionDiscoveryIssueCode,
  CollectionIdentifier,
  CollectionMetadata,
  DisplayMetadata,
  ExtensionBag,
  Folder,
  RequestReference,
  WorkspaceCollections,
  WorkspaceRoot,
} from './models';
export {
  collectionIdForRoot,
  folderIdFor,
  freezeWorkspaceCollections,
  normalizePathKey,
  normalizeRelativePath,
  requestIdFor,
  workspaceRootIdForPath,
} from './models';

export type {
  ApiFileReader,
  DiscoveredApiFile,
  WorkspaceFolderDescriptor,
  WorkspaceScanIssue,
  WorkspaceScanResult,
  WorkspaceScanner,
} from './scanner';

export type { CollectionRepository } from './repository';
export { InMemoryCollectionRepository } from './repository';

export {
  ApiFileParseCache,
  parseApiFileRequests,
} from './api-file-parse-cache';
export type {
  ApiFileParseResult,
  ParsedRequestSummary,
} from './api-file-parse-cache';

export { CollectionDiscoveryService } from './discovery';
export type { CollectionDiscoveryOptions } from './discovery';

export {
  buildNavigationIndex,
  findRequestAtOffset,
  findRequestById,
} from './navigation';
export type { NavigationIndex } from './navigation';

export {
  findTreeNodeByRequestId,
  getTreeChildren,
  getTreeRoots,
  treePathToRequest,
} from './tree-projection';
export type {
  CollectionTreeNode,
  CollectionTreeNodeKind,
} from './tree-projection';
