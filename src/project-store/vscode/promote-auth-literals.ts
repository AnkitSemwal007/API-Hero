/**
 * Promotes literal auth credential sources into SecretStorage before tracked
 * `.apihero/auth/profiles.json` is written (domain serialize always redacts).
 */

import { authenticationSecretKey } from '../../auth/authentication-resolver';
import type { AuthenticationProfile } from '../../models';
import type { SecretStore } from '../../storage/stores';
import { collectAuthLiteralSecrets } from '../serialize';

/**
 * Writes literal credential values into SecretStorage using the canonical
 * `apiHero.auth.profile.*` key pattern. Existing secret values are left
 * unchanged (fill-only).
 *
 * @throws when any SecretStorage write fails — callers must abort tracked
 * auth writes so redacted profiles are not persisted without credentials.
 */
export async function promoteAuthLiteralsToSecretStorage(
  profiles: readonly AuthenticationProfile[],
  secretStore: SecretStore,
): Promise<void> {
  const literals = collectAuthLiteralSecrets(profiles);
  for (const entry of literals) {
    const key = authenticationSecretKey(entry.profileId, entry.field);
    try {
      const existing = await secretStore.get(key);
      if (existing !== undefined && existing.length > 0) {
        continue;
      }
      await secretStore.set(key, entry.value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to promote auth literal into SecretStorage (profileId=${entry.profileId}, field=${entry.field}): ${detail}`,
        { cause: error },
      );
    }
  }
}
