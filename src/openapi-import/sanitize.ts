/**
 * Path sanitization and secret masking for OpenAPI import.
 * Specs are untrusted; generated paths must stay under the target root.
 */

const SECRETISH =
  /(?:bearer\s+[a-z0-9._~+/=-]+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S+|api[_-]?key\s*[:=]\s*\S+)/giu;

const SENSITIVE_HEADER =
  /(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/giu;

const SENSITIVE_HEADER_EXACT = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

export const MASKED_IMPORT_VALUE = '[redacted]';

/** Redacts token-like substrings from diagnostics and summary text. */
export function maskImportSecretText(value: string): string {
  let next = value;
  next = next.replace(SENSITIVE_HEADER, `$1: ${MASKED_IMPORT_VALUE}`);
  next = next.replace(SECRETISH, MASKED_IMPORT_VALUE);
  next = next.replace(/\/\/([^/?#\s]*@)/gu, '//***@');
  return next.slice(0, 2_000);
}

/**
 * True when a header/parameter name must never receive a literal example value
 * in generated `.api` content (Authorization, Cookie, *token*, *api-key*, etc.).
 */
export function isSensitiveName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (SENSITIVE_HEADER_EXACT.has(normalized)) {
    return true;
  }
  const compact = normalized.replace(/[_-]/gu, '');
  return (
    compact.includes('apikey') ||
    compact.includes('token') ||
    compact.includes('secret') ||
    compact.includes('password')
  );
}

/** Placeholder used instead of literal sensitive header/parameter examples. */
export function placeholderForSensitiveName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'authorization' || normalized === 'proxy-authorization') {
    return '{{token}}';
  }
  if (normalized === 'cookie' || normalized === 'set-cookie') {
    return '{{cookie}}';
  }
  const slug = name
    .trim()
    .replace(/[^\w.-]+/gu, '_')
    .replace(/-/gu, '_');
  const varName = /^[A-Za-z_]/u.test(slug) ? slug : `secret_${slug}`;
  return `{{${varName}}}`;
}

/**
 * Cheap scrub of body examples: blank sensitive object keys and clear
 * Bearer/Basic credential blobs. Does not attempt deep secret detection.
 */
export function scrubSensitiveExampleValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^\s*(Bearer|Basic)\s+\S+/iu.test(value)) {
      return '';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveExampleValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveName(key)) {
        result[key] = typeof entry === 'string' ? '' : null;
      } else {
        result[key] = scrubSensitiveExampleValue(entry);
      }
    }
    return result;
  }
  return value;
}

/**
 * Sanitizes a single path segment for use under the import target.
 * Rejects empty, `.`, `..`, separators, and control characters.
 */
export function sanitizePathSegment(raw: string, fallback = 'item'): string {
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    return fallback;
  }
  const slug = trimmed
    .replace(/[^\w.-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
  if (
    slug.length === 0 ||
    slug === '.' ||
    slug === '..' ||
    slug.toLowerCase() === 'con' ||
    slug.toLowerCase() === 'prn' ||
    slug.toLowerCase() === 'aux' ||
    slug.toLowerCase() === 'nul'
  ) {
    return fallback;
  }
  return slug;
}

/**
 * Joins relative segments under a logical root using POSIX separators.
 * Returns `undefined` when any segment would escape the root.
 */
export function safeJoinRelative(
  ...segments: readonly string[]
): string | undefined {
  const parts: string[] = [];
  for (const segment of segments) {
    const normalized = segment.replace(/\\/gu, '/');
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//u.test(normalized) ||
      normalized.includes('\0')
    ) {
      return undefined;
    }
    for (const part of normalized.split('/')) {
      if (part.length === 0 || part === '.') {
        continue;
      }
      if (part === '..') {
        return undefined;
      }
      parts.push(sanitizePathSegment(part));
    }
  }
  return parts.join('/');
}

/**
 * Resolves a relative path against an absolute target root.
 * Returns `undefined` when the result would escape `targetRoot`.
 */
export function resolveUnderTarget(
  targetRoot: string,
  relativePath: string,
): string | undefined {
  const safeRelative = safeJoinRelative(relativePath);
  if (safeRelative === undefined) {
    return undefined;
  }
  const root = targetRoot.replace(/[/\\]+$/u, '');
  const combined = `${root}/${safeRelative}`.replace(/\\/gu, '/');
  const rootNormalized = root.replace(/\\/gu, '/').toLowerCase();
  const combinedNormalized = combined.toLowerCase();
  if (
    combinedNormalized !== rootNormalized &&
    !combinedNormalized.startsWith(`${rootNormalized}/`)
  ) {
    return undefined;
  }
  return combined;
}

/** Slug suitable for environment ids, profile ids, and folder names. */
export function slugifyIdentifier(value: string, fallback = 'api'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 64);
  return slug.length > 0 ? slug : fallback;
}
