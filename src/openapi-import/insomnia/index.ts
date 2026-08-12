/**
 * Insomnia export domain exports (framework-free).
 */

export {
  isInsomniaExportRoot,
  parseInsomniaExport,
  isPlainObject,
  safeOwnEntries,
  safeOwnString,
  readResourceType,
} from './parse';
export type { ParseInsomniaResult } from './parse';

export { mapInsomniaAuth, sanitizeHeaderValue } from './map-auth';
export type { MapAuthResult, MapAuthOptions } from './map-auth';

export {
  mapInsomniaEnvironmentData,
  buildInsomniaEnvironment,
  preserveTemplateValue,
  rewriteInsomniaEnvRefs,
  sanitizeVarName,
} from './map-variables';
export type {
  MappedVariable,
  MapVariablesResult,
  RewriteInsomniaEnvRefsResult,
} from './map-variables';

export {
  mapInsomniaRequest,
  collectScriptDiagnostics,
} from './map-request';
export type { MapRequestInput, MapRequestResult } from './map-request';

export { mapInsomniaCollection } from './map-collection';
export type {
  MapCollectionContext,
  MapCollectionResult,
} from './map-collection';

export {
  INSOMNIA_IMPORT_LIMITS,
  INSOMNIA_SUPPORTED_EXPORT_FORMATS,
} from './types';
export type {
  ParsedInsomniaExport,
  InsomniaExportLike,
  InsomniaResourceLike,
} from './types';
