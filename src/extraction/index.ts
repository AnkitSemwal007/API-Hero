/**
 * Framework-free Response Variable Extraction domain.
 * VS Code adapters live under `./vscode` and must not be imported here.
 */

export {
  resolveJsonPath,
  type JsonPathResolution,
} from './shared/json-path';
export type {
  VariableWriteTargetScope,
  VariableWriteRequest,
  VariableWriteResult,
  RuntimeOverlayIdentity,
  ExtractionSourceKind,
  ExtractionSource,
  ExtractionWhen,
  ExtractionRule,
  ExtractionOutcomeKind,
  ExtractionOutcome,
  ExtractionReport,
  ExtractionContext,
  ExtractionEngine,
  VariableWriter,
  ResponseExtractor,
  ExtractorRegistry,
} from './models';
export { NoOpVariableWriter } from './variable-writer';
export {
  type RuntimeVariableOverlay,
  InMemoryRuntimeVariableOverlay,
} from './runtime-overlay';
export {
  parseExtractDirective,
  type ParseExtractDirectiveInput,
  type ParseExtractDirectiveResult,
} from './parse-extract';
export {
  extractExtractionRulesForDocument,
  extractExtractionRulesForOffset,
  type RequestExtractionRules,
  type ExtractExtractionRulesOptions,
} from './extract-rules';
export { coerceExtractionValue } from './value-coercion';
export { DefaultExtractionEngine } from './engine';
export {
  createDefaultExtractorRegistry,
} from './extractors/registry';
export { JsonPathExtractor } from './extractors/json-path-extractor';
export { HeaderExtractor } from './extractors/header-extractor';
export { StatusExtractor } from './extractors/status-extractor';
export {
  CompositeVariableWriter,
  type CompositeVariableWriterOptions,
} from './composite-variable-writer';
export {
  EnvironmentVariableWriter,
  type EnvironmentWritePorts,
  type EnvironmentWriteState,
  type EnvironmentWriteEnvironment,
  type EnvironmentWriteVariable,
} from './environment-variable-writer';
export {
  CollectionVariableWriter,
  type CollectionVariableWriterOptions,
} from './collection-variable-writer';
export { requestKeyFor } from './request-key';
