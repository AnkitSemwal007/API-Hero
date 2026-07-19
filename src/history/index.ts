/**
 * Framework-free request history domain.
 * VS Code adapters live under `./vscode` and must not be imported here.
 */

export {
  HISTORY_SCHEMA_VERSION,
  HistoryExecutionStatus,
  createHistoryIdentifier,
  freezeHistoryEntry,
} from './models';
export type {
  ExecutionSummary,
  HistoryEntry,
  HistoryExecutionStatus as HistoryExecutionStatusType,
  HistoryExtensionBag,
  HistoryIdentifier,
  HistoryMetadata,
  HistorySourceLocation,
  HistoryStatistics,
} from './models';

export {
  InMemoryHistoryRepository,
  emptyHistoryDocument,
  migrateHistoryDocument,
  normalizeRetention,
} from './repository';
export type {
  HistoryDocument,
  HistoryListOptions,
  HistoryRepository,
} from './repository';

export { DefaultHistoryRecorder, buildHistoryEntry } from './recorder';
export type { HistoryCaptureInput, HistoryRecorder } from './recorder';

export {
  HistoryTimeGroup,
  classifyTimeGroup,
  computeHistoryStatistics,
  filterHistoryEntries,
  groupHistoryEntries,
  sortHistoryEntries,
} from './query';
export type {
  HistoryFilter,
  HistoryGroup,
  HistorySortOptions,
} from './query';

export {
  buildHistorySourceLocation,
  resolveHistoryRerunArgument,
  resolveRerunFromSource,
} from './rerun';
export type { HistoryRerunArgument } from './rerun';

export {
  isForbiddenHistoryFieldName,
  sanitizeHistoryErrorMessage,
  sanitizeHistoryUrl,
} from './sanitize';

export {
  FileHistoryStore,
  createFileHistoryStore,
} from './file-history-store';
export type { HistoryStorageFs } from './file-history-store';
