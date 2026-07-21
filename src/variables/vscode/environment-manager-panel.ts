/**
 * Command-opened WebviewPanel host for the Environment Manager.
 */

import {
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';

import type { Environment, VariableDefinition } from '../../models';
import { createWebviewNonce } from '../../ui/webview';
import type { EnvironmentManager } from '../environment-manager';
import {
  maskEnvironmentManagerState,
  parseEnvironmentManagerMessage,
  renderEnvironmentManagerHtml,
  restoreEnvironmentManagerState,
  validateEnvironmentManagerState,
  type EnvironmentManagerState,
  type EnvironmentManagerVariable,
} from './environment-manager-html';
import { writeEnvironmentManagerState } from './environment-settings-writer';

const PANEL_VIEW_TYPE = 'apiRunner.environmentManager';
const PANEL_TITLE = 'Environment Manager';

/** Owns a singleton Environment Manager panel. */
export class EnvironmentManagerPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private baseline: EnvironmentManagerState;
  private readonly disposables: Disposable[] = [];

  public constructor(private readonly manager: EnvironmentManager) {
    this.baseline = snapshotFromManager(manager);
    this.disposables.push(
      manager.onDidChange(() => {
        this.baseline = snapshotFromManager(manager);
        void this.postInit();
      }),
    );
  }

  /** Opens or reveals the Environment Manager panel. */
  public show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Beside, false);
      void this.postInit();
      return;
    }

    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      { viewColumn: ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    this.panel = panel;

    const nonce = createWebviewNonce();
    panel.webview.html = renderEnvironmentManagerHtml(nonce);
    this.baseline = snapshotFromManager(this.manager);

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
      }),
    ];
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseEnvironmentManagerMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }

    const restored = restoreEnvironmentManagerState(message.state, this.baseline);
    const error = validateEnvironmentManagerState(restored);
    if (error !== undefined) {
      await this.panel.webview.postMessage({ type: 'error', message: error });
      return;
    }

    try {
      await writeEnvironmentManagerState(restored);
      this.manager.refresh();
      this.baseline = snapshotFromManager(this.manager);
      await this.postInit(restored.selectedId);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to save environments.',
      });
    }
  }

  private async postInit(selectedId?: string): Promise<void> {
    if (this.panel === undefined) {
      return;
    }
    const cleartext = snapshotFromManager(this.manager, selectedId);
    this.baseline = cleartext;
    await this.panel.webview.postMessage({
      type: 'init',
      state: maskEnvironmentManagerState(cleartext),
    });
  }
}

function snapshotFromManager(
  manager: EnvironmentManager,
  selectedId?: string,
): EnvironmentManagerState {
  const capture = manager.capture();
  const environments = manager.list().map(toManagerEnvironment);
  return {
    environments,
    globalVariables: capture.globalVariables.map(toManagerVariable),
    workspaceVariables: capture.workspaceVariables.map(toManagerVariable),
    ...(manager.activeId === undefined
      ? {}
      : { activeEnvironmentId: manager.activeId }),
    ...(selectedId === undefined ? {} : { selectedId }),
  };
}

function toManagerEnvironment(
  environment: Environment,
): EnvironmentManagerState['environments'][number] {
  return {
    id: environment.id,
    name: environment.name,
    variables: environment.variables.map(toManagerVariable),
  };
}

function toManagerVariable(
  variable: VariableDefinition,
): EnvironmentManagerVariable {
  return {
    name: variable.name,
    value: variable.value,
    sensitive: variable.sensitive,
  };
}
