import { window } from 'vscode';

import { COMMAND_IDS } from '../constants';
import type { EnvironmentManager } from '../variables';
import type { CommandDefinition } from './command-definition';

/** Creates the explicit, session-scoped active-environment command. */
export function createSwitchEnvironmentCommand(
  manager: EnvironmentManager,
): CommandDefinition {
  return {
    id: COMMAND_IDS.switchEnvironment,
    async execute(): Promise<void> {
      const environments = manager.list();
      const selection = await window.showQuickPick([
        { label: 'No active environment', id: undefined },
        ...environments.map((environment) => ({
          label: environment.name,
          description: environment.id === manager.activeId ? 'Active' : undefined,
          id: environment.id,
        })),
      ], { placeHolder: 'Select the active API Runner environment' });
      if (selection !== undefined) {
        manager.switchActive(selection.id);
      }
    },
  };
}
