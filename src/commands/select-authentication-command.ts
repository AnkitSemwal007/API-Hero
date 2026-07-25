import { commands, window } from 'vscode';

import type { AuthenticationProfileManager } from '../auth';
import { COMMAND_IDS } from '../constants';
import type { CommandDefinition } from './command-definition';

const MANAGE_AUTHENTICATION_ITEM_ID = '__manage_authentication__';

interface AuthenticationQuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly id?: string;
}

/** Selects a session default; request-local @auth always takes precedence. */
export function createSelectAuthenticationCommand(
  manager: AuthenticationProfileManager,
): CommandDefinition {
  return {
    id: COMMAND_IDS.selectAuthentication,
    async execute(): Promise<void> {
      const profiles = manager.list();
      const items: AuthenticationQuickPickItem[] = [
        {
          label: 'No default authentication',
          description:
            manager.defaultProfileId === undefined ? 'Active' : undefined,
          id: undefined,
        },
        ...profiles.map((profile) => ({
          label: profile.label ?? profile.id,
          description:
            profile.id === manager.defaultProfileId
              ? 'Active'
              : `${profile.providerId} · ${profile.id}`,
          id: profile.id,
        })),
        {
          label: 'Manage Authentication…',
          description: 'Open Manage Authentication',
          id: MANAGE_AUTHENTICATION_ITEM_ID,
        },
      ];
      const selection = await window.showQuickPick(items, {
        placeHolder: 'Select session authentication (overridden by @auth)',
      });
      if (selection === undefined) {
        return;
      }
      if (selection.id === MANAGE_AUTHENTICATION_ITEM_ID) {
        await commands.executeCommand(COMMAND_IDS.manageAuthProfiles);
        return;
      }
      manager.selectDefault(selection.id);
    },
  };
}
