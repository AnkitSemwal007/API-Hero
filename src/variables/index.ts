export type {
  RequestResolutionResult,
  ResolvedVariableSnapshot,
  VariableAnalysis,
  VariableResolutionContext,
  VariableResolutionError,
  VariableResolutionErrorCode,
  VariableResolver,
} from './variable-resolver';
export {
  DefaultVariableResolver,
  MASKED_VARIABLE_VALUE,
  VARIABLE_DIAGNOSTIC_CODES,
  buildResolvedVariableSnapshots,
  maskVariableValue,
} from './variable-resolver';
export { EnvironmentManager, normalizeOptionalEnvironmentId } from './environment-manager';
export type {
  EnvironmentChangeDisposable,
  EnvironmentSnapshot,
  VariableConfigurationRepository,
  VariableConfigurationSnapshot,
} from './environment-manager';
export { extractDocumentVariables } from './document-variable-adapter';
export type { DocumentVariableExtraction } from './document-variable-adapter';
export {
  VariableCompletionService,
  fuzzyMatches,
  fuzzyScore,
  formatVariableCompletionDetail,
} from './variable-completion-service';
export type {
  VariableCompletionContext,
  VariableCompletionItem,
  VariableHoverInfo,
} from './variable-completion-service';
export {
  VARIABLE_PRECEDENCE_LEGEND,
  VARIABLE_PRECEDENCE_ORDER_LABELS,
  VARIABLE_SCOPE_UI,
  formatVariableScopeLabel,
  getVariableScopeUi,
} from './variable-scope-ui';
export {
  type RunVariableStore,
  InMemoryRunVariableStore,
} from './run-variable-store';
export {
  COLLECTION_VARIABLES_SCHEMA_VERSION,
  emptyCollectionVariablesDocument,
  parseCollectionVariablesDocument,
  serializeCollectionVariablesDocument,
} from './collection-variables-document';
export type { CollectionVariablesDocument } from './collection-variables-document';
export {
  FilesystemCollectionVariableStore,
  collectionVariablesDocumentPath,
} from './collection-variable-store';
export type {
  CollectionVariableStore,
  CollectionVariableStorePorts,
} from './collection-variable-store';
