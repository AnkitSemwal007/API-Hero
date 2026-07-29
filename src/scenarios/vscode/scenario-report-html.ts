/**
 * Pure HTML for the Scenario Run Report webview (no `vscode` import).
 */

import type { ExecutionReport } from '../report/execution-report';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export interface ScenarioReportViewModel {
  readonly scenarioName: string;
  readonly runId: string;
  readonly status: string;
  readonly durationMs: number;
  readonly statistics: {
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly cancelled: number;
  };
  readonly timeline: readonly {
    readonly timestamp: number;
    readonly stepName: string;
    readonly event: string;
    readonly message?: string;
  }[];
  readonly steps: readonly {
    readonly stepName: string;
    readonly status: string;
    readonly durationMs: number;
    readonly attempt: number;
    readonly errorMessage?: string;
    readonly outputsLabel?: string;
  }[];
  readonly variables: readonly {
    readonly name: string;
    readonly displayValue: string;
  }[];
}

export function buildScenarioReportViewModel(
  report: ExecutionReport,
): ScenarioReportViewModel {
  return {
    scenarioName: report.scenarioName,
    runId: report.runId,
    status: report.status,
    durationMs: report.durationMs,
    statistics: {
      total: report.statistics.total,
      completed: report.statistics.completed,
      failed: report.statistics.failed,
      skipped: report.statistics.skipped,
      cancelled: report.statistics.cancelled,
    },
    timeline: report.timeline.map((entry) => ({
      timestamp: entry.timestamp,
      stepName: entry.stepName,
      event: entry.event,
      ...(entry.message === undefined ? {} : { message: entry.message }),
    })),
    steps: report.stepResults.map((step) => ({
      stepName: step.stepName,
      status: step.status,
      durationMs: step.durationMs,
      attempt: step.attempt,
      ...(step.error === undefined ? {} : { errorMessage: step.error.message }),
      ...(step.outputs === undefined || step.outputs.length === 0
        ? {}
        : {
            outputsLabel: step.outputs.map((o) => o.name).join(', '),
          }),
    })),
    variables: report.variables.map((v) => ({
      name: v.name,
      displayValue: v.displayValue,
    })),
  };
}

export type ScenarioReportMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'close' };

export function parseScenarioReportMessage(
  raw: unknown,
): ScenarioReportMessage | undefined {
  if (!isWebviewMessageRecord(raw)) return undefined;
  if (raw.type === 'ready') return { type: 'ready' };
  if (raw.type === 'close') return { type: 'close' };
  return undefined;
}

export function renderScenarioReportHtml(nonce: string): string {
  const csp = buildNonceOnlyCsp(nonce);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scenario Run Report</title>
<style nonce="${escapeAttribute(nonce)}">
${WEBVIEW_SHARED_CSS}
body { margin: 0; padding: var(--ah-space-4); font: 13px/1.4 var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
h1 { font-size: 16px; margin: 0 0 var(--ah-space-3); }
.meta { display: flex; flex-wrap: wrap; gap: var(--ah-space-3); margin-bottom: var(--ah-space-4); opacity: 0.9; }
.section { margin-bottom: var(--ah-space-5); }
.section h2 { font-size: 13px; margin: 0 0 var(--ah-space-2); text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); vertical-align: top; }
th { font-weight: 600; opacity: 0.85; }
.badge { display: inline-block; padding: 1px 6px; border-radius: var(--ah-radius); font-size: 11px; border: 1px solid var(--vscode-panel-border, transparent); }
.badge-failed, .badge-cancelled { color: var(--vscode-errorForeground); }
.badge-completed { color: var(--vscode-testing-iconPassed, #3fb950); }
.badge-skipped { opacity: 0.75; }
.empty { opacity: 0.7; }
</style>
</head>
<body>
  <h1 id="title">Scenario Run Report</h1>
  <div class="meta" id="meta"></div>
  <div class="section">
    <h2>Steps</h2>
    <div id="steps" class="empty">Waiting for report…</div>
  </div>
  <div class="section">
    <h2>Timeline</h2>
    <div id="timeline" class="empty">—</div>
  </div>
  <div class="section">
    <h2>Variables</h2>
    <div id="variables" class="empty">—</div>
  </div>
<script nonce="${escapeAttribute(nonce)}">
const vscode = acquireVsCodeApi();
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function badge(status){return '<span class="badge badge-'+esc(status)+'">'+esc(status)+'</span>';}
function render(model){
  document.getElementById('title').textContent = model.scenarioName + ' — Report';
  const s = model.statistics;
  document.getElementById('meta').innerHTML =
    '<span>Status: '+badge(model.status)+'</span>'+
    '<span>Duration: '+esc(model.durationMs)+' ms</span>'+
    '<span>Steps: '+esc(s.completed)+'/'+esc(s.total)+' ok, '+esc(s.failed)+' failed, '+esc(s.skipped)+' skipped</span>'+
    '<span>Run: '+esc(model.runId)+'</span>';
  if(!model.steps.length){document.getElementById('steps').innerHTML='<p class="empty">No steps.</p>';}
  else{
    document.getElementById('steps').innerHTML='<table><thead><tr><th>Step</th><th>Status</th><th>Duration</th><th>Attempt</th><th>Outputs / Error</th></tr></thead><tbody>'+
      model.steps.map(st=>'<tr><td>'+esc(st.stepName)+'</td><td>'+badge(st.status)+'</td><td>'+esc(st.durationMs)+' ms</td><td>'+esc(st.attempt)+'</td><td>'+esc(st.errorMessage||st.outputsLabel||'—')+'</td></tr>').join('')+
      '</tbody></table>';
  }
  if(!model.timeline.length){document.getElementById('timeline').innerHTML='<p class="empty">No timeline.</p>';}
  else{
    document.getElementById('timeline').innerHTML='<table><thead><tr><th>Time</th><th>Step</th><th>Event</th><th>Message</th></tr></thead><tbody>'+
      model.timeline.map(t=>'<tr><td>'+esc(t.timestamp)+'</td><td>'+esc(t.stepName)+'</td><td>'+esc(t.event)+'</td><td>'+esc(t.message||'')+'</td></tr>').join('')+
      '</tbody></table>';
  }
  if(!model.variables.length){document.getElementById('variables').innerHTML='<p class="empty">No variables.</p>';}
  else{
    document.getElementById('variables').innerHTML='<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>'+
      model.variables.map(v=>'<tr><td>'+esc(v.name)+'</td><td>'+esc(v.displayValue)+'</td></tr>').join('')+
      '</tbody></table>';
  }
}
window.addEventListener('message',(e)=>{
  const msg=e.data;
  if(!msg||typeof msg!=='object')return;
  if(msg.type==='init'||msg.type==='update') render(msg.model);
});
vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
}
