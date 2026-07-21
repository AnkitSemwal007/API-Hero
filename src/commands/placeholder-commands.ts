import { window } from 'vscode';

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

/**
 * Creates Coming Soon stub commands still contributed by the manifest
 * (`runFile`, `login`, `logout`).
 * Shell/IA shortcuts live elsewhere: `openWorkspace` / `openSettings` in
 * Overview registration; `recentRequests` (History focus alias) in History.
 */
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
  ];
}
