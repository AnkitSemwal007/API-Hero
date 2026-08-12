/**
 * Canonical sensitive HTTP header names for UI presentation, assertions,
 * MCP redaction, and cURL generation. Keep this set the single source of truth.
 */

/** Lowercase header names whose values must never appear in cleartext in UI/exports. */
export const SENSITIVE_HTTP_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
]);

/** True when `name` is a well-known sensitive HTTP header (case-insensitive). */
export function isSensitiveHttpHeaderName(name: string): boolean {
  return SENSITIVE_HTTP_HEADER_NAMES.has(name.trim().toLowerCase());
}
