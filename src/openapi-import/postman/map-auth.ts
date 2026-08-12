/**
 * Maps Postman auth blocks to AuthenticationProfile / @auth ids.
 * Secrets are never copied — profiles use `{ kind: 'secret' }` placeholders.
 */

import type { AuthenticationProfile } from '../../models';
import type { GeneratedAuthProfile, ImportDiagnostic } from '../models';
import {
  isSensitiveName,
  maskImportSecretText,
  placeholderForSensitiveName,
  slugifyIdentifier,
} from '../sanitize';
import { isPlainObject } from './parse';
import type { PostmanAuthLike } from './types';

export interface MapAuthResult {
  readonly profile?: GeneratedAuthProfile;
  readonly profileId?: string;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export interface MapAuthOptions {
  readonly apiSlug: string;
  readonly labelHint: string;
  readonly path: string;
  readonly existingIds: ReadonlySet<string>;
  readonly pendingIds: ReadonlySet<string>;
}

/**
 * Maps a Postman `auth` object to an API Hero auth profile when supported.
 * Unsupported types emit `postman-unsupported-auth` warnings.
 */
export function mapPostmanAuth(
  auth: unknown,
  options: MapAuthOptions,
): MapAuthResult {
  const diagnostics: ImportDiagnostic[] = [];

  if (auth === undefined || auth === null) {
    return { diagnostics };
  }
  if (!isPlainObject(auth)) {
    diagnostics.push({
      code: 'postman-invalid-auth',
      severity: 'warning',
      path: options.path,
      message: 'Ignoring malformed auth block.',
    });
    return { diagnostics };
  }

  const authObj = auth as PostmanAuthLike;
  const rawType =
    typeof authObj.type === 'string' ? authObj.type.trim().toLowerCase() : '';
  if (rawType.length === 0 || rawType === 'noauth') {
    return { diagnostics };
  }

  const profileId = uniqueId(
    `imported-${options.apiSlug}-${slugifyIdentifier(options.labelHint || rawType, rawType || 'auth')}`,
    options.existingIds,
    options.pendingIds,
  );
  const label = options.labelHint.trim() || rawType;

  switch (rawType) {
    case 'bearer': {
      return {
        profile: {
          profile: {
            id: profileId,
            label,
            providerId: 'bearer',
            token: { kind: 'secret' },
          },
          secretHints: [
            `Populate SecretStorage for bearer profile "${profileId}" (token).`,
          ],
        },
        profileId,
        diagnostics,
      };
    }
    case 'basic': {
      return {
        profile: {
          profile: {
            id: profileId,
            label,
            providerId: 'basic',
            username: { kind: 'secret' },
            password: { kind: 'secret' },
          },
          secretHints: [
            `Populate SecretStorage for basic profile "${profileId}" (username, password).`,
          ],
        },
        profileId,
        diagnostics,
      };
    }
    case 'apikey': {
      const params = readAuthParams(authObj, 'apikey');
      const keyName =
        params.get('key')?.trim() ||
        params.get('name')?.trim() ||
        'X-Api-Key';
      const locationRaw = (params.get('in') ?? params.get('location') ?? 'header')
        .trim()
        .toLowerCase();
      const location: 'header' | 'query' =
        locationRaw === 'query' ? 'query' : 'header';
      return {
        profile: {
          profile: {
            id: profileId,
            label,
            providerId: 'apiKey',
            name: keyName,
            location,
            value: { kind: 'secret' },
          },
          secretHints: [
            `Populate SecretStorage for API key profile "${profileId}" (${keyName} in ${location}).`,
          ],
        },
        profileId,
        diagnostics,
      };
    }
    case 'oauth2':
    case 'oauth1':
    case 'digest':
    case 'hawk':
    case 'awsv4':
    case 'ntlm':
    case 'edgegrid':
    case 'jwt':
    case 'asap': {
      diagnostics.push({
        code: 'postman-unsupported-auth',
        severity: 'warning',
        path: options.path,
        message: maskImportSecretText(
          `Postman auth type "${rawType}" is not imported as a live profile (metadata only). Configure Authentication manually.`,
        ),
      });
      return {
        profile: {
          profile: {
            id: profileId,
            label: `${label} (${rawType} metadata)`,
            providerId: 'none',
          } as AuthenticationProfile,
          secretHints: [],
          notes: `Postman auth "${rawType}" imported as none — no live credentials.`,
        },
        profileId,
        diagnostics,
      };
    }
    default: {
      diagnostics.push({
        code: 'postman-unsupported-auth',
        severity: 'warning',
        path: options.path,
        message: maskImportSecretText(
          `Unsupported Postman auth type "${rawType}" was not imported.`,
        ),
      });
      return { diagnostics };
    }
  }
}

/**
 * Reads Postman auth parameter arrays (`auth.bearer`, `auth.basic`, …)
 * into a key→value map. Sensitive values are not returned as literals for
 * profile storage (callers use secret placeholders).
 */
export function readAuthParams(
  auth: PostmanAuthLike,
  typeKey: string,
): Map<string, string> {
  const result = new Map<string, string>();
  if (
    typeKey === '__proto__' ||
    typeKey === 'prototype' ||
    typeKey === 'constructor'
  ) {
    return result;
  }
  const block = auth[typeKey];
  if (!Array.isArray(block)) {
    return result;
  }
  for (const entry of block) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (key.length === 0 || key === '__proto__') {
      continue;
    }
    const value =
      typeof entry.value === 'string'
        ? entry.value
        : entry.value === null || entry.value === undefined
          ? ''
          : String(entry.value);
    result.set(key, value);
  }
  return result;
}

/**
 * When a sensitive Authorization header appears without a mapped profile,
 * replace the value with a placeholder (never emit the literal).
 */
export function sanitizeHeaderValue(name: string, value: string): string {
  if (isSensitiveName(name)) {
    return placeholderForSensitiveName(name);
  }
  return value;
}

function uniqueId(
  preferred: string,
  existing: ReadonlySet<string>,
  pending: ReadonlySet<string>,
): string {
  if (!existing.has(preferred) && !pending.has(preferred)) {
    return preferred;
  }
  let index = 2;
  while (
    existing.has(`${preferred}-${index}`) ||
    pending.has(`${preferred}-${index}`)
  ) {
    index += 1;
  }
  return `${preferred}-${index}`;
}
