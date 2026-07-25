/**
 * Re-export shim — canonical implementation lives in extraction/shared.
 * Kept so existing assertion imports continue to resolve.
 */
export {
  resolveJsonPath,
  type JsonPathResolution,
} from '../extraction/shared/json-path';
