import { workspace } from 'vscode';

import type { AuthenticationProfileRepository } from '../auth';
import type { Disposable } from '../configuration';
import { CONFIGURATION_KEYS, CONFIGURATION_SECTION } from '../constants';
import type { AuthenticationProfile } from '../models';

/** Reads non-secret authentication metadata from VS Code settings. */
export class VsCodeAuthenticationProfileRepository
implements AuthenticationProfileRepository {
  public getProfiles(): readonly AuthenticationProfile[] {
    return workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<readonly AuthenticationProfile[]>(
        CONFIGURATION_KEYS.authenticationProfiles,
        [],
      );
  }

  public onDidChange(listener: () => void): Disposable {
    return workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(
        `${CONFIGURATION_SECTION}.${CONFIGURATION_KEYS.authenticationProfiles}`,
      )) {
        listener();
      }
    });
  }
}
