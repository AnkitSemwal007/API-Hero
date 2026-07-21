export type {
  Collection,
  CollectionDiscoveryIssue,
  CollectionDiscoveryIssueCode,
  CollectionIdentifier,
  CollectionKind,
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
  isUnderRelativeRoot,
  joinPathKey,
  legacyCollectionIdForWorkspace,
  normalizePathKey,
  normalizeRelativePath,
  relativePathUnderCollection,
  requestIdFor,
  workspaceRootIdForPath,
} from './models';

export {
  COLLECTIONS_DIRECTORY_NAME,
  COLLECTION_MARKER_FILENAME,
  LEGACY_COLLECTION_LABEL,
} from './constants';

export type {
  ApiFileReader,
  DiscoveredApiFile,
  DiscoveredCollectionRoot,
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

export {
  CollectionDiscoveryService,
  collectionRelativeRootForName,
  parseCollectionMarker,
} from './discovery';
export type {
  CollectionDiscoveryOptions,
  CollectionMarkerDocument,
} from './discovery';

export {
  MARKER_ROOT_ORDER_KEY,
  normalizeOrderKey,
  normalizeOrderMap,
  orderIdsByNames,
  serializeCollectionMarker,
} from './marker';

export {
  CollectionMutationError,
  CollectionMutationService,
  PLACEHOLDER_REQUEST_SOURCE,
  allocateUniqueName,
  buildPlaceholderRequestSource,
  collectionMarkerPath,
  collectionRootPath,
  joinUnderCollection,
  pathBasename,
  sanitizeDirectoryName,
  sanitizeRequestFileName,
  stripApiExtension,
} from './mutation';
export type {
  CollectionDirectoryEntry,
  CollectionFilesystem,
  CollectionMutationOptions,
  CreateCollectionResult,
  CreateRequestResult,
  ExportCollectionOptions,
  ExportCollectionResult,
  ImportCollectionOptions,
} from './mutation';

export {
  collectionExportDestinationPath,
  looksLikeCollectionRoot,
  preferredCollectionDirectoryName,
  resolveCollectionNameCollision,
} from './transfer';
export type {
  CollectionNameCollisionChoice,
  ResolvedCollectionDirectoryName,
} from './transfer';

export {
  buildNavigationIndex,
  findRequestAtOffset,
  findRequestById,
} from './navigation';
export type { NavigationIndex } from './navigation';

export {
  findTreeNodeByRequestId,
  formatRequestDescription,
  getFilteredTreeChildren,
  getTreeChildren,
  getTreeRoots,
  isLegacyTreeTarget,
  nodeMatchesFilter,
  normalizeFilterQuery,
  treePathToRequest,
} from './tree-projection';
export type {
  CollectionTreeNode,
  CollectionTreeNodeKind,
} from './tree-projection';
