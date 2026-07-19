import { window } from 'vscode';

import type { AuthenticationProfileManager } from '../auth';
import { COMMAND_IDS } from '../constants';
import type { CommandDefinition } from './command-definition';

/** Selects a session default; request-local @auth always takes precedence. */
export function createSelectAuthenticationCommand(
  manager: AuthenticationProfileManager,
): CommandDefinition {
  return {
    id: COMMAND_IDS.selectAuthentication,
    async execute(): Promise<void> {
      const profiles = manager.list();
      const selection = await window.showQuickPick([
        {
          label: 'No default authentication',
          description: manager.defaultProfileId === undefined ? 'Active' : undefined,
          id: undefined,
        },
        ...profiles.map((profile) => ({
          label: profile.label ?? profile.id,
          description: profile.id === manager.defaultProfileId
            ? 'Active'
            : `${profile.providerId} · ${profile.id}`,
          id: profile.id,
        })),
      ], {
        placeHolder: 'Select session authentication (overridden by @auth)',
      });
      if (selection !== undefined) {
        manager.selectDefault(selection.id);
      }
    },
  };
}
