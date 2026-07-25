import { workspace } from 'vscode';

import type { AuthenticationProfileRepository } from '../auth';
import type { Disposable } from '../configuration';
import { CONFIGURATION_KEYS, CONFIGURATION_SECTION } from '../constants';
import type { AuthenticationProfile } from '../models';
import {
  getActiveProjectStoreCoordinator,
} from '../project-store/vscode/project-store-coordinator';
import { resolveProjectStoreFolderPath } from '../project-store/vscode/resolve-project-folder';

/**
 * Reads non-secret authentication metadata.
 * Prefers `.apihero/auth/profiles.json` when the project store is active;
 * otherwise falls back to `apiRunner.authentication.profiles` settings.
 * Secrets stay in SecretStorage — never read here.
 */
export class VsCodeAuthenticationProfileRepository
implements AuthenticationProfileRepository {
  public getProfiles(): readonly AuthenticationProfile[] {
    const coordinator = getActiveProjectStoreCoordinator();
    const folder = resolveProjectStoreFolderPath();
    if (coordinator !== undefined && folder !== undefined) {
      const cached = coordinator.getCached(folder);
      if (cached !== undefined) {
        return cached.authenticationProfiles;
      }
    }

    return workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<readonly AuthenticationProfile[]>(
        CONFIGURATION_KEYS.authenticationProfiles,
        [],
      );
  }

  public onDidChange(listener: () => void): Disposable {
    const configurationRegistration = workspace.onDidChangeConfiguration(
      (event) => {
        if (
          event.affectsConfiguration(
            `${CONFIGURATION_SECTION}.${CONFIGURATION_KEYS.authenticationProfiles}`,
          )
        ) {
          listener();
        }
      },
    );
    const storeRegistration =
      getActiveProjectStoreCoordinator()?.onDidChange(listener);
    return {
      dispose: () => {
        configurationRegistration.dispose();
        storeRegistration?.dispose();
      },
    };
  }
}
