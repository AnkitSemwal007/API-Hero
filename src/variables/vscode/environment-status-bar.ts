/**
 * Status bar chip for the active API Hero environment.
 */

import {
  StatusBarAlignment,
  window,
  type Disposable,
  type StatusBarItem,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { EnvironmentManager } from '../environment-manager';

/** Shows the active environment and opens Switch Environment on click. */
export class EnvironmentStatusBar implements Disposable {
  private readonly item: StatusBarItem;
  private readonly registration: Disposable;
  private disposed = false;

  public constructor(private readonly manager: EnvironmentManager) {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 98);
    this.item.name = 'API Hero Environment';
    this.item.command = COMMAND_IDS.switchEnvironment;
    this.registration = manager.onDidChange(() => this.refresh());
    this.refresh();
    this.item.show();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.registration.dispose();
    this.item.dispose();
  }

  private refresh(): void {
    if (this.disposed) {
      return;
    }
    const active = this.manager.list().find(
      (environment) => environment.id === this.manager.activeId,
    );
    if (active === undefined) {
      this.item.text = '$(globe) Env: None';
      this.item.tooltip =
        'No active API Hero environment. Click to switch or manage environments.';
      return;
    }
    this.item.text = `$(globe) Env: ${active.name}`;
    this.item.tooltip =
      `Active environment: ${active.name}. Click to switch or manage environments.`;
  }
}
