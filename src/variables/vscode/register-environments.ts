/**
 * Registers Environment Manager command, panel, and status bar chip.
 */

import {
  commands,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { EnvironmentManager } from '../environment-manager';
import { EnvironmentManagerPanel } from './environment-manager-panel';
import { EnvironmentStatusBar } from './environment-status-bar';

export interface RegisterEnvironmentsOptions {
  readonly context: ExtensionContext;
  readonly environmentManager: EnvironmentManager;
}

export interface EnvironmentsRegistration {
  readonly disposables: readonly Disposable[];
}

/** Wires Environment Manager UI into the extension host. */
export function registerEnvironments(
  options: RegisterEnvironmentsOptions,
): EnvironmentsRegistration {
  const { context, environmentManager } = options;
  const panel = new EnvironmentManagerPanel(environmentManager);
  const statusBar = new EnvironmentStatusBar(environmentManager);

  const command = commands.registerCommand(
    COMMAND_IDS.manageEnvironments,
    () => {
      panel.show();
    },
  );

  const disposables: Disposable[] = [panel, statusBar, command];
  context.subscriptions.push(...disposables);
  return { disposables };
}
