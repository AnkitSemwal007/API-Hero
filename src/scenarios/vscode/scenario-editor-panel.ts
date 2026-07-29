import {
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';
import { createWebviewNonce } from '../../ui/webview';
import type { Scenario } from '../models';
import {
  maskScenarioVariablesForEditor,
  parseScenarioEditorMessage,
  parseScenarioPayload,
  renderScenarioEditorHtml,
  restoreScenarioVariablesFromBaseline,
} from './scenario-editor-html';

const PANEL_VIEW_TYPE = 'apiHero.scenarioEditor';

export interface ScenarioEditorPanelActions {
  readonly save: (scenario: Scenario, filePath: string) => Promise<void>;
  readonly run: (scenario: Scenario, filePath: string) => Promise<void>;
}

export class ScenarioEditorPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  /** Cleartext baseline used to restore masked sensitive defaults from the webview. */
  private scenario: Scenario | undefined;
  private filePath: string | undefined;

  public constructor(private readonly actions: ScenarioEditorPanelActions) {}

  public show(scenario: Scenario, filePath: string): void {
    this.scenario = scenario;
    this.filePath = filePath;
    this.ensurePanel(`Scenario: ${scenario.name}`);
    void this.postInit();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.scenario = undefined;
    this.filePath = undefined;
  }

  private ensurePanel(title: string): void {
    if (this.panel !== undefined) {
      this.panel.title = title;
      this.panel.reveal(ViewColumn.One, false);
      return;
    }
    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      title,
      { viewColumn: ViewColumn.One, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.panel = panel;
    panel.webview.html = renderScenarioEditorHtml(createWebviewNonce());
    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
    ];
    panelDisposables.push(
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) disposable.dispose();
        this.panel = undefined;
      }),
    );
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseScenarioEditorMessage(raw);
    if (message === undefined) {
      // Save/Run with invalid schema previously no-op'd; surface validation errors.
      this.notifyInvalidEditorMessage(raw);
      return;
    }
    if (this.panel === undefined) return;
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }
    if (this.filePath === undefined) return;
    try {
      if (message.type === 'save') {
        const scenario = this.acceptIncomingScenario(message.scenario);
        await this.actions.save(scenario, this.filePath);
        return;
      }
      if (message.type === 'run') {
        // Single compound path: await save, then run (avoids concurrent save/run).
        const scenario = this.acceptIncomingScenario(message.scenario);
        await this.actions.save(scenario, this.filePath);
        await this.actions.run(scenario, this.filePath);
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      void window.showErrorMessage(text || 'Scenario editor action failed.');
    }
  }

  private notifyInvalidEditorMessage(raw: unknown): void {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('type' in raw) ||
      (raw.type !== 'save' && raw.type !== 'run')
    ) {
      return;
    }
    const parsed = parseScenarioPayload(
      'scenario' in raw ? (raw as { scenario?: unknown }).scenario : undefined,
    );
    const detail = parsed.ok
      ? 'Invalid scenario editor message.'
      : parsed.errors.join(' ') || 'Invalid scenario document.';
    void window.showErrorMessage(detail);
  }

  private acceptIncomingScenario(incoming: Scenario): Scenario {
    const restored = restoreScenarioVariablesFromBaseline(
      incoming,
      this.scenario,
    );
    const validated = parseScenarioPayload(restored);
    if (!validated.ok) {
      throw new Error(validated.errors.join(' ') || 'Invalid scenario document.');
    }
    this.scenario = validated.scenario;
    return validated.scenario;
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.scenario === undefined) return;
    await this.panel.webview.postMessage({
      type: 'init',
      scenario: maskScenarioVariablesForEditor(this.scenario),
    });
  }
}
