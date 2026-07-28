/** VS Code-specific adapters for Collection Runner. */
export { registerCollectionRunner } from './register-collection-runner';
export type { RegisterCollectionRunnerOptions } from './register-collection-runner';
export { registerExecutionView } from './register-execution-view';
export type { RegisterExecutionViewOptions } from './register-execution-view';
export {
  CollectionRunStatusBar,
  MultiplexCollectionRunProgress,
  RunScopedCollectionRunProgress,
  VsCodeCollectionRunProgress,
  VsCodeCollectionRunSourceReader,
  formatRunSummaryMessage,
  formatUnexpectedFailMessage,
  formatDuration,
  withCollectionRunProgress,
} from './progress-ui';
export { CollectionRunReportPanel } from './run-report-panel';
export type { CollectionRunReportPanelActions } from './run-report-panel';
export { ExecutionTreeDataProvider } from './execution-tree-provider';
export type { ExecutionTreeNode } from './execution-tree-provider';
export {
  FailurePolicySettingValue,
  buildCollectionRunReportModel,
  buildLiveCollectionRunReportModel,
  formatDuration as formatReportDuration,
  normalizeFailurePolicySetting,
  parseCollectionRunReportMessage,
  renderCollectionRunReportHtml,
  resolveFailurePolicyForRun,
} from './run-report-html';
export type {
  CollectionRunReportInboundMessage,
  CollectionRunReportModel,
  CollectionRunReportOutboundMessage,
  CollectionRunReportRow,
  FailurePolicySettingValue as FailurePolicySetting,
} from './run-report-html';
