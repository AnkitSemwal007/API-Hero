import { redactUrlUserinfo } from '../shared';

/**
 * Ensures a presentation URL is safe to persist.
 * Applies userinfo redaction as defense-in-depth even when callers already
 * supply `presentationUrl`.
 */
export function sanitizeHistoryUrl(url: string): string {
  return redactUrlUserinfo(url.trim());
}

/**
 * Strips patterns that commonly leak credentials from error messages.
 * Keeps classification codes and generic transport wording intact.
 */
export function sanitizeHistoryErrorMessage(message: string): string {
  let sanitized = message;
  sanitized = sanitized.replace(
    /(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/giu,
    '$1: [redacted]',
  );
  sanitized = sanitized.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/giu,
    '$1 [redacted]',
  );
  sanitized = sanitized.replace(
    /\/\/([^/?#\s]*@)/gu,
    '//***@',
  );
  return sanitized.slice(0, 500);
}

/** Returns true when a value looks like a forbidden secret-bearing field name. */
export function isForbiddenHistoryFieldName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[_-]/gu, '');
  return (
    normalized.includes('authorization') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized === 'cookie' ||
    normalized === 'cookies' ||
    normalized.includes('apikey')
  );
}
