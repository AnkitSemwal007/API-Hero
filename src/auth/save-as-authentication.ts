/**
 * Creates a secret-backed Authentication profile from one-shot credentials.
 * Core-friendly validation; persistence is left to the caller.
 */

import type {
  AuthenticationProfile,
  AuthenticationKind,
} from '../models';
import {
  isValidAuthenticationProfileId,
  validateAuthenticationProfilesForCommit,
} from './authentication-profile-validation';
import type { AuthenticationSecretRepository } from './authentication-resolver';
import type { EphemeralAuthenticationBinding } from './ephemeral-authentication';

export interface SaveAsAuthenticationInput {
  readonly id: string;
  readonly label: string;
  readonly ephemeral: EphemeralAuthenticationBinding;
  readonly existingProfiles: readonly AuthenticationProfile[];
  readonly secrets: AuthenticationSecretRepository;
}

export type SaveAsAuthenticationResult =
  | { readonly ok: true; readonly profile: AuthenticationProfile }
  | { readonly ok: false; readonly message: string };

/**
 * Validates, stores the credential in Secret Storage, and returns the profile
 * metadata (kind: secret). Caller persists profiles via settings/project store.
 */
export async function saveAsAuthenticationProfile(
  input: SaveAsAuthenticationInput,
): Promise<SaveAsAuthenticationResult> {
  const id = input.id.trim();
  const label = input.label.trim() || id;
  if (!isValidAuthenticationProfileId(id)) {
    return { ok: false, message: `Invalid profile id "${id}".` };
  }
  if (input.existingProfiles.some((profile) => profile.id === id)) {
    return { ok: false, message: `Profile id "${id}" already exists.` };
  }

  const providerId = input.ephemeral.providerId as AuthenticationKind;
  let profile: AuthenticationProfile;
  switch (providerId) {
    case 'bearer': {
      const token = input.ephemeral.material.token;
      if (token === undefined || token.length === 0) {
        return { ok: false, message: 'Bearer token is required.' };
      }
      await input.secrets.store(id, 'token', token);
      profile = { id, label, providerId: 'bearer', token: { kind: 'secret' } };
      break;
    }
    case 'basic': {
      const username = input.ephemeral.material.username ?? '';
      const password = input.ephemeral.material.password ?? '';
      if (username.length === 0) {
        return { ok: false, message: 'Username is required.' };
      }
      if (password.length === 0) {
        return { ok: false, message: 'Password is required.' };
      }
      await input.secrets.store(id, 'username', username);
      await input.secrets.store(id, 'password', password);
      profile = {
        id,
        label,
        providerId: 'basic',
        username: { kind: 'secret' },
        password: { kind: 'secret' },
      };
      break;
    }
    case 'apiKey': {
      const value = input.ephemeral.material.value;
      if (value === undefined || value.length === 0) {
        return { ok: false, message: 'API key value is required.' };
      }
      const name = input.ephemeral.apiKeyName?.trim() || 'X-API-Key';
      const location =
        input.ephemeral.apiKeyLocation === 'query' ? 'query' : 'header';
      await input.secrets.store(id, 'value', value);
      profile = {
        id,
        label,
        providerId: 'apiKey',
        name,
        location,
        value: { kind: 'secret' },
      };
      break;
    }
    default:
      return { ok: false, message: `Unsupported provider "${providerId}".` };
  }

  const commit = validateAuthenticationProfilesForCommit({
    profiles: [
      ...input.existingProfiles.map((entry) => ({
        id: entry.id,
        label: entry.label ?? entry.id,
        providerId: entry.providerId as 'none' | 'basic' | 'bearer' | 'apiKey',
        ...((entry as { name?: string }).name !== undefined
          ? { apiKeyName: (entry as { name?: string }).name }
          : {}),
        ...((entry as { location?: string }).location === 'header' ||
        (entry as { location?: string }).location === 'query'
          ? {
              apiKeyLocation: (entry as { location: 'header' | 'query' })
                .location,
            }
          : {}),
      })),
      {
        id: profile.id,
        label: profile.label ?? profile.id,
        providerId: profile.providerId as 'none' | 'basic' | 'bearer' | 'apiKey',
        ...((profile as { name?: string }).name !== undefined
          ? { apiKeyName: (profile as { name?: string }).name }
          : {}),
        ...((profile as { location?: string }).location === 'header' ||
        (profile as { location?: string }).location === 'query'
          ? {
              apiKeyLocation: (profile as { location: 'header' | 'query' })
                .location,
            }
          : {}),
      },
    ],
  });
  if (commit.issues.length > 0) {
    return {
      ok: false,
      message: commit.issues[0]?.message ?? 'Profile validation failed.',
    };
  }

  return { ok: true, profile };
}
