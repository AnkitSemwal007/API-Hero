import { commands, window } from 'vscode';

import { COMMAND_IDS } from '../constants';
import type { EnvironmentManager } from '../variables';
import { writeActiveEnvironmentId } from '../variables/vscode/environment-settings-writer';
import type { CommandDefinition } from './command-definition';

const MANAGE_ENVIRONMENTS_ITEM_ID = '__manage_environments__';

interface EnvironmentQuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly id?: string;
}

/**
 * Creates the active-environment command. Selection updates the session and
 * persists `apiRunner.activeEnvironment` so settings and runtime converge.
 */
export function createSwitchEnvironmentCommand(
  manager: EnvironmentManager,
): CommandDefinition {
  return {
    id: COMMAND_IDS.switchEnvironment,
    async execute(): Promise<void> {
      const environments = manager.list();
      const items: EnvironmentQuickPickItem[] = [
        { label: 'No active environment' },
        ...environments.map((environment) => ({
          label: environment.name,
          description: environment.id === manager.activeId ? 'Active' : undefined,
          id: environment.id,
        })),
        {
          label: 'Manage Environments…',
          description: 'Open Environment Manager',
          id: MANAGE_ENVIRONMENTS_ITEM_ID,
        },
      ];
      const selection = await window.showQuickPick(items, {
        placeHolder: 'Select the active API Hero environment',
      });
      if (selection === undefined) {
        return;
      }
      if (selection.id === MANAGE_ENVIRONMENTS_ITEM_ID) {
        await commands.executeCommand(COMMAND_IDS.manageEnvironments);
        return;
      }
      const nextId = selection.id;
      const previousId = manager.activeId;
      manager.switchActive(nextId);
      try {
        await writeActiveEnvironmentId(nextId);
      } catch (error) {
        manager.switchActive(previousId);
        const text = error instanceof Error ? error.message : String(error);
        void window.showErrorMessage(
          text || 'Unable to persist the active environment.',
        );
      }
    },
  };
}
