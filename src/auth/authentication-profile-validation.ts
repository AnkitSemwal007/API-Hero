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
const FORBIDDEN_IDS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

/**
 * Validates raw profile configuration deterministically.
 *
 * Invalid entries are skipped with a structured issue rather than throwing.
 * Duplicate-id policy: every entry sharing a colliding id is excluded, and one
 * `duplicate-id` issue is reported, so no arbitrary shadowing winner is chosen.
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
