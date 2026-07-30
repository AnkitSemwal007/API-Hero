/**
 * Detects likely authentication token fields in a JSON response body.
 * Core module — no VS Code APIs; never logs values.
 */

export type DetectedAuthTokenKind =
  | 'access_token'
  | 'refresh_token'
  | 'id_token'
  | 'expires_in'
  | 'expires_at'
  | 'generic_token';

export interface DetectedAuthTokenCandidate {
  /** Dot-path relative to the JSON root (e.g. `access_token`, `data.accessToken`). */
  readonly path: string;
  readonly kind: DetectedAuthTokenKind;
  /** Higher is better. */
  readonly rank: number;
  /** Leaf key name (secret-free). */
  readonly key: string;
}

const ACCESS_KEYS = new Set([
  'access_token',
  'accesstoken',
  'token',
  'jwt',
  'id_token',
  'idtoken',
  'auth_token',
  'authtoken',
  'bearer',
  'bearertoken',
]);

const REFRESH_KEYS = new Set([
  'refresh_token',
  'refreshtoken',
]);

const EXPIRES_IN_KEYS = new Set([
  'expires_in',
  'expiresin',
  'expiry',
  'ttl',
]);

const EXPIRES_AT_KEYS = new Set([
  'expires_at',
  'expiresat',
  'expiration',
  'expiry_date',
  'expirydate',
]);

/**
 * Walks a JSON value and returns ranked token-like field candidates.
 * Values are never included in the result.
 */
export function detectAuthTokensInJson(
  body: unknown,
): readonly DetectedAuthTokenCandidate[] {
  const candidates: DetectedAuthTokenCandidate[] = [];
  walk(body, '', candidates);
  return Object.freeze(
    [...candidates].sort((left, right) =>
      right.rank - left.rank || left.path.localeCompare(right.path)),
  );
}

/**
 * Reads a string/number value at a simple dotted path (`a.b.c`).
 * Array indices are not supported in Phase 1.
 */
export function readJsonPathValue(
  body: unknown,
  path: string,
): string | number | undefined {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const segments = trimmed.split('.').filter((segment) => segment.length > 0);
  let current: unknown = body;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === 'string' || typeof current === 'number') {
    return current;
  }
  return undefined;
}

function walk(
  value: unknown,
  path: string,
  out: DetectedAuthTokenCandidate[],
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walk(entry, path.length === 0 ? String(index) : `${path}.${index}`, out);
    });
    return;
  }
  if (typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    const kind = classifyKey(key);
    if (
      kind !== undefined &&
      (typeof child === 'string' || typeof child === 'number') &&
      String(child).length > 0
    ) {
      out.push({
        path: childPath,
        kind,
        rank: rankFor(kind, key, path),
        key,
      });
    }
    if (typeof child === 'object' && child !== null) {
      walk(child, childPath, out);
    }
  }
}

function classifyKey(key: string): DetectedAuthTokenKind | undefined {
  const normalized = key.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
  const lower = key.toLowerCase();
  if (REFRESH_KEYS.has(normalized) || REFRESH_KEYS.has(lower)) {
    return 'refresh_token';
  }
  if (EXPIRES_IN_KEYS.has(normalized) || EXPIRES_IN_KEYS.has(lower)) {
    return 'expires_in';
  }
  if (EXPIRES_AT_KEYS.has(normalized) || EXPIRES_AT_KEYS.has(lower)) {
    return 'expires_at';
  }
  if (normalized === 'idtoken' || lower === 'id_token') {
    return 'id_token';
  }
  if (
    ACCESS_KEYS.has(normalized) ||
    ACCESS_KEYS.has(lower) ||
    /token$/iu.test(key)
  ) {
    if (normalized === 'accesstoken' || lower === 'access_token') {
      return 'access_token';
    }
    if (normalized === 'token' || normalized === 'jwt' || normalized === 'bearer') {
      return 'access_token';
    }
    return 'generic_token';
  }
  return undefined;
}

function rankFor(
  kind: DetectedAuthTokenKind,
  key: string,
  parentPath: string,
): number {
  let rank = 0;
  switch (kind) {
    case 'access_token':
      rank = 100;
      break;
    case 'id_token':
      rank = 80;
      break;
    case 'generic_token':
      rank = 60;
      break;
    case 'refresh_token':
      rank = 50;
      break;
    case 'expires_in':
      rank = 40;
      break;
    case 'expires_at':
      rank = 35;
      break;
  }
  const lower = key.toLowerCase();
  if (lower === 'access_token' || lower === 'accesstoken') {
    rank += 20;
  }
  if (parentPath === '' || parentPath === 'data' || parentPath === 'result') {
    rank += 10;
  }
  return rank;
}
