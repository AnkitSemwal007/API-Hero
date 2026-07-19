export type {
  RequestResolutionResult,
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
  maskVariableValue,
} from './variable-resolver';
export { EnvironmentManager } from './environment-manager';
export type {
  EnvironmentChangeDisposable,
  EnvironmentSnapshot,
  VariableConfigurationRepository,
  VariableConfigurationSnapshot,
} from './environment-manager';
export { extractDocumentVariables } from './document-variable-adapter';
export type { DocumentVariableExtraction } from './document-variable-adapter';
