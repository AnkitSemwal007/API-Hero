/**
 * Framework-free OpenAPI import domain.
 * VS Code adapters live under `./vscode` and must not be imported here.
 */

export type {
  GeneratedApiFile,
  GeneratedAuthProfile,
  GeneratedEnvironment,
  GeneratedVariable,
  ImportArtifacts,
  ImportCancellation,
  ImportDiagnostic,
  ImportDiagnosticSeverity,
  ImportLimits,
  ImportProgressEvent,
  ImportProgressPhase,
  ImportSummary,
} from './models';
export { DEFAULT_IMPORT_LIMITS } from './models';

export {
  detectSpecFormat,
  evaluateImportSourceSize,
  loadSpecification,
} from './loader';
export type {
  ImportSourceSizeCheck,
  LoadResult,
  LoadedSpecification,
  SpecFormat,
} from './loader';

export {
  maskImportSecretText,
  isSensitiveName,
  placeholderForSensitiveName,
  scrubSensitiveExampleValue,
  resolveUnderTarget,
  safeJoinRelative,
  sanitizePathSegment,
  slugifyIdentifier,
  MASKED_IMPORT_VALUE,
} from './sanitize';

export {
  createOpenApiImportRegistry,
  runImportPipeline,
} from './pipeline';
export type {
  ImportPipelineOptions,
  ImportPipelineResult,
  SettingsPatch,
} from './pipeline';

export {
  writeImportArtifacts,
} from './workspace-writer';
export type {
  WorkspaceFileWriter,
  WriteArtifactsOptions,
  WriteArtifactsResult,
} from './workspace-writer';

export {
  OpenApiImportProvider,
  SpecificationImportProviderRegistry,
  createDefaultImportProviderRegistry,
} from './providers';
export type {
  SpecificationFormatId,
  SpecificationImportContext,
  SpecificationImportProvider,
} from './providers';

export {
  generateAuthProfiles,
  generateCollectionFiles,
  generateEnvironments,
  generateRequestSource,
  buildSchemaSample,
} from './generators';

export {
  OPENAPI_HTTP_METHODS,
  OpenApiRefResolver,
  isReference,
  isSupportedOpenApiVersion,
  parseOpenApiDocument,
  validateOpenApiDocument,
} from './openapi';
export type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiPathItem,
  ParseOpenApiResult,
  ValidateOpenApiResult,
} from './openapi';
