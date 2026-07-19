/** VS Code-specific adapters for request history. */
export { FileHistoryRepository, migrateHistoryDocument } from './file-history-repository';
export { HistoryTreeDataProvider } from './history-tree-provider';
export type { HistoryTreeNode } from './history-tree-provider';
export {
  createHistoryInfrastructure,
  filterVisibleHistory,
  registerHistory,
} from './register-history';
export type {
  HistoryInfrastructure,
  HistoryRegistration,
  RegisterHistoryOptions,
} from './register-history';
