/**
 * Postman Collection domain exports (framework-free).
 */

export {
  isPostmanCollectionRoot,
  parsePostmanCollection,
  isPlainObject,
  safeOwnEntries,
  safeOwnString,
} from './parse';
export type { ParsePostmanResult } from './parse';

export { mapPostmanAuth, sanitizeHeaderValue, readAuthParams } from './map-auth';
export type { MapAuthResult, MapAuthOptions } from './map-auth';

export {
  mapPostmanVariables,
  buildPostmanEnvironment,
  preserveTemplateValue,
  sanitizeVarName,
} from './map-variables';
export type { MappedVariable, MapVariablesResult } from './map-variables';

export {
  mapPostmanRequest,
  collectScriptDiagnostics,
} from './map-request';
export type { MapRequestInput, MapRequestResult } from './map-request';

export { mapPostmanCollection } from './map-collection';
export type {
  MapCollectionContext,
  MapCollectionResult,
} from './map-collection';

export { POSTMAN_IMPORT_LIMITS } from './types';
export type {
  ParsedPostmanCollection,
  PostmanCollectionLike,
} from './types';
