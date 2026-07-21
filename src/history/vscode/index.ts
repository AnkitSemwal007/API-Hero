/** VS Code-specific adapters for request history. */
export { FileHistoryRepository, migrateHistoryDocument } from './file-history-repository';
export {
  buildHistoryDetailModel,
  formatHistorySummaryText,
  parseHistoryDetailMessage,
  renderHistoryDetailHtml,
} from './history-detail-html';
export type {
  HistoryDetailInboundMessage,
  HistoryDetailModel,
  HistoryDetailOutboundMessage,
} from './history-detail-html';
export { HistoryDetailPanel } from './history-detail-panel';
export type { HistoryDetailPanelActions } from './history-detail-panel';
export {
  describeHistoryFilter,
  HistoryTreeDataProvider,
} from './history-tree-provider';
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
