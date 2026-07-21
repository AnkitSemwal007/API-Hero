/** VS Code-specific adapters for collections exploration and navigation. */
export { CollectionTreeDataProvider } from './collection-tree-provider';
export { CollectionNavigationService } from './navigation-service';
export { registerCollections } from './register-collections';
export type { CollectionsRegistration } from './register-collections';
export { VsCodeCollectionFilesystem } from './mutation-filesystem';
export { CollectionTreeDragAndDropController } from './collection-dnd-controller';
export {
  buildNewRequestDestinations,
  openNewRequestDialog,
} from './new-request-dialog';
export type { NewRequestDialogResult } from './new-request-dialog';
export {
  NodeApiFileReader,
  VsCodeApiFileReader,
  VsCodeWorkspaceScanner,
} from './workspace-scanner';
