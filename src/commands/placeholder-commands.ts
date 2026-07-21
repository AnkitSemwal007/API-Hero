import { commands, window } from 'vscode';

import { COMMAND_IDS } from '../constants';
import type { CommandDefinition } from './command-definition';

/**
 * Shows a production-quality notice for stub commands that remain contributed
 * for stable ID compatibility but are not implemented in this release.
 */
async function notifyComingSoon(featureLabel: string): Promise<void> {
  await window.showInformationMessage(
    `API Hero: ${featureLabel} is not available in this release. It is planned for a future update.`,
  );
}

/** Creates the remaining placeholder commands still contributed by the manifest. */
export function createPlaceholderCommands(): readonly CommandDefinition[] {
  return [
    {
      id: COMMAND_IDS.runFile,
      execute: () =>
        notifyComingSoon(
          'Run File (run all requests in the current editor)',
        ),
    },
    {
      id: COMMAND_IDS.login,
      execute: () => notifyComingSoon('Login'),
    },
    {
      id: COMMAND_IDS.logout,
      execute: () => notifyComingSoon('Logout'),
    },
    {
      id: COMMAND_IDS.openWorkspace,
      execute: async () => {
        await commands.executeCommand('vscode.openFolder');
      },
    },
  ];
}
