import { redactUrlUserinfo } from '../shared';
import type { AssertionValue } from './models';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
]);

const SECRETISH =
  /(?:bearer\s+[a-z0-9._~+/=-]+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S+)/giu;

/** Masks operator values on sensitive-header expect lines (Authorization, etc.). */
const SENSITIVE_HEADER_EXPECT =
  /(\bheader\s+(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey)\s*(?:==|!=|contains|=|eq)\s+)(?:"[^"]*"|'[^']*'|\S+)/giu;

export const MASKED_ASSERTION_VALUE = '••••••••';

/** True when a header name must never appear with its real value in reports. */
export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.trim().toLowerCase());
}

/** Redacts URLs and token-like substrings from free-form report text. */
export function maskAssertionText(value: string): string {
  let next = redactUrlUserinfo(value);
  next = next.replace(SECRETISH, MASKED_ASSERTION_VALUE);
  next = next.replace(SENSITIVE_HEADER_EXPECT, `$1${MASKED_ASSERTION_VALUE}`);
  return next;
}

/** Formats an assertion value for display, masking sensitive content. */
export function formatAssertionValue(
  value: AssertionValue | unknown,
  options: { readonly headerName?: string } = {},
): string {
  if (
    options.headerName !== undefined &&
    isSensitiveHeaderName(options.headerName)
  ) {
    return MASKED_ASSERTION_VALUE;
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(maskAssertionText(value));
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return maskAssertionText(JSON.stringify(value));
  } catch {
    return '[unserializable]';
  }
}

/**
 * Formats a header value for assertion reports. Sensitive headers are always
 * masked — never dump Authorization values.
 */
export function formatHeaderValueForReport(
  name: string,
  value: string | undefined,
): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (isSensitiveHeaderName(name)) {
    return MASKED_ASSERTION_VALUE;
  }
  return JSON.stringify(maskAssertionText(value));
}
