import { isSensitiveHttpHeaderName, redactUrlUserinfo } from '../shared';
import type { AssertionValue } from './models';

/**
 * Masks operator values on sensitive-header expect lines.
 * Header names must stay aligned with {@link isSensitiveHttpHeaderName}.
 */
const SENSITIVE_HEADER_EXPECT =
  /(\bheader\s+(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token)\s*(?:==|!=|contains|=|eq)\s+)(?:"[^"]*"|'[^']*'|\S+)/giu;

const SECRETISH =
  /(?:bearer\s+[a-z0-9._~+/=-]+|password\s*[:=]\s*\S+|(?<![A-Za-z0-9_-])token\s*[:=]\s*\S+)/giu;

/** Leaf / path segments that look like secrets in JSON body assertions. */
const SENSITIVE_JSON_PATH_SEGMENT =
  /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|secret|api[_-]?key|token)$/iu;

export const MASKED_ASSERTION_VALUE = '••••••••';

/** True when a header name must never appear with its real value in reports. */
export function isSensitiveHeaderName(name: string): boolean {
  return isSensitiveHttpHeaderName(name);
}

/** True when a body JSON path leaf looks secret-like (access_token, api_key, …). */
export function isSensitiveAssertionPath(path: string | undefined): boolean {
  if (path === undefined || path.trim().length === 0) {
    return false;
  }
  const segments = path.split(/[.[\]]+/u).filter((part) => part.length > 0);
  const leaf = segments[segments.length - 1] ?? path;
  return SENSITIVE_JSON_PATH_SEGMENT.test(leaf);
}

/** Redacts URLs and token-like substrings from free-form report text. */
export function maskAssertionText(value: string): string {
  let next = redactUrlUserinfo(value);
  // Header expect lines first — SECRETISH's `token …=` pattern must not
  // chew through names like `x-auth-token` before this runs.
  next = next.replace(SENSITIVE_HEADER_EXPECT, `$1${MASKED_ASSERTION_VALUE}`);
  next = next.replace(SECRETISH, MASKED_ASSERTION_VALUE);
  return next;
}

/** Formats an assertion value for display, masking sensitive content. */
export function formatAssertionValue(
  value: AssertionValue | unknown,
  options: {
    readonly headerName?: string;
    /** Body JSON path (relative to root) when asserting a secret-like field. */
    readonly path?: string;
  } = {},
): string {
  if (
    options.headerName !== undefined &&
    isSensitiveHeaderName(options.headerName)
  ) {
    return MASKED_ASSERTION_VALUE;
  }
  if (isSensitiveAssertionPath(options.path)) {
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
