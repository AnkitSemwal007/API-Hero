/**
 * Maps Insomnia authentication blocks to AuthenticationProfile / @auth ids.
 * Secrets are never copied — profiles use `{ kind: 'secret' }` placeholders.
 */

import type { AuthenticationProfile } from '../../models';
import type { GeneratedAuthProfile, ImportDiagnostic } from '../models';
import {
  maskImportSecretText,
  slugifyIdentifier,
} from '../sanitize';
import { isPlainObject } from './parse';

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
 * Maps an Insomnia `authentication` object to an API Hero auth profile when supported.
 * Unsupported types emit `insomnia-unsupported-auth` warnings.
 */
export function mapInsomniaAuth(
  auth: unknown,
  options: MapAuthOptions,
): MapAuthResult {
  const diagnostics: ImportDiagnostic[] = [];

  if (auth === undefined || auth === null) {
    return { diagnostics };
  }
  if (!isPlainObject(auth)) {
    diagnostics.push({
      code: 'insomnia-invalid-auth',
      severity: 'warning',
      path: options.path,
      message: 'Ignoring malformed authentication block.',
    });
    return { diagnostics };
  }

  const rawType =
    typeof auth.type === 'string' ? auth.type.trim().toLowerCase() : '';
  if (rawType.length === 0 || rawType === 'none') {
    return { diagnostics };
  }

  // disabled flag
  if (auth.disabled === true) {
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
      const keyName =
        (typeof auth.key === 'string' && auth.key.trim().length > 0
          ? auth.key.trim()
          : undefined) ||
        (typeof auth.name === 'string' && auth.name.trim().length > 0
          ? auth.name.trim()
          : undefined) ||
        'X-Api-Key';
      const addTo =
        typeof auth.addTo === 'string'
          ? auth.addTo.trim().toLowerCase()
          : '';
      const location: 'header' | 'query' =
        addTo === 'queryparams' || addTo === 'query' ? 'query' : 'header';
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
    case 'ntlm':
    case 'iam':
    case 'asap':
    case 'netrc':
    case 'sha256':
    case 'jwt': {
      diagnostics.push({
        code: 'insomnia-unsupported-auth',
        severity: 'warning',
        path: options.path,
        message: maskImportSecretText(
          `Insomnia auth type "${rawType}" is not imported as a live profile (metadata only). Configure Authentication manually.`,
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
          notes: `Insomnia auth "${rawType}" imported as none — no live credentials.`,
        },
        profileId,
        diagnostics,
      };
    }
    default: {
      diagnostics.push({
        code: 'insomnia-unsupported-auth',
        severity: 'warning',
        path: options.path,
        message: maskImportSecretText(
          `Unsupported Insomnia auth type "${rawType}" was not imported.`,
        ),
      });
      return { diagnostics };
    }
  }
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

/** When a sensitive header appears, replace the value with a placeholder. */
export { sanitizeHeaderValue } from '../postman/map-auth';
