/** VS Code-specific adapters for collections exploration and navigation. */
export { CollectionTreeDataProvider } from './collection-tree-provider';
export { CollectionNavigationService } from './navigation-service';
export { registerCollections } from './register-collections';
export type { CollectionsRegistration } from './register-collections';
export {
  NodeApiFileReader,
  VsCodeApiFileReader,
  VsCodeWorkspaceScanner,
} from './workspace-scanner';
