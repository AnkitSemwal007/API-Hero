/**
 * Request-source serialization — pure `.api` text generation (no vscode).
 * Also projects parsed documents into {@link RequestSourceDocument} for the
 * Custom Text Editor (still no vscode).
 */

export type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceHeader,
  RequestSourceMethod,
  RequestSourceQueryParam,
  RequestSourceVariable,
} from './models';

export type { ParseRequestSourceResult } from './document-to-source';

export {
  documentToRequestSource,
  parseSourceToRequestDocument,
} from './document-to-source';

export {
  serializePlaceholderRequest,
  serializeRequestDocument,
} from './serialize';
