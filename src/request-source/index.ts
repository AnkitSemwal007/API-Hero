/**
 * Request-source serialization — pure `.api` text generation (no vscode).
 * Also projects parsed documents into {@link RequestSourceDocument} for the
 * Custom Text Editor (still no vscode).
 */

export type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceExtractionRule,
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
  formatExtractionRule,
} from './serialize';

export {
  GRAPHQL_STARTER_QUERY,
  compileGraphqlEditorEnvelope,
  isGraphqlProtocol,
  parseGraphqlEditorEnvelope,
} from './graphql-envelope';
export type { GraphqlEditorEnvelope } from './graphql-envelope';
