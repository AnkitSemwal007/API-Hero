import {
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';
import { createWebviewNonce } from '../../ui/webview';
import type { Scenario } from '../models';
import { buildScenarioEdgeAnnotations } from '../ui-model';
import type { ScenarioRequestCatalogEntry } from '../request-depend-ref';
import {
  maskScenarioVariablesForEditor,
  parseScenarioEditorMessage,
  parseScenarioPayload,
  renderScenarioEditorHtml,
  restoreScenarioVariablesFromBaseline,
  SCENARIO_DIFFERENTIATION_COPY,
} from './scenario-editor-html';

const PANEL_VIEW_TYPE = 'apiHero.scenarioEditor';

export interface ScenarioEditorPanelActions {
  readonly save: (scenario: Scenario, filePath: string) => Promise<void>;
  readonly run: (scenario: Scenario, filePath: string) => Promise<void>;
  readonly pickRequest?: (
    stepId: string,
  ) => Promise<
    | {
        readonly requestRef: string;
        readonly requestId: string;
        readonly filePath: string;
        readonly offset: number;
      }
    | undefined
  >;
  readonly openAuth?: () => Promise<void>;
  readonly getDiffBannerDismissed?: () => boolean;
  readonly setDiffBannerDismissed?: () => Promise<void>;
}

export class ScenarioEditorPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  /** Cleartext baseline used to restore masked sensitive defaults from the webview. */
  private scenario: Scenario | undefined;
  private filePath: string | undefined;
  private catalog: readonly ScenarioRequestCatalogEntry[] = [];

  public constructor(private readonly actions: ScenarioEditorPanelActions) {}

  public show(
    scenario: Scenario,
    filePath: string,
    catalog: readonly ScenarioRequestCatalogEntry[] = [],
  ): void {
    const panelExisted = this.panel !== undefined;
    this.scenario = scenario;
    this.filePath = filePath;
    this.catalog = catalog;
    this.ensurePanel(`Scenario: ${scenario.name}`);
    // New webview posts init once on `ready`; existing panel needs an immediate re-init.
    if (panelExisted) {
      void this.postInit();
    }
  }

  /**
   * Reveal the editor for live run / bind UX. Reloads webview state only when
   * switching documents or when `forceReload` is set — preserves dirty binds
   * and in-progress run chrome on same-document Run.
   */
  public ensureVisible(
    scenario: Scenario,
    filePath: string,
    catalog: readonly ScenarioRequestCatalogEntry[] = [],
    options?: { readonly forceReload?: boolean },
  ): void {
    const sameDocument =
      this.panel !== undefined &&
      this.filePath === filePath &&
      this.scenario?.id === scenario.id;
    this.catalog = catalog;
    if (sameDocument && options?.forceReload !== true) {
      this.panel?.reveal(ViewColumn.One, false);
      void this.postCatalog(catalog);
      return;
    }
    this.show(scenario, filePath, catalog);
  }

  public getActiveScenarioId(): string | undefined {
    return this.scenario?.id;
  }

  public getActiveFilePath(): string | undefined {
    return this.filePath;
  }

  public async postRunProgress(payload: {
    readonly stepId: string;
    readonly status: 'started' | 'completed' | 'failed' | 'skipped';
    readonly attempt?: number;
    readonly durationMs?: number;
  }): Promise<void> {
    if (this.panel === undefined) return;
    await this.panel.webview.postMessage({ type: 'runProgress', ...payload });
  }

  public async postRunFinished(status: string): Promise<void> {
    if (this.panel === undefined) return;
    await this.panel.webview.postMessage({ type: 'runFinished', status });
  }

  public async postCatalog(
    entries: readonly ScenarioRequestCatalogEntry[],
  ): Promise<void> {
    this.catalog = entries;
    if (this.panel === undefined) return;
    await this.panel.webview.postMessage({
      type: 'catalog',
      entries: entries.map((e) => ({
        requestId: e.requestId,
        name: e.name,
        folderPath: e.folderPath,
        filePath: e.filePath,
        requestOffset: e.requestOffset,
      })),
    });
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
      this.notifyInvalidEditorMessage(raw);
      return;
    }
    if (this.panel === undefined) return;
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }
    if (message.type === 'dismissBanner') {
      await this.actions.setDiffBannerDismissed?.();
      return;
    }
    if (message.type === 'openAuth') {
      await this.actions.openAuth?.();
      return;
    }
    if (message.type === 'selectStep') {
      return;
    }
    if (message.type === 'pickRequest') {
      const picked = await this.actions.pickRequest?.(message.stepId);
      if (picked === undefined) return;
      await this.panel.webview.postMessage({
        type: 'requestPicked',
        stepId: message.stepId,
        requestRef: picked.requestRef,
        requestId: picked.requestId,
        filePath: picked.filePath,
        offset: picked.offset,
      });
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
      catalog: this.catalog.map((e) => ({
        requestId: e.requestId,
        name: e.name,
        folderPath: e.folderPath,
        filePath: e.filePath,
        requestOffset: e.requestOffset,
      })),
      annotations: buildScenarioEdgeAnnotations(this.scenario),
      differentiationCopy: SCENARIO_DIFFERENTIATION_COPY,
      bannerDismissed: this.actions.getDiffBannerDismissed?.() === true,
    });
  }
}
