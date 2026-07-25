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
import {
  writeActiveEnvironmentId,
  writeEnvironmentManagerState,
} from './environment-settings-writer';

const PANEL_VIEW_TYPE = 'apiRunner.environmentManager';
const PANEL_TITLE = 'Environment Manager';

/** Owns a singleton Environment Manager panel. */
export class EnvironmentManagerPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private baseline: EnvironmentManagerState;
  private webviewDirty = false;
  private commitInFlight = false;
  private readonly disposables: Disposable[] = [];

  public constructor(private readonly manager: EnvironmentManager) {
    this.baseline = snapshotFromManager(manager);
    this.disposables.push(
      manager.onDidChange(() => {
        if (this.webviewDirty) {
          // Keep the cleartext baseline for secret restore — do not replace
          // it or postInit while the webview has unsaved edits.
          return;
        }
        this.baseline = snapshotFromManager(manager);
        void this.postInit();
      }),
    );
  }

  /** Opens or reveals the Environment Manager panel. */
  public show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Beside, false);
      if (!this.webviewDirty) {
        void this.postInit();
      }
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
    this.webviewDirty = false;

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
        this.webviewDirty = false;
        this.commitInFlight = false;
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
    if (message.type === 'dirty') {
      this.webviewDirty = message.dirty;
      return;
    }
    if (message.type === 'setActiveEnvironment') {
      const previousId = this.manager.activeId;
      try {
        await writeActiveEnvironmentId(message.id);
        try {
          this.manager.switchActive(message.id);
        } catch (switchError) {
          // Settings write already landed — restore previous id before surfacing.
          try {
            await writeActiveEnvironmentId(previousId);
          } catch {
            // Best-effort settings rollback; surface the original switch error.
          }
          throw switchError;
        }
        this.manager.refresh();
        // Keep variable edits; only refresh baseline + UI when clean so masked
        // secret restore still uses the pre-edit cleartext snapshot.
        if (!this.webviewDirty) {
          this.baseline = snapshotFromManager(this.manager);
          await this.postInit(this.baseline.selectedId);
        } else {
          await this.panel.webview.postMessage({
            type: 'activeEnvironmentSet',
            id: message.id,
          });
        }
        window.setStatusBarMessage(
          'API Hero: Active environment updated',
          3_000,
        );
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause);
        await this.panel.webview.postMessage({
          type: 'activeEnvironmentError',
          message: text || 'Unable to set active environment.',
        });
      }
      return;
    }

    if (this.commitInFlight) {
      await this.panel.webview.postMessage({
        type: 'error',
        message: 'A save is already in progress. Wait for it to finish.',
      });
      return;
    }

    const restored = restoreEnvironmentManagerState(message.state, this.baseline);
    const error = validateEnvironmentManagerState(restored);
    if (error !== undefined) {
      await this.panel.webview.postMessage({ type: 'error', message: error });
      return;
    }

    this.commitInFlight = true;
    try {
      await writeEnvironmentManagerState(restored);
      this.manager.refresh();
      this.baseline = snapshotFromManager(this.manager);
      this.webviewDirty = false;
      await this.postInit(restored.selectedId);
      window.setStatusBarMessage('API Hero: Environments saved', 3_000);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to save environments.',
      });
    } finally {
      this.commitInFlight = false;
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
