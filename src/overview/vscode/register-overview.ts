/**
 * Registers the Overview command panel (command-opened, not Activity Bar).
 */

import {
  commands,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import type { CollectionDiscoveryService } from '../../collections/discovery';
import { COMMAND_IDS } from '../../constants';
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

  const disposables: Disposable[] = [panel, command];
  context.subscriptions.push(...disposables);
  return { disposables };
}
