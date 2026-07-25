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
export { openCrudPromptDialog } from './crud-prompt-dialog';
export type {
  CrudPromptDialogConfig,
  CrudPromptResult,
} from './crud-prompt-dialog';
export { openDestinationPickerDialog } from './destination-picker-dialog';
export type {
  DestinationPickerDestination,
  DestinationPickerResult,
} from './destination-picker-dialog';
export {
  NodeApiFileReader,
  VsCodeApiFileReader,
  VsCodeWorkspaceScanner,
} from './workspace-scanner';
