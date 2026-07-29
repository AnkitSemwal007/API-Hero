import {
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';
import { createWebviewNonce } from '../../ui/webview';
import type { ExecutionReport } from '../report/execution-report';
import {
  buildScenarioReportViewModel,
  parseScenarioReportMessage,
  renderScenarioReportHtml,
} from './scenario-report-html';

const PANEL_VIEW_TYPE = 'apiHero.scenarioRunReport';

export class ScenarioRunReportPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private model: ReturnType<typeof buildScenarioReportViewModel> | undefined;

  public show(report: ExecutionReport): void {
    this.model = buildScenarioReportViewModel(report);
    this.ensurePanel(`Scenario Report: ${report.scenarioName}`);
    void this.postInit();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.model = undefined;
  }

  private ensurePanel(title: string): void {
    if (this.panel !== undefined) {
      this.panel.title = title;
      this.panel.reveal(ViewColumn.Beside, false);
      return;
    }
    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      title,
      { viewColumn: ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.panel = panel;
    panel.webview.html = renderScenarioReportHtml(createWebviewNonce());
    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) disposable.dispose();
        this.panel = undefined;
      }),
    ];
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseScenarioReportMessage(raw);
    if (message === undefined || this.panel === undefined) return;
    if (message.type === 'ready') {
      await this.postInit();
    }
  }

  private async postInit(): Promise<void> {
    if (this.panel === undefined || this.model === undefined) return;
    await this.panel.webview.postMessage({ type: 'init', model: this.model });
  }
}
