/**
 * Registers the Overview command panel (command-opened, not Activity Bar).
 *
 * Also hosts shell/IA workbench shortcuts (`openWorkspace`, `openSettings`)
 * used by Overview quick actions and Collections welcome/overflow. Intentional
 * composition ownership — not Overview-panel internals.
 */

import {
  commands,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import type { CollectionDiscoveryService } from '../../collections/discovery';
import { COMMAND_IDS, EXTENSION_ID } from '../../constants';
import type { HistoryRepository } from '../../history/repository';
import { OverviewPanel } from './overview-panel';

export interface RegisterOverviewOptions {
  readonly context: ExtensionContext;
  readonly historyRepository: HistoryRepository;
  readonly discovery: CollectionDiscoveryService;
}

export interface OverviewRegistration {
  readonly disposables: readonly Disposable[];
}

/** Wires the Overview panel into the extension host. */
export function registerOverview(
  options: RegisterOverviewOptions,
): OverviewRegistration {
  const { context, historyRepository, discovery } = options;
  const panel = new OverviewPanel({ historyRepository, discovery });

  const command = commands.registerCommand(COMMAND_IDS.openOverview, () => {
    panel.show();
  });

  /** Shell/IA navigation shortcut — opens a folder in the current window. */
  const openWorkspace = commands.registerCommand(
    COMMAND_IDS.openWorkspace,
    async () => {
      await commands.executeCommand('vscode.openFolder');
    },
  );

  /** Shell/IA navigation shortcut — opens API Hero extension settings. */
  const openSettings = commands.registerCommand(
    COMMAND_IDS.openSettings,
    async () => {
      await commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:${EXTENSION_ID}`,
      );
    },
  );

  const disposables: Disposable[] = [panel, command, openWorkspace, openSettings];
  context.subscriptions.push(...disposables);
  return { disposables };
}
