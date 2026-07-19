import { HTTP_METHODS as SHARED_HTTP_METHODS } from '../types';

/** VS Code language identifier contributed for API Runner documents. */
export const API_LANGUAGE_ID = 'api';

/** HTTP methods recognized by API Runner language features. */
export const HTTP_METHODS = SHARED_HTTP_METHODS;

/** Built-in request directives. */
export const DIRECTIVES = [
  '@connection',
  '@auth',
  '@timeout',
  '@name',
  '@description',
  '@tag',
  '@variable',
  '@sensitive-variable',
] as const;

/** Directives that may occur once in a request block. */
export const SINGLETON_DIRECTIVES = [
  '@connection',
  '@auth',
  '@timeout',
  '@name',
  '@description',
] as const;

/** Frequently used HTTP header names offered by completion. */
export const HTTP_HEADERS = [
  'Accept',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-None-Match',
  'Origin',
  'Referer',
  'User-Agent',
  'X-API-Key',
] as const;

/** Common media types offered by completion. */
export const MIME_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
] as const;

/** Stable diagnostic identifiers. */
export const LANGUAGE_DIAGNOSTIC_CODES = {
  unknownMethod: 'api-runner.unknown-method',
  duplicateDirective: 'api-runner.duplicate-directive',
  invalidDirective: 'api-runner.invalid-directive',
  missingUrl: 'api-runner.missing-url',
} as const;

/** Source label used for API Runner diagnostics. */
export const LANGUAGE_DIAGNOSTIC_SOURCE = 'API Runner';

/** Documentation shown for language keywords. */
export const HOVER_DOCUMENTATION: Readonly<Record<string, string>> = {
  GET: 'Retrieves a representation of the target resource.',
  POST: 'Submits data to the target resource.',
  PUT: 'Replaces the target resource with the supplied representation.',
  PATCH: 'Applies a partial modification to the target resource.',
  DELETE: 'Deletes the target resource.',
  HEAD: 'Retrieves response headers without a response body.',
  OPTIONS: 'Retrieves communication options for the target resource.',
  '@connection': 'Selects the connection used by this request block.',
  '@auth': 'Configures authentication for this request block.',
  '@timeout': 'Sets the request timeout in milliseconds.',
  '@name': 'Sets the request name shown in the Outline view.',
  '@description': 'Adds descriptive metadata to the request.',
  '@tag': 'Adds a searchable tag to the request.',
  '@variable': 'Defines a document variable using name=value.',
  '@sensitive-variable': 'Defines a masked document variable using name=value.',
};
