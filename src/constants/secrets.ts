/** Canonical Secret Storage key prefix for authentication profile fields. */
export const AUTH_SECRET_KEY_PREFIX = 'apiHero.auth.profile.';

/**
 * Legacy Secret Storage key prefix kept for lazy read/migrate and dual
 * `onDidChange` watching during the compatibility window.
 */
export const LEGACY_AUTH_SECRET_KEY_PREFIX = 'apiRunner.auth.profile.';

/**
 * Builds the canonical secret key for an authentication profile field.
 * Profile ids and field names are URI-encoded so separators stay unambiguous.
 */
export function authenticationSecretKey(
  profileId: string,
  field: string,
): string {
  return `${AUTH_SECRET_KEY_PREFIX}${encodeURIComponent(profileId)}.${encodeURIComponent(field)}`;
}

/**
 * Builds the legacy `apiRunner.auth.profile.*` key used before the namespace
 * migration. Prefer {@link authenticationSecretKey} for new writes.
 */
export function legacyAuthenticationSecretKey(
  profileId: string,
  field: string,
): string {
  return `${LEGACY_AUTH_SECRET_KEY_PREFIX}${encodeURIComponent(profileId)}.${encodeURIComponent(field)}`;
}
