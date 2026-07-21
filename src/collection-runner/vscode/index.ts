/** VS Code-specific adapters for Collection Runner. */
export { registerCollectionRunner } from './register-collection-runner';
export type { RegisterCollectionRunnerOptions } from './register-collection-runner';
export {
  VsCodeCollectionRunProgress,
  VsCodeCollectionRunSourceReader,
  formatRunSummaryMessage,
  withCollectionRunProgress,
} from './progress-ui';
export { CollectionRunReportPanel } from './run-report-panel';
export type { CollectionRunReportPanelActions } from './run-report-panel';
export {
  FailurePolicySettingValue,
  buildCollectionRunReportModel,
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
