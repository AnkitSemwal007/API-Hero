import type { AuthenticationProfile } from '../models';
import { cloneDetached, deepFreeze } from '../shared';

/** Structured, secret-free classification of a rejected profile entry. */
export type AuthenticationProfileIssueCode =
  | 'malformed-id'
  | 'duplicate-id'
  | 'invalid-provider';

/**
 * A profile configuration problem carrying identifiers and field names only.
 * It never contains credential values or resolved secret material.
 */
export interface AuthenticationProfileIssue {
  readonly code: AuthenticationProfileIssueCode;
  /** Zero-based position in the raw configuration array. */
  readonly index: number;
  /** Present only when the offending entry exposes a usable string id. */
  readonly profileId?: string;
  readonly message: string;
}

/**
 * The single validation result shared by the manager, resolver context, and
 * language diagnostics. `profiles` are cloned, immutable, and unambiguous.
 */
export interface AuthenticationProfileValidation {
  readonly profiles: readonly AuthenticationProfile[];
  readonly issues: readonly AuthenticationProfileIssue[];
}

/** Prototype-sensitive id values are rejected to avoid pollution ambiguity. */
export const FORBIDDEN_IDS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

/** Settings-friendly profile ids accepted by Auth Manager commits. */
export const AUTH_PROFILE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

/** Built-in providers accepted by Auth Manager commit validation. */
export const AUTH_PROVIDER_IDS = ['none', 'basic', 'bearer', 'apiKey'] as const;

export type AuthenticationCommitProviderId = (typeof AUTH_PROVIDER_IDS)[number];

/** Secret field metadata required by a built-in provider (empty for none). */
export interface AuthenticationSecretFieldMeta {
  readonly field: string;
  readonly label: string;
}

/** Draft profile shape validated before Auth Manager writes settings. */
export interface AuthenticationProfileCommitDraft {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: string;
}

export type AuthenticationProfileCommitIssueCode =
  | 'empty-id'
  | 'invalid-id-format'
  | 'duplicate-id'
  | 'missing-label'
  | 'unsupported-provider'
  | 'missing-api-key-name'
  | 'invalid-api-key-location'
  | 'unknown-default';

/**
 * A commit-time profile problem. Messages match Auth Manager user-facing copy.
 * Never contains credential values.
 */
export interface AuthenticationProfileCommitIssue {
  readonly code: AuthenticationProfileCommitIssueCode;
  /** Zero-based profile index when the issue targets a profile row. */
  readonly index?: number;
  readonly profileId?: string;
  readonly message: string;
}

export interface AuthenticationProfileCommitValidation {
  readonly issues: readonly AuthenticationProfileCommitIssue[];
}

/** True when a profile id is non-empty, not forbidden, and matches the pattern. */
export function isValidAuthenticationProfileId(id: string): boolean {
  return (
    id.length > 0 &&
    !FORBIDDEN_IDS.has(id) &&
    AUTH_PROFILE_ID_PATTERN.test(id)
  );
}

/** True when the value is a built-in Auth Manager provider id. */
export function isAuthenticationCommitProviderId(
  value: unknown,
): value is AuthenticationCommitProviderId {
  return (
    typeof value === 'string' &&
    (AUTH_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/**
 * Secret field names and labels for a provider.
 * Unknown providers return an empty list.
 */
export function secretFieldsForProvider(
  providerId: string,
): readonly AuthenticationSecretFieldMeta[] {
  switch (providerId) {
    case 'none':
      return [];
    case 'basic':
      return [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password' },
      ];
    case 'bearer':
      return [{ field: 'token', label: 'Token' }];
    case 'apiKey':
      return [{ field: 'value', label: 'API key value' }];
    default:
      return [];
  }
}

/** Secret field names only — shared by diagnostics and availability checks. */
export function secretFieldNamesForProvider(
  providerId: string,
): readonly string[] {
  return secretFieldsForProvider(providerId).map((entry) => entry.field);
}

/**
 * Validates raw profile configuration deterministically (load/runtime).
 *
 * Invalid entries are skipped with a structured issue rather than throwing.
 * Duplicate-id policy: every entry sharing a colliding id is excluded, and one
 * `duplicate-id` issue is reported, so no arbitrary shadowing winner is chosen.
 *
 * Intentionally lenient: does not enforce id pattern, label, or apiKey shape.
 */
export function validateAuthenticationProfiles(
  raw: readonly AuthenticationProfile[],
): AuthenticationProfileValidation {
  const issues: AuthenticationProfileIssue[] = [];
  const byId = new Map<
    string,
    { readonly index: number; readonly profile: AuthenticationProfile }[]
  >();
  const order: string[] = [];

  raw.forEach((profile, index) => {
    const id = (profile as { readonly id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0 || FORBIDDEN_IDS.has(id)) {
      issues.push({
        code: 'malformed-id',
        index,
        message: `Authentication profile at index ${index} has an invalid id.`,
      });
      return;
    }
    const providerId = (profile as { readonly providerId?: unknown }).providerId;
    if (typeof providerId !== 'string' || providerId.length === 0) {
      issues.push({
        code: 'invalid-provider',
        index,
        profileId: id,
        message: `Authentication profile "${id}" has an invalid providerId.`,
      });
      return;
    }
    if (!byId.has(id)) {
      byId.set(id, []);
      order.push(id);
    }
    byId.get(id)!.push({ index, profile });
  });

  const profiles: AuthenticationProfile[] = [];
  for (const id of order) {
    const entries = byId.get(id)!;
    if (entries.length > 1) {
      issues.push({
        code: 'duplicate-id',
        index: entries[0]!.index,
        profileId: id,
        message: `Authentication profile "${id}" is configured more than once.`,
      });
      continue;
    }
    profiles.push(cloneDetached(entries[0]!.profile));
  }

  issues.sort((left, right) =>
    left.index - right.index || left.code.localeCompare(right.code));

  return deepFreeze({ profiles, issues });
}

/**
 * Strict validation for Auth Manager commits / drafts.
 *
 * Returns every issue in encounter order. Callers that show a single error
 * (Auth Manager panel) use the first issue message — identical to prior UI copy.
 */
export function validateAuthenticationProfilesForCommit(
  draft: {
    readonly profiles: readonly AuthenticationProfileCommitDraft[];
    readonly defaultProfileId?: string;
  },
): AuthenticationProfileCommitValidation {
  const issues: AuthenticationProfileCommitIssue[] = [];
  const ids = new Set<string>();

  draft.profiles.forEach((profile, index) => {
    const id = profile.id.trim();
    if (id.length === 0) {
      issues.push({
        code: 'empty-id',
        index,
        message: 'Profile id is required.',
      });
      return;
    }
    if (FORBIDDEN_IDS.has(id) || !AUTH_PROFILE_ID_PATTERN.test(id)) {
      issues.push({
        code: 'invalid-id-format',
        index,
        profileId: id,
        message: `Invalid profile id "${id}".`,
      });
      return;
    }
    if (ids.has(id)) {
      issues.push({
        code: 'duplicate-id',
        index,
        profileId: id,
        message: `Duplicate profile id "${id}".`,
      });
      return;
    }
    ids.add(id);

    if (profile.label.trim().length === 0) {
      issues.push({
        code: 'missing-label',
        index,
        profileId: id,
        message: 'Profile label is required.',
      });
      return;
    }

    if (!isAuthenticationCommitProviderId(profile.providerId)) {
      issues.push({
        code: 'unsupported-provider',
        index,
        profileId: id,
        message: `Unsupported provider "${String(profile.providerId)}".`,
      });
      return;
    }

    if (profile.providerId === 'apiKey') {
      const name = profile.apiKeyName?.trim() ?? '';
      if (name.length === 0) {
        issues.push({
          code: 'missing-api-key-name',
          index,
          profileId: id,
          message:
            `API key profile "${id}" requires a header or query name.`,
        });
        return;
      }
      if (
        profile.apiKeyLocation !== 'header' &&
        profile.apiKeyLocation !== 'query'
      ) {
        issues.push({
          code: 'invalid-api-key-location',
          index,
          profileId: id,
          message:
            `API key profile "${id}" requires location header or query.`,
        });
      }
    }
  });

  if (
    draft.defaultProfileId !== undefined &&
    !ids.has(draft.defaultProfileId)
  ) {
    issues.push({
      code: 'unknown-default',
      profileId: draft.defaultProfileId,
      message: `Unknown default profile "${draft.defaultProfileId}".`,
    });
  }

  return deepFreeze({ issues });
}
