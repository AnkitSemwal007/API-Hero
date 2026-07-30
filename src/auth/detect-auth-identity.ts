/**
 * Detects a presentation-only identity hint from a JSON response body.
 * Never returns secret material — only email/username/sub-style claims.
 */

import { readJsonPathValue } from './detect-auth-tokens';

const IDENTITY_PATHS = [
  'email',
  'user.email',
  'data.email',
  'data.user.email',
  'preferred_username',
  'user.preferred_username',
  'username',
  'user.username',
  'user.name',
  'name',
  'sub',
  'user.id',
  'userId',
  'id',
] as const;

/**
 * Returns a short identity label when a known claim is present, else undefined.
 * Values that look like JWTs or long opaque tokens are skipped.
 */
export function detectAuthIdentityFromJson(body: unknown): string | undefined {
  if (body === null || body === undefined || typeof body !== 'object') {
    return undefined;
  }
  for (const path of IDENTITY_PATHS) {
    const value = readJsonPathValue(body, path);
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 128) {
      continue;
    }
    if (looksLikeOpaqueToken(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return undefined;
}

function looksLikeOpaqueToken(value: string): boolean {
  if (value.split('.').length === 3 && value.length > 40) {
    return true;
  }
  if (/^[A-Za-z0-9_-]{40,}$/u.test(value) && !value.includes('@')) {
    return true;
  }
  return false;
}
