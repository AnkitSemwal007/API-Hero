/**
 * Pure HTML for the Scenario Editor webview (canvas + panels). No `vscode`.
 */

import type { Scenario, ScenarioVariable } from '../models';
import { parseScenarioDocument } from '../schema';
import { MASKED_VARIABLE_VALUE } from '../../variables';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export type ScenarioEditorRunProgressStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ScenarioEditorMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'run'; readonly scenario: Scenario }
  | { readonly type: 'save'; readonly scenario: Scenario }
  | { readonly type: 'selectStep'; readonly stepId: string | undefined }
  | { readonly type: 'pickRequest'; readonly stepId: string }
  | { readonly type: 'openAuth' }
  | { readonly type: 'dismissBanner' };

export interface ScenarioRequestCatalogUiEntry {
  readonly requestId: string;
  readonly name: string;
  readonly folderPath: string;
  readonly filePath: string;
  readonly requestOffset: number;
}

/** Masks sensitive default values before posting a scenario to the editor webview. */
export function maskScenarioVariablesForEditor(scenario: Scenario): Scenario {
  return {
    ...scenario,
    variables: scenario.variables.map((variable) =>
      variable.sensitive &&
      variable.defaultValue !== undefined &&
      variable.defaultValue.length > 0
        ? { ...variable, defaultValue: MASKED_VARIABLE_VALUE }
        : variable,
    ),
  };
}

/**
 * Restores masked sensitive defaults from a cleartext baseline so a save
 * round-trip does not wipe or persist the mask glyph.
 */
export function restoreScenarioVariablesFromBaseline(
  incoming: Scenario,
  baseline: Scenario | undefined,
): Scenario {
  if (baseline === undefined) {
    return {
      ...incoming,
      variables: incoming.variables.map((variable) =>
        stripUnmatchedMask(variable),
      ),
    };
  }
  const byId = new Map(baseline.variables.map((v) => [v.id, v] as const));
  const byName = new Map(baseline.variables.map((v) => [v.name, v] as const));
  return {
    ...incoming,
    variables: incoming.variables.map((variable) => {
      if (variable.defaultValue !== MASKED_VARIABLE_VALUE) return variable;
      const prior = byId.get(variable.id) ?? byName.get(variable.name);
      if (
        prior?.defaultValue !== undefined &&
        prior.defaultValue !== MASKED_VARIABLE_VALUE
      ) {
        return {
          ...variable,
          defaultValue: prior.defaultValue,
        };
      }
      return stripUnmatchedMask(variable);
    }),
  };
}

function stripUnmatchedMask(variable: ScenarioVariable): ScenarioVariable {
  if (variable.defaultValue !== MASKED_VARIABLE_VALUE) return variable;
  return {
    id: variable.id,
    name: variable.name,
    scope: variable.scope,
    sensitive: variable.sensitive,
  };
}

/** Validates an unknown webview scenario payload via schema parse. */
export function parseScenarioPayload(
  raw: unknown,
): { readonly ok: true; readonly scenario: Scenario } | { readonly ok: false; readonly errors: readonly string[] } {
  try {
    return parseScenarioDocument(JSON.stringify(raw));
  } catch {
    return { ok: false, errors: ['Scenario payload could not be serialized.'] };
  }
}

export function parseScenarioEditorMessage(
  raw: unknown,
): ScenarioEditorMessage | undefined {
  if (!isWebviewMessageRecord(raw)) return undefined;
  if (raw.type === 'ready') return { type: 'ready' };
  if (raw.type === 'openAuth') return { type: 'openAuth' };
  if (raw.type === 'dismissBanner') return { type: 'dismissBanner' };
  if (raw.type === 'selectStep') {
    return {
      type: 'selectStep',
      stepId: typeof raw.stepId === 'string' ? raw.stepId : undefined,
    };
  }
  if (raw.type === 'pickRequest') {
    if (typeof raw.stepId !== 'string' || raw.stepId.trim().length === 0) {
      return undefined;
    }
    return { type: 'pickRequest', stepId: raw.stepId };
  }
  if (raw.type === 'save' || raw.type === 'run') {
    const parsed = parseScenarioPayload(raw.scenario);
    if (!parsed.ok) return undefined;
    return { type: raw.type, scenario: parsed.scenario };
  }
  return undefined;
}

/** Host + webview share this copy so Collection Runner vs Scenario stays consistent. */
export const SCENARIO_DIFFERENTIATION_COPY =
  'Collection Runner executes many requests. A Scenario automates one API workflow with branches and shared data.';

export function renderScenarioEditorHtml(nonce: string): string {
  const csp = buildNonceOnlyCsp(nonce);
  const maskLiteral = JSON.stringify(MASKED_VARIABLE_VALUE);
  const differentiationLiteral = JSON.stringify(SCENARIO_DIFFERENTIATION_COPY);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scenario Editor</title>
<style nonce="${escapeAttribute(nonce)}">
${WEBVIEW_SHARED_CSS}
html, body { height: 100%; margin: 0; }
body {
  display: grid;
  grid-template-rows: auto auto 1fr;
  font: 13px/1.4 var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
.toolbar {
  display: flex; gap: var(--ah-space-2); align-items: center; flex-wrap: wrap;
  padding: var(--ah-space-2) var(--ah-space-3);
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
}
.toolbar-titles { flex: 1; min-width: 160px; }
.toolbar h1 { font-size: 13px; margin: 0; }
.toolbar .subtitle { font-size: 11px; opacity: 0.75; margin-top: 2px; }
#run-status {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  min-height: 1.4em; min-width: 4em; text-align: center;
  opacity: 0.85;
}
#run-status:empty { display: none; }
#btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
.banner {
  display: flex; gap: var(--ah-space-2); align-items: flex-start;
  padding: 6px var(--ah-space-3);
  background: var(--vscode-editorWidget-background, rgba(128,128,128,0.12));
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  font-size: 12px;
}
.banner button { margin-left: auto; }
.banner.hidden { display: none; }
.bind-banner, .result-strip {
  margin: 8px 12px 0; padding: 8px 10px; border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-focusBorder));
  background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
  color: var(--vscode-foreground);
  font-size: 12px; z-index: 2; position: relative;
}
.bind-banner.hidden, .result-strip.hidden { display: none; }
.bind-banner strong { display: block; margin-bottom: 6px; }
.bind-row {
  display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;
}
.bind-row span { flex: 1; min-width: 80px; }
.result-strip {
  border-color: var(--vscode-focusBorder, #007fd4);
  background: var(--vscode-editorWidget-background, rgba(128,128,128,0.12));
  display: flex; align-items: flex-start; gap: 8px;
}
.result-strip button { margin-left: auto; }
.layout {
  display: grid;
  grid-template-columns: 200px 1fr 300px;
  min-height: 0;
}
.palette {
  border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  overflow: auto; padding: var(--ah-space-2);
  background: var(--vscode-sideBar-background, transparent);
}
.palette h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin: var(--ah-space-3) 0 var(--ah-space-1); opacity: 0.8; }
.palette h2:first-of-type { margin-top: var(--ah-space-2); }
.palette-item, .hint-card {
  display: block; width: 100%; text-align: left; box-sizing: border-box;
  margin-bottom: 4px; padding: 6px 8px; border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  background: var(--vscode-editorWidget-background, transparent);
  color: inherit; cursor: pointer; font: inherit;
}
.palette-item:hover, .hint-card:hover { border-color: var(--vscode-focusBorder); }
.palette-item.disabled, .hint-card.disabled {
  opacity: 0.45; cursor: not-allowed;
}
.hint-card { font-size: 11px; opacity: 0.9; }
.palette-link {
  display: block; width: 100%; text-align: left; box-sizing: border-box;
  margin: 2px 0 8px; padding: 0; border: 0; background: transparent;
  color: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
  cursor: pointer; font: inherit; font-size: 11px; text-decoration: underline;
}
.canvas-wrap {
  position: relative; overflow: auto;
  background:
    linear-gradient(var(--vscode-panel-border, rgba(128,128,128,0.08)) 1px, transparent 1px),
    linear-gradient(90deg, var(--vscode-panel-border, rgba(128,128,128,0.08)) 1px, transparent 1px);
  background-size: 24px 24px;
}
.canvas-wrap.soft-grid {
  background:
    linear-gradient(var(--vscode-panel-border, rgba(128,128,128,0.04)) 1px, transparent 1px),
    linear-gradient(90deg, var(--vscode-panel-border, rgba(128,128,128,0.04)) 1px, transparent 1px);
  background-size: 24px 24px;
}
.teach-strip {
  position: absolute; left: 50%; top: 48px; transform: translateX(-50%);
  z-index: 2; padding: 16px 18px; border-radius: var(--ah-radius);
  border: 1px dashed var(--vscode-focusBorder, #007fd4);
  background: var(--vscode-editorWidget-background, rgba(0,0,0,0.2));
  font-size: 13px; max-width: 460px; width: calc(100% - 48px); text-align: center;
}
.teach-strip .cta-row { display: flex; gap: 8px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
.teach-strip .cta-row button { min-width: 120px; padding: 6px 12px; font: inherit; cursor: pointer; }
svg.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
svg.edges .edge-hit { pointer-events: stroke; cursor: pointer; }
.node {
  position: absolute; min-width: 120px; max-width: 180px;
  padding: 8px 10px; border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-focusBorder, #007fd4);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  cursor: grab; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
  user-select: none;
}
.node.selected { outline: 2px solid var(--vscode-focusBorder); }
.node.entry { border-color: var(--vscode-descriptionForeground, rgba(128,128,128,0.6)); }
.node.stub {
  border-style: dashed;
  opacity: 0.88;
  border-color: var(--vscode-descriptionForeground, rgba(128,128,128,0.55));
}
.node .type { font-size: 10px; text-transform: uppercase; opacity: 0.7; }
.node .name { font-weight: 600; margin-top: 2px; word-break: break-word; }
.node .status-word { font-size: 10px; opacity: 0.8; margin-top: 2px; }
.node .badge { font-size: 10px; opacity: 0.8; margin-top: 2px; }
.node.running { box-shadow: 0 0 0 2px var(--vscode-focusBorder); animation: pulse 1.1s ease-in-out infinite; }
.node.completed { border-color: var(--vscode-testing-iconPassed, #3ba55d); }
.node.failed { border-color: var(--vscode-testing-iconFailed, #f14c4c); }
.node.skipped { opacity: 0.55; }
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--vscode-focusBorder); }
  50% { box-shadow: 0 0 0 5px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .node.running { animation: none; }
}
.edge-plus {
  position: absolute; width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid var(--vscode-focusBorder); background: var(--vscode-editor-background);
  color: inherit; font-size: 14px; line-height: 18px; text-align: center;
  cursor: pointer; z-index: 3; padding: 0;
  opacity: 0.35;
}
.edge-plus:hover, .edge-plus.visible { opacity: 0.9; }
.side {
  border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  overflow: auto; padding: var(--ah-space-3);
  background: var(--vscode-sideBar-background, transparent);
}
.side h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 var(--ah-space-2); opacity: 0.8; }
.side section { margin-bottom: var(--ah-space-4); }
label { display: block; font-size: 11px; opacity: 0.8; margin-bottom: 2px; }
label.checkbox-label {
  display: inline-flex; align-items: center; gap: 6px; opacity: 1; margin: 0;
  white-space: nowrap;
}
input, textarea, select {
  width: 100%; box-sizing: border-box; margin-bottom: var(--ah-space-2);
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent); border-radius: var(--ah-radius);
  padding: 4px 6px; font: inherit;
}
textarea { min-height: 72px; resize: vertical; }
.hint { opacity: 0.7; font-size: 11px; }
.bound-banner {
  padding: 6px 8px; margin-bottom: 8px; border-radius: var(--ah-radius);
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-testing-iconPassed, #3ba55d);
  font-size: 12px;
}
.guide-step { margin-bottom: var(--ah-space-3); padding-bottom: var(--ah-space-2); border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25)); }
.guide-step .n { font-size: 10px; text-transform: uppercase; opacity: 0.65; }
.var-section { margin-bottom: var(--ah-space-2); }
.var-section h3 { font-size: 11px; margin: 0 0 4px; opacity: 0.85; }
.var-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
}
.var-row input[type="checkbox"] { width: auto; margin: 0; }
.chip { font-size: 10px; opacity: 0.75; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 0 6px; }
.cmdk {
  display: none; position: fixed; inset: 0; z-index: 20;
  background: rgba(0,0,0,0.35); align-items: flex-start; justify-content: center; padding-top: 12vh;
}
.cmdk.open { display: flex; }
.cmdk-panel {
  width: min(420px, 92vw); background: var(--vscode-editorWidget-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius); padding: 8px;
}
.cmdk-list button {
  display: block; width: 100%; text-align: left; margin-top: 4px;
  background: transparent; border: 0; color: inherit; padding: 6px 8px; border-radius: var(--ah-radius); cursor: pointer; font: inherit;
}
.cmdk-list button:hover, .cmdk-list button.active { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.2)); }
.insert-menu {
  position: absolute; z-index: 5; min-width: 140px;
  background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border);
  border-radius: var(--ah-radius); padding: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
}
.insert-menu button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  color: inherit; padding: 4px 8px; cursor: pointer; font: inherit; border-radius: var(--ah-radius);
}
.insert-menu button:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.2)); }
</style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-titles">
      <h1 id="title">Scenario</h1>
      <div class="subtitle" id="subtitle"></div>
    </div>
    <span id="run-status" aria-live="polite"></span>
    <button type="button" id="btn-save">Save</button>
    <button type="button" class="primary" id="btn-run">Run</button>
  </div>
  <div class="banner" id="diff-banner">
    <span id="diff-copy"></span>
    <button type="button" id="btn-dismiss-banner" title="Dismiss" aria-label="Dismiss">×</button>
  </div>
  <div class="layout">
    <aside class="palette" id="palette">
      <input id="palette-search" type="search" placeholder="Search steps…" aria-label="Search steps" />
      <h2>Requests</h2>
      <button type="button" class="palette-item" data-add="request">Request</button>
      <button type="button" class="palette-link" id="btn-open-auth">Manage Authentication…</button>
      <h2>Logic</h2>
      <button type="button" class="palette-item" data-add="condition">Condition</button>
      <h2>Variables</h2>
      <button type="button" class="palette-item" data-add="variable">Variable</button>
      <h2>Utilities</h2>
      <button type="button" class="palette-item" data-add="delay">Delay</button>
      <button type="button" class="palette-item" data-add="group">Group</button>
      <p class="hint" style="margin-top:8px">Ctrl/Cmd+K opens the command palette.</p>
    </aside>
    <div class="canvas-wrap soft-grid" id="canvas">
      <div class="bind-banner hidden" id="bind-banner" aria-live="polite"></div>
      <div class="result-strip hidden" id="result-strip" aria-live="polite"></div>
      <div class="teach-strip" id="teach-strip" hidden></div>
      <svg class="edges" id="edges"></svg>
      <div id="nodes"></div>
      <div id="edge-pluses"></div>
      <div id="insert-menu-host"></div>
    </div>
    <aside class="side">
      <section>
        <h2>Properties</h2>
        <div id="props"></div>
      </section>
      <section>
        <h2>Variables</h2>
        <div id="vars"></div>
      </section>
      <section>
        <h2>Inspector</h2>
        <div id="inspector" class="hint"></div>
      </section>
    </aside>
  </div>
  <div class="cmdk" id="cmdk" aria-hidden="true">
    <div class="cmdk-panel">
      <input id="cmdk-input" type="search" placeholder="Add step or focus palette search…" aria-label="Command palette search" />
      <div class="cmdk-list" id="cmdk-list"></div>
    </div>
  </div>
<script nonce="${escapeAttribute(nonce)}">
const vscode = acquireVsCodeApi();
const MASK = ${maskLiteral};
const DIFFERENTIATION = ${differentiationLiteral};
let scenario = null;
let selectedId = undefined;
let catalog = [];
let annotations = [];
let runStatusByStep = {};
let bannerDismissed = false;
let insertMenu = null;
let dragging = null;
let runLifecycle = 'idle';
let applyTimer = null;

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function titleCaseStatus(status){
  const s = String(status||'');
  if(!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function isEntryOnly(){
  if(!scenario || !scenario.steps || scenario.steps.length !== 1) return false;
  const s = scenario.steps[0];
  return s.type === 'delay' && (s.durationMs||0) === 0;
}

function isEntryStep(step){
  if(!step || step.type !== 'delay' || (step.durationMs||0) !== 0) return false;
  const name = String(step.name||'').toLowerCase();
  const desc = String(step.description||'').toLowerCase();
  return /^(start|entry|when this workflow runs)$/u.test(name.trim())
    || name.includes('entry')
    || desc.includes('entry');
}

function isStubStep(step){
  if(!step || step.type !== 'delay' || (step.durationMs||0) !== 0) return false;
  const name = String(step.name||'');
  const desc = String(step.description||'').toLowerCase();
  return /^(true|false) branch$/iu.test(name.trim())
    || desc.includes('add steps here')
    || /branch stub/i.test(desc);
}

function displayStepType(step){
  if(isEntryStep(step)) return 'Entry';
  if(isStubStep(step)) return 'Stub';
  return step.type;
}

function isRequestUnbound(step){
  if(!step || step.type !== 'request') return false;
  const requestId = String(step.requestId||'');
  if(requestId.startsWith('pending:')) return true;
  const filePath = String(step.requestFilePath||'').trim();
  if(filePath.length > 0) return false;
  const requestRef = String(step.requestRef||'').trim();
  if(!requestRef) return true;
  if(!catalog || catalog.length === 0) return true;
  // Catalog match ≈ host resolveScenarioRequestRef (name or id).
  const matched = catalog.some(e => e.name === requestRef || e.requestId === requestRef
    || (e.folderPath && (e.folderPath+'/'+e.name) === requestRef));
  return !matched;
}

function getUnboundRequestSteps(){
  if(!scenario) return [];
  return (scenario.steps||[]).filter(isRequestUnbound);
}

function setRunStatusChip(text){
  const el = document.getElementById('run-status');
  if(el) el.textContent = text || '';
}

function updateRunButton(){
  const btn = document.getElementById('btn-run');
  if(!btn) return;
  const unbound = getUnboundRequestSteps();
  const running = runLifecycle === 'running';
  btn.disabled = running || unbound.length > 0;
  btn.title = unbound.length ? 'Bind requests first' : (running ? 'Run in progress' : '');
}

function renderBindBanner(){
  const el = document.getElementById('bind-banner');
  if(!el || !scenario) return;
  const unbound = getUnboundRequestSteps();
  if(unbound.length === 0){
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = '<strong>Bind '+esc(unbound.length)+' request step(s) before this workflow can run</strong>'
    + unbound.map(s => '<div class="bind-row"><span>'+esc(s.name)
      +(s.requestRef ? ' <span class="hint">('+esc(s.requestRef)+')</span>' : '')
      +'</span><button type="button" data-bind="'+esc(s.id)+'">Choose Request…</button></div>').join('');
  el.querySelectorAll('[data-bind]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const id = btn.getAttribute('data-bind');
      selectedId = id;
      vscode.postMessage({ type: 'pickRequest', stepId: id });
      renderAll();
    };
  });
}

function showResultStrip(status){
  const el = document.getElementById('result-strip');
  if(!el) return;
  const label = status === 'completed' ? 'Completed'
    : status === 'cancelled' ? 'Cancelled'
    : status === 'failed' ? 'Failed'
    : String(status||'finished');
  el.classList.remove('hidden');
  el.innerHTML = '<span>Run finished ('+esc(label)+'). Open Scenario Report for details.</span>'
    + '<button type="button" id="btn-dismiss-result" title="Dismiss" aria-label="Dismiss">×</button>';
  const dismiss = document.getElementById('btn-dismiss-result');
  if(dismiss) dismiss.onclick = () => { el.classList.add('hidden'); el.innerHTML = ''; };
}

function layoutPositions(sc){
  const positions = new Map();
  sc.steps.forEach((step, i) => {
    if (step.position) positions.set(step.id, step.position);
    else positions.set(step.id, { x: 40 + (i % 3) * 180, y: 40 + Math.floor(i / 3) * 100 });
  });
  return positions;
}

function edgeLabelFor(connection){
  const posted = annotations.find(a => a.connectionId === connection.id);
  if(posted && posted.label) return posted.label;
  if(!scenario) return '';
  const byId = new Map(scenario.steps.map(s => [s.id, s]));
  const from = byId.get(connection.fromStepId);
  const to = byId.get(connection.toStepId);
  if(from && from.type === 'condition'){
    if(from.trueBranch === connection.id) return 'True';
    if(from.falseBranch === connection.id) return 'False';
  }
  if(from && to && to.type === 'request'){
    if(from.type === 'variable' && from.assignments && from.assignments[0]){
      return from.assignments[0].name + ' → next';
    }
    if(from.type === 'request' && from.outputs && from.outputs[0]){
      const n = from.outputs[0].targetVariable || from.outputs[0].name || 'data';
      return n + ' → next';
    }
  }
  return '';
}

function clearRunHighlights(){ runStatusByStep = {}; }

function renderCanvas(){
  if(!scenario) return;
  const canvas = document.getElementById('canvas');
  canvas.classList.toggle('soft-grid', isEntryOnly() || (scenario.connections||[]).length === 0);
  const teach = document.getElementById('teach-strip');
  if(isEntryOnly()){
    teach.hidden = false;
    teach.innerHTML = '<strong>How do I automate this API workflow?</strong><br/>'
      + 'Add a Request, then bind it to a Collection request. '
      + 'Data flows from one step to the next — that is what makes Scenarios different from Collection Runner.'
      + '<div class="cta-row">'
      + '<button type="button" id="teach-add-request">Add Request</button>'
      + '<button type="button" id="teach-bind-help">How to bind</button>'
      + '</div>';
    const addBtn = document.getElementById('teach-add-request');
    if(addBtn) addBtn.onclick = (ev) => { ev.stopPropagation(); addStep('request', {}); };
    const helpBtn = document.getElementById('teach-bind-help');
    if(helpBtn) helpBtn.onclick = (ev) => {
      ev.stopPropagation();
      teach.innerHTML = '<strong>Bind requests before Run</strong><br/>'
        + 'Template steps start unbound. Select a Request step and click <em>Choose Request…</em> to link a Collection request.'
        + '<div class="cta-row"><button type="button" id="teach-add-request">Add Request</button></div>';
      const again = document.getElementById('teach-add-request');
      if(again) again.onclick = (e2) => { e2.stopPropagation(); addStep('request', {}); };
    };
  } else {
    teach.hidden = true;
    teach.innerHTML = '';
  }
  renderBindBanner();
  const positions = layoutPositions(scenario);
  const nodesEl = document.getElementById('nodes');
  nodesEl.innerHTML = scenario.steps.map(step => {
    const p = positions.get(step.id);
    const sel = step.id === selectedId ? ' selected' : '';
    const rs = runStatusByStep[step.id];
    const statusClass = rs ? ' '+rs.status : '';
    const entryClass = isEntryStep(step) ? ' entry' : '';
    const stubClass = isStubStep(step) ? ' stub' : '';
    const statusWord = rs ? '<div class="status-word">'+esc(titleCaseStatus(rs.status))+'</div>' : '';
    const badge = rs && rs.durationMs != null ? '<div class="badge">'+esc(rs.durationMs)+' ms</div>' : '';
    return '<div class="node'+sel+statusClass+entryClass+stubClass+'" data-id="'+esc(step.id)+'" style="left:'+p.x+'px;top:'+p.y+'px">'
      +'<div class="type">'+esc(displayStepType(step))+'</div>'
      +'<div class="name">'+esc(step.name)+'</div>'+statusWord+badge+'</div>';
  }).join('');
  nodesEl.querySelectorAll('.node').forEach(el => {
    el.addEventListener('click', (ev) => {
      if(dragging && dragging.moved) return;
      selectedId = el.getAttribute('data-id');
      vscode.postMessage({ type: 'selectStep', stepId: selectedId });
      renderAll();
    });
    el.addEventListener('mousedown', (ev) => {
      if(ev.button !== 0) return;
      const id = el.getAttribute('data-id');
      const p = positions.get(id);
      dragging = { id, startX: ev.clientX, startY: ev.clientY, origX: p.x, origY: p.y, moved: false };
      ev.preventDefault();
    });
  });
  const svg = document.getElementById('edges');
  let maxX = 400, maxY = 300;
  positions.forEach(p => { maxX = Math.max(maxX, p.x + 220); maxY = Math.max(maxY, p.y + 140); });
  svg.setAttribute('viewBox', '0 0 '+maxX+' '+maxY);
  svg.style.width = maxX+'px'; svg.style.height = maxY+'px';
  const lines = scenario.connections.map(c => {
    const a = positions.get(c.fromStepId); const b = positions.get(c.toStepId);
    if(!a||!b) return '';
    const x1 = a.x + 60, y1 = a.y + 28, x2 = b.x + 60, y2 = b.y + 10;
    const mx = (x1+x2)/2, my = (y1+y2)/2;
    const label = edgeLabelFor(c);
    const labelSvg = label
      ? '<text x="'+mx+'" y="'+(my-6)+'" fill="var(--vscode-foreground)" fill-opacity="0.7" font-size="10" text-anchor="middle">'+esc(label)+'</text>'
      : '';
    return '<line class="edge-hit" data-conn="'+esc(c.id)+'" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="transparent" stroke-width="12" />'
      + '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="var(--vscode-foreground)" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arrow)" />'
      + labelSvg;
  }).join('');
  svg.innerHTML = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--vscode-foreground)" fill-opacity="0.45"/></marker></defs>' + lines;

  const plusHost = document.getElementById('edge-pluses');
  const plusBits = [];
  scenario.steps.forEach(step => {
    if(step.type === 'group') return;
    const p = positions.get(step.id);
    const outgoing = (scenario.connections||[]).filter(c => c.fromStepId === step.id);
    if(outgoing.length === 0 || step.id === selectedId){
      plusBits.push('<button type="button" class="edge-plus'+(step.id===selectedId?' visible':'')+'" data-after="'+esc(step.id)+'" style="left:'+(p.x+130)+'px;top:'+(p.y+18)+'px" title="Insert step">+</button>');
    }
  });
  (scenario.connections||[]).forEach(c => {
    const a = positions.get(c.fromStepId); const b = positions.get(c.toStepId);
    if(!a||!b) return;
    const mx = (a.x+b.x)/2 + 50, my = (a.y+b.y)/2 + 10;
    plusBits.push('<button type="button" class="edge-plus" data-conn="'+esc(c.id)+'" style="left:'+mx+'px;top:'+my+'px" title="Insert on edge">+</button>');
  });
  plusHost.innerHTML = plusBits.join('');
  plusHost.querySelectorAll('.edge-plus').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openInsertMenu(ev.clientX, ev.clientY, btn.getAttribute('data-after'), btn.getAttribute('data-conn'));
    });
  });
  updateRunButton();
}

function openInsertMenu(clientX, clientY, afterStepId, connectionId){
  closeInsertMenu();
  const host = document.getElementById('insert-menu-host');
  const canvasRect = document.getElementById('canvas').getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'insert-menu';
  menu.style.left = (clientX - canvasRect.left + document.getElementById('canvas').scrollLeft) + 'px';
  menu.style.top = (clientY - canvasRect.top + document.getElementById('canvas').scrollTop) + 'px';
  const types = [['request','Request'],['condition','Condition'],['variable','Variable'],['delay','Delay'],['group','Group']];
  menu.innerHTML = types.map(([t,l]) => '<button type="button" data-type="'+t+'">'+l+'</button>').join('');
  menu.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      addStep(b.getAttribute('data-type'), { afterStepId, connectionId });
      closeInsertMenu();
    };
  });
  host.appendChild(menu);
  insertMenu = menu;
}

function closeInsertMenu(){
  if(insertMenu){ insertMenu.remove(); insertMenu = null; }
}

function createStubCondition(x, y){
  const ok = { id: crypto.randomUUID(), type: 'delay', name: 'True branch', durationMs: 0, position: { x: x + 180, y: y - 60 }, description: 'Add steps here' };
  const fail = { id: crypto.randomUUID(), type: 'delay', name: 'False branch', durationMs: 0, position: { x: x + 180, y: y + 60 }, description: 'Add steps here' };
  const trueId = crypto.randomUUID();
  const falseId = crypto.randomUUID();
  const cond = {
    id: crypto.randomUUID(), type: 'condition', name: 'Condition', expression: 'statusCode == 200',
    trueBranch: trueId, falseBranch: falseId, position: { x, y },
    description: 'Branch on true or false.'
  };
  const connections = [
    { id: trueId, fromStepId: cond.id, toStepId: ok.id },
    { id: falseId, fromStepId: cond.id, toStepId: fail.id },
  ];
  return { steps: [cond, ok, fail], connections };
}

function makeStep(type, x, y){
  if(type === 'condition') return createStubCondition(x, y);
  if(type === 'request'){
    return { steps: [{
      id: crypto.randomUUID(), type: 'request', name: 'Request', requestId: 'pending:Request',
      requestFilePath: '', requestOffset: 0, requestRef: 'Request', inputMappings: [], position: { x, y }
    }], connections: [] };
  }
  if(type === 'variable'){
    return { steps: [{
      id: crypto.randomUUID(), type: 'variable', name: 'Set Variables',
      assignments: [{ name: 'value', value: '' }], position: { x, y }
    }], connections: [] };
  }
  if(type === 'group'){
    return { steps: [{
      id: crypto.randomUUID(), type: 'group', name: 'Group', stepIds: [], position: { x, y }
    }], connections: [] };
  }
  return { steps: [{
    id: crypto.randomUUID(), type: 'delay', name: 'Delay', durationMs: 0, position: { x, y }
  }], connections: [] };
}

function addStep(type, opts){
  if(!scenario) return;
  opts = opts || {};
  const positions = layoutPositions(scenario);
  let x = 40, y = 40;
  if(opts.afterStepId && positions.get(opts.afterStepId)){
    const p = positions.get(opts.afterStepId);
    x = p.x + 180; y = p.y;
  } else if(scenario.steps.length){
    x = 40 + (scenario.steps.length % 3) * 180;
    y = 40 + Math.floor(scenario.steps.length / 3) * 100;
  }
  const built = makeStep(type, x, y);
  const primary = built.steps[0];
  let connections = [...(scenario.connections||[]), ...built.connections];
  let steps = [...scenario.steps, ...built.steps];

  if(opts.connectionId){
    const conn = connections.find(c => c.id === opts.connectionId);
    if(conn){
      const toId = conn.toStepId;
      connections = connections.map(c => c.id === opts.connectionId ? { ...c, toStepId: primary.id } : c);
      if(primary.type !== 'group'){
        connections.push({ id: crypto.randomUUID(), fromStepId: primary.id, toStepId: toId });
      }
    }
  } else if(opts.afterStepId){
    const from = steps.find(s => s.id === opts.afterStepId);
    if(from && from.type !== 'group' && primary.type !== 'group'){
      const existingOut = connections.filter(c => c.fromStepId === from.id);
      if(from.type === 'condition'){
        // leave branch wiring alone; just add node
      } else if(existingOut.length === 0){
        connections.push({ id: crypto.randomUUID(), fromStepId: from.id, toStepId: primary.id });
      } else {
        // insert before first outgoing target
        const first = existingOut[0];
        connections = connections.map(c => c.id === first.id ? { ...c, toStepId: primary.id } : c);
        connections.push({ id: crypto.randomUUID(), fromStepId: primary.id, toStepId: first.toStepId });
      }
    }
  }

  scenario = { ...scenario, steps, connections };
  selectedId = primary.id;
  renderAll();
}

function deleteStep(stepId){
  if(!scenario) return;
  if(!scenario.steps.some(s => s.id === stepId)) return;
  let steps = scenario.steps.filter(s => s.id !== stepId);
  let connections = (scenario.connections||[]).filter(c => c.fromStepId !== stepId && c.toStepId !== stepId);
  const repaired = [];
  const extraSteps = [];
  const extraConns = [];
  for(const s of steps){
    if(s.type !== 'condition'){ repaired.push(s); continue; }
    const trueOk = connections.some(c => c.id === s.trueBranch);
    const falseOk = connections.some(c => c.id === s.falseBranch);
    if(trueOk && falseOk){ repaired.push(s); continue; }
    const stub = createStubCondition((s.position&&s.position.x)||40, (s.position&&s.position.y)||40);
    const cond = { ...stub.steps[0], id: s.id, name: s.name, expression: s.expression || stub.steps[0].expression };
    repaired.push(cond);
    extraSteps.push(...stub.steps.slice(1));
    connections = connections.filter(c => c.fromStepId !== s.id);
    extraConns.push(...stub.connections.map(c => ({ ...c, fromStepId: s.id })));
  }
  scenario = {
    ...scenario,
    steps: [...repaired, ...extraSteps],
    connections: [...connections, ...extraConns],
  };
  if(selectedId === stepId) selectedId = undefined;
  renderAll();
}

function stepName(id){
  const s = scenario && scenario.steps.find(x => x.id === id);
  return s ? s.name : id;
}

function renderProps(){
  const el = document.getElementById('props');
  if(!scenario){ el.innerHTML = ''; return; }
  if(!selectedId){
    el.innerHTML = '<p class="hint">Select a step to configure it. Scenarios automate a workflow across requests.</p>'
      + '<label>Scenario description</label><textarea id="f-scenario-desc">'+esc(scenario.description||'')+'</textarea>'
      + '<p class="hint">Changes apply automatically.</p>';
    const desc = document.getElementById('f-scenario-desc');
    if(desc){
      desc.oninput = () => scheduleApply(() => {
        scenario = { ...scenario, description: desc.value.trim() || undefined };
        document.getElementById('subtitle').textContent = scenario.description || DIFFERENTIATION;
      });
    }
    return;
  }
  const step = scenario.steps.find(s => s.id === selectedId);
  if(!step){ el.innerHTML = '<p class="hint">Unknown step.</p>'; return; }

  let body = '<label>Name</label><input id="f-name" value="'+esc(step.name)+'" />';
  if(step.type === 'request'){
    const unbound = isRequestUnbound(step);
    const boundLabel = step.requestRef || step.name || '(none)';
    if(!unbound){
      body += '<div class="bound-banner">Bound to: <strong>'+esc(boundLabel)+'</strong></div>';
    }
    body += '<div class="guide-step"><div class="n">1. Choose Request</div>'
      + '<button type="button" id="btn-pick-request">Choose Request…</button>'
      + (unbound ? '<p class="hint">Bind this step to a Collection request before Run.</p>' : '')
      + '<details><summary class="hint">Advanced</summary>'
      + '<label>Collection request</label><input id="f-requestRef" value="'+esc(step.requestRef||'')+'" />'
      + '</details></div>'
      + '<div class="guide-step"><div class="n">2. Authentication</div>'
      + '<p class="hint">This step uses auth from the bound Collection request. Open Manage Authentication… to manage profiles.</p>'
      + '<button type="button" id="btn-props-auth">Manage Authentication…</button></div>'
      + '<div class="guide-step"><div class="n">3. Map Variables</div>'
      + '<label>Map variables into this request (workflowVar = requestVar per line)</label><textarea id="f-mappings">'
      +esc((step.inputMappings||[]).map(m=>m.variable+'='+m.requestVariable).join('\\n'))+'</textarea></div>'
      + '<div class="guide-step"><div class="n">4. Capture outputs</div>'
      + '<label>Capture from response (name | source | optionalVariable per line)</label><textarea id="f-outputs">'
      +esc((step.outputs||[]).map(o=>o.name+'|'+o.source+(o.targetVariable?'|'+o.targetVariable:'')).join('\\n'))+'</textarea></div>'
      + '<div class="guide-step"><div class="n">5. Preview</div><p class="hint">Will call: '+esc(boundLabel)+'</p></div>';
  } else if(step.type === 'delay'){
    body += '<div class="guide-step"><div class="n">Duration</div>'
      + '<label>Duration (ms)</label><input id="f-duration" type="number" value="'+esc(step.durationMs)+'" /></div>'
      + '<div class="guide-step"><div class="n">Purpose</div>'
      + '<label>description</label><textarea id="f-desc">'+esc(step.description||'')+'</textarea></div>';
  } else if(step.type === 'condition'){
    const t = (scenario.connections||[]).find(c => c.id === step.trueBranch);
    const f = (scenario.connections||[]).find(c => c.id === step.falseBranch);
    body += '<div class="guide-step"><div class="n">Expression</div>'
      + '<textarea id="f-expression">'+esc(step.expression||'')+'</textarea>'
      + '<p class="hint">e.g. statusCode == 200</p></div>'
      + '<div class="guide-step"><div class="n">Branches</div>'
      + '<p class="hint">True → '+esc(t ? stepName(t.toStepId) : '(missing)')+'</p>'
      + '<p class="hint">False → '+esc(f ? stepName(f.toStepId) : '(missing)')+'</p></div>';
  } else if(step.type === 'variable'){
    body += '<div class="guide-step"><div class="n">Assignments</div>'
      + '<label>name=value per line</label><textarea id="f-assignments">'
      +esc((step.assignments||[]).map(a=>a.name+'='+a.value).join('\\n'))+'</textarea></div>';
  } else if(step.type === 'group'){
    body += '<p class="hint">Group is UI-only (pass-through at runtime). Use it to visually cluster steps.</p>';
  }
  body += '<p class="hint">Changes apply automatically.</p>'
    + '<button type="button" id="btn-delete-step">Delete step</button>';
  el.innerHTML = body;

  const pickBtn = document.getElementById('btn-pick-request');
  if(pickBtn) pickBtn.onclick = () => vscode.postMessage({ type: 'pickRequest', stepId: step.id });
  const authBtn = document.getElementById('btn-props-auth');
  if(authBtn) authBtn.onclick = () => vscode.postMessage({ type: 'openAuth' });
  document.getElementById('btn-delete-step').onclick = () => deleteStep(step.id);

  function applyStepFields(){
    if(!scenario || selectedId !== step.id) return;
    const nameEl = document.getElementById('f-name');
    if(!nameEl) return;
    const name = nameEl.value.trim() || step.name;
    const next = { ...step, name };
    if(step.type==='request'){
      const refEl = document.getElementById('f-requestRef');
      if(refEl){
        next.requestRef = refEl.value.trim() || undefined;
        if(!next.requestId || String(next.requestId).startsWith('pending:')){
          next.requestId = next.requestRef ? ('pending:'+next.requestRef) : next.requestId;
        }
      }
      const mapEl = document.getElementById('f-mappings');
      if(mapEl){
        next.inputMappings = mapEl.value.split(/\\r?\\n/).map(line=>{
          const i = line.indexOf('='); if(i<0) return null;
          return { variable: line.slice(0,i).trim(), requestVariable: line.slice(i+1).trim() };
        }).filter(m => m && m.variable && m.requestVariable);
      }
      const outEl = document.getElementById('f-outputs');
      if(outEl){
        next.outputs = outEl.value.split(/\\r?\\n/).map(line=>{
          const parts = line.split('|').map(p=>p.trim());
          if(!parts[0] || !parts[1]) return null;
          const o = { name: parts[0], source: parts[1] };
          if(parts[2]) o.targetVariable = parts[2];
          return o;
        }).filter(Boolean);
        if(next.outputs.length === 0) delete next.outputs;
      }
    } else if(step.type==='delay'){
      const dur = document.getElementById('f-duration');
      const dEl = document.getElementById('f-desc');
      if(dur) next.durationMs = Math.max(0, Number(dur.value)||0);
      if(dEl){
        const d = dEl.value.trim();
        if(d) next.description = d; else delete next.description;
      }
    } else if(step.type==='condition'){
      const expr = document.getElementById('f-expression');
      if(expr) next.expression = expr.value;
    } else if(step.type==='variable'){
      const asg = document.getElementById('f-assignments');
      if(asg){
        next.assignments = asg.value.split(/\\r?\\n/).map(line=>{
          const i = line.indexOf('='); if(i<0) return null;
          return { name: line.slice(0,i).trim(), value: line.slice(i+1) };
        }).filter(Boolean);
      }
    }
    scenario = { ...scenario, steps: scenario.steps.map(s => s.id===step.id ? next : s) };
    renderCanvas();
    renderVars();
    renderInspector();
    updateRunButton();
  }

  ['f-name','f-requestRef','f-mappings','f-outputs','f-duration','f-desc','f-expression','f-assignments'].forEach(id => {
    const field = document.getElementById(id);
    if(!field) return;
    const handler = () => scheduleApply(applyStepFields);
    field.addEventListener('input', handler);
    field.addEventListener('change', handler);
    field.addEventListener('blur', () => { if(applyTimer){ clearTimeout(applyTimer); applyTimer = null; } applyStepFields(); });
  });
}

function scheduleApply(fn){
  if(applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(() => { applyTimer = null; fn(); }, 300);
}

function displayDefaultValue(v){
  if(v.sensitive && v.defaultValue) return MASK;
  return v.defaultValue || '';
}

function scanPublishedConsumed(){
  const published = [];
  const consumed = [];
  if(!scenario) return { published, consumed };
  for(const step of scenario.steps){
    if(step.type === 'variable'){
      for(const a of step.assignments||[]) published.push({ token: a.name, stepName: step.name });
    }
    if(step.outputs){
      for(const o of step.outputs){
        if(o.targetVariable) published.push({ token: o.targetVariable, stepName: step.name });
        else if(o.name) published.push({ token: o.name, stepName: step.name });
      }
    }
    if(step.type === 'request'){
      for(const m of step.inputMappings||[]) consumed.push({ token: m.variable, stepName: step.name });
    }
  }
  return { published, consumed };
}

function renderVars(){
  const el = document.getElementById('vars');
  if(!scenario){ el.innerHTML=''; return; }
  const { published, consumed } = scanPublishedConsumed();
  const inputs = scenario.variables || [];
  if(inputs.length === 0 && published.length === 0 && consumed.length === 0){
    el.innerHTML = '<p class="hint">Variables hand data between steps. Add scenario inputs here, publish outputs from Request/Variable steps, and map them into later requests.</p>'
      + '<button type="button" id="btn-add-var">Add input variable</button>';
  } else {
    el.innerHTML = '<div class="var-section"><h3>Run inputs <span class="chip">provided when the workflow starts</span></h3>'
      + inputs.map(v =>
        '<div class="var-row">'
          +'<input data-var-name value="'+esc(v.name)+'" placeholder="name" />'
          +'<input data-var-value value="'+esc(displayDefaultValue(v))+'" placeholder="'+(v.sensitive ? esc(MASK) : 'default')+'" />'
          +'<label class="checkbox-label"><input data-var-sensitive type="checkbox"'+(v.sensitive ? ' checked' : '')+' /> Sensitive</label>'
        +'</div>'
      ).join('')
      + '<button type="button" id="btn-add-var">Add input variable</button></div>'
      + '<div class="var-section"><h3>Produced by steps</h3>'
      + (published.length
        ? '<p class="hint">'+published.map(p => esc(p.token)+' ← '+esc(p.stepName)).join('<br/>')+'</p>'
        : '<p class="hint">No published outputs yet.</p>')
      + '</div>'
      + '<div class="var-section"><h3>Used by requests</h3>'
      + (consumed.length
        ? '<p class="hint">'+consumed.map(c => esc(c.token)+' → '+esc(c.stepName)).join('<br/>')+'</p>'
        : '<p class="hint">No request mappings consume variables yet.</p>')
      + '</div>';
  }
  const addBtn = document.getElementById('btn-add-var');
  if(addBtn) addBtn.onclick = () => {
    scenario = {
      ...scenario,
      variables: [...(scenario.variables||[]), { id: crypto.randomUUID(), name: 'var'+(scenario.variables.length+1), scope: 'scenario', defaultValue: '', sensitive: false }]
    };
    renderAll();
  };
}

function renderInspector(){
  const el = document.getElementById('inspector');
  if(!scenario){ el.textContent=''; return; }
  if(catalog.length === 0){
    el.innerHTML = '<p class="hint">No requests in the catalog yet. Create requests in Collections first.</p>'
      + '<p class="hint">Scenarios call Collection requests.</p>';
  } else if(!selectedId){
    el.innerHTML = '<p class="hint">'+esc(scenario.steps.length)+' steps · '+esc((scenario.connections||[]).length)+' connections · '+esc(catalog.length)+' catalog requests</p>'
      + '<p class="hint">Select a step for guided setup, or Run to execute this workflow.</p>';
  } else {
    const step = scenario.steps.find(s => s.id === selectedId);
    const conns = (scenario.connections||[]).filter(c => c.fromStepId === selectedId || c.toStepId === selectedId)
      .map(c => stepName(c.fromStepId)+' → '+stepName(c.toStepId)).join('\\n') || 'No connections on this step';
    el.innerHTML = '<pre style="white-space:pre-wrap;margin:0;font:inherit">'+esc(conns)+'</pre>'
      + (step && step.description ? '<p class="hint">'+esc(step.description)+'</p>' : '');
  }
}

function renderPaletteFilter(){
  const q = (document.getElementById('palette-search').value || '').trim().toLowerCase();
  document.querySelectorAll('.palette-item[data-add]').forEach(btn => {
    const label = (btn.textContent || '').toLowerCase();
    btn.style.display = !q || label.includes(q) || (btn.getAttribute('data-add')||'').includes(q) ? '' : 'none';
  });
}

function renderAll(){
  if(!scenario) return;
  if(document.querySelector('#vars [data-var-name]')){
    scenario = { ...scenario, variables: collectVariablesFromUi() };
  }
  document.getElementById('title').textContent = scenario.name || 'Scenario';
  const subtitle = document.getElementById('subtitle');
  if(isEntryOnly()){
    subtitle.textContent = scenario.description || 'How do I automate an API workflow?';
  } else if(bannerDismissed){
    subtitle.textContent = scenario.description || DIFFERENTIATION;
  } else {
    subtitle.textContent = scenario.description || 'How do I automate an API workflow?';
  }
  document.getElementById('diff-copy').textContent = DIFFERENTIATION;
  // Prefer teach strip for entry-only; otherwise show dismissible banner.
  document.getElementById('diff-banner').classList.toggle('hidden', bannerDismissed || isEntryOnly());
  renderCanvas();
  renderProps();
  renderVars();
  renderInspector();
  renderPaletteFilter();
  updateRunButton();
}

function collectVariablesFromUi(){
  const names = [...document.querySelectorAll('#vars [data-var-name]')];
  const values = [...document.querySelectorAll('#vars [data-var-value]')];
  const sensitives = [...document.querySelectorAll('#vars [data-var-sensitive]')];
  return names.map((n,i)=>{
    const prior = scenario.variables[i];
    const sensitive = sensitives[i] ? sensitives[i].checked === true : (prior && prior.sensitive === true);
    let defaultValue = values[i] ? values[i].value : '';
    if(sensitive && defaultValue === MASK){
      defaultValue = prior && prior.defaultValue !== undefined ? prior.defaultValue : MASK;
    }
    const entry = {
      id: (prior && prior.id) || crypto.randomUUID(),
      name: n.value.trim(),
      scope: 'scenario',
      sensitive: sensitive === true,
    };
    if(defaultValue !== undefined && defaultValue !== ''){
      entry.defaultValue = defaultValue;
    }
    return entry;
  }).filter(v=>v.name);
}

function buildScenarioForHost(){
  return {
    ...scenario,
    variables: collectVariablesFromUi(),
    metadata: { ...scenario.metadata, updatedAt: new Date().toISOString() },
  };
}

document.getElementById('btn-save').onclick = () => {
  if(!scenario) return;
  scenario = buildScenarioForHost();
  vscode.postMessage({ type: 'save', scenario });
};
document.getElementById('btn-run').onclick = () => {
  if(!scenario) return;
  const unbound = getUnboundRequestSteps();
  if(unbound.length > 0){
    renderBindBanner();
    updateRunButton();
    setRunStatusChip('Bind requests first');
    return;
  }
  clearRunHighlights();
  runLifecycle = 'running';
  setRunStatusChip('Running…');
  updateRunButton();
  const strip = document.getElementById('result-strip');
  if(strip){ strip.classList.add('hidden'); strip.innerHTML = ''; }
  renderCanvas();
  scenario = buildScenarioForHost();
  vscode.postMessage({ type: 'run', scenario });
};
document.getElementById('btn-dismiss-banner').onclick = () => {
  bannerDismissed = true;
  document.getElementById('diff-banner').classList.add('hidden');
  vscode.postMessage({ type: 'dismissBanner' });
  if(scenario){
    document.getElementById('subtitle').textContent = scenario.description || DIFFERENTIATION;
  }
};
document.getElementById('btn-open-auth').onclick = () => vscode.postMessage({ type: 'openAuth' });
document.querySelectorAll('.palette-item[data-add]').forEach(btn => {
  btn.addEventListener('click', () => addStep(btn.getAttribute('data-add'), {}));
});
document.getElementById('palette-search').addEventListener('input', renderPaletteFilter);

document.addEventListener('mousemove', (ev) => {
  if(!dragging || !scenario) return;
  const dx = ev.clientX - dragging.startX;
  const dy = ev.clientY - dragging.startY;
  if(Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.moved = true;
  const x = Math.max(0, dragging.origX + dx);
  const y = Math.max(0, dragging.origY + dy);
  dragging.curX = x;
  dragging.curY = y;
  document.querySelectorAll('#nodes .node').forEach(el => {
    if(el.getAttribute('data-id') === dragging.id){
      el.style.left = x+'px';
      el.style.top = y+'px';
    }
  });
  // Lightweight edge refresh during drag (no full canvas re-render).
  const positions = layoutPositions(scenario);
  positions.set(dragging.id, { x, y });
  const svg = document.getElementById('edges');
  if(svg){
    let maxX = 400, maxY = 300;
    positions.forEach(p => { maxX = Math.max(maxX, p.x + 220); maxY = Math.max(maxY, p.y + 140); });
    svg.setAttribute('viewBox', '0 0 '+maxX+' '+maxY);
    svg.style.width = maxX+'px'; svg.style.height = maxY+'px';
    const lines = (scenario.connections||[]).map(c => {
      const a = positions.get(c.fromStepId); const b = positions.get(c.toStepId);
      if(!a||!b) return '';
      const x1 = a.x + 60, y1 = a.y + 28, x2 = b.x + 60, y2 = b.y + 10;
      const mx = (x1+x2)/2, my = (y1+y2)/2;
      const label = edgeLabelFor(c);
      const labelSvg = label
        ? '<text x="'+mx+'" y="'+(my-6)+'" fill="var(--vscode-foreground)" fill-opacity="0.7" font-size="10" text-anchor="middle">'+esc(label)+'</text>'
        : '';
      return '<line class="edge-hit" data-conn="'+esc(c.id)+'" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="transparent" stroke-width="12" />'
        + '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="var(--vscode-foreground)" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arrow)" />'
        + labelSvg;
    }).join('');
    svg.innerHTML = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--vscode-foreground)" fill-opacity="0.45"/></marker></defs>' + lines;
  }
});
document.addEventListener('mouseup', () => {
  if(dragging && scenario && dragging.moved){
    const id = dragging.id;
    const x = dragging.curX != null ? dragging.curX : dragging.origX;
    const y = dragging.curY != null ? dragging.curY : dragging.origY;
    scenario = {
      ...scenario,
      steps: scenario.steps.map(s => s.id === id ? { ...s, position: { x, y } } : s),
    };
    dragging = null;
    renderCanvas();
  } else {
    dragging = null;
  }
});
document.getElementById('canvas').addEventListener('click', () => closeInsertMenu());

function openCmdk(){
  const el = document.getElementById('cmdk');
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  const input = document.getElementById('cmdk-input');
  input.value = '';
  renderCmdk('');
  input.focus();
}
function closeCmdk(){
  const el = document.getElementById('cmdk');
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}
function renderCmdk(q){
  const actions = [
    { id: 'request', label: 'Add Request step' },
    { id: 'condition', label: 'Add Condition step' },
    { id: 'variable', label: 'Add Variable step' },
    { id: 'delay', label: 'Add Delay step' },
    { id: 'group', label: 'Add Group step' },
    { id: 'focus-search', label: 'Focus palette search' },
    { id: 'open-auth', label: 'Manage Authentication…' },
  ].filter(a => !q || a.label.toLowerCase().includes(q.toLowerCase()));
  const list = document.getElementById('cmdk-list');
  list.innerHTML = actions.map((a,i) => '<button type="button" data-act="'+a.id+'" class="'+(i===0?'active':'')+'">'+esc(a.label)+'</button>').join('')
    || '<p class="hint">No matches</p>';
  list.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const act = b.getAttribute('data-act');
      closeCmdk();
      if(act === 'focus-search'){ document.getElementById('palette-search').focus(); return; }
      if(act === 'open-auth'){ vscode.postMessage({ type: 'openAuth' }); return; }
      addStep(act, {});
    };
  });
}
document.getElementById('cmdk-input').addEventListener('input', (e) => renderCmdk(e.target.value));
document.addEventListener('keydown', (e) => {
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){
    e.preventDefault();
    if(document.getElementById('cmdk').classList.contains('open')) closeCmdk();
    else openCmdk();
  }
  if(e.key === 'Escape'){ closeCmdk(); closeInsertMenu(); }
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  if(!msg || typeof msg !== 'object') return;
  if(msg.type === 'init' || msg.type === 'update'){
    scenario = msg.scenario;
    if(Array.isArray(msg.catalog)) catalog = msg.catalog;
    if(Array.isArray(msg.annotations)) annotations = msg.annotations;
    if(typeof msg.differentiationCopy === 'string' && msg.differentiationCopy){
      document.getElementById('diff-copy').textContent = msg.differentiationCopy;
    }
    if(typeof msg.bannerDismissed === 'boolean'){
      bannerDismissed = msg.bannerDismissed;
    }
    selectedId = undefined;
    clearRunHighlights();
    runLifecycle = 'idle';
    setRunStatusChip('');
    renderAll();
  }
  if(msg.type === 'catalog' && Array.isArray(msg.entries)){
    catalog = msg.entries;
    renderInspector();
    renderBindBanner();
    updateRunButton();
  }
  if(msg.type === 'requestPicked' && msg.stepId){
    if(!scenario) return;
    scenario = {
      ...scenario,
      steps: scenario.steps.map(s => {
        if(s.id !== msg.stepId || s.type !== 'request') return s;
        return {
          ...s,
          requestRef: msg.requestRef || s.requestRef,
          requestId: msg.requestId || s.requestId,
          requestFilePath: msg.filePath || s.requestFilePath,
          requestOffset: typeof msg.offset === 'number' ? msg.offset : s.requestOffset,
          name: s.name === 'Request' && msg.requestRef ? msg.requestRef : s.name,
        };
      }),
    };
    selectedId = msg.stepId;
    renderAll();
  }
  if(msg.type === 'runProgress' && msg.stepId){
    if(runLifecycle !== 'running'){
      runLifecycle = 'running';
      setRunStatusChip('Running…');
      updateRunButton();
    }
    runStatusByStep[msg.stepId] = {
      status: msg.status === 'started' ? 'running' : msg.status,
      durationMs: msg.durationMs,
    };
    renderCanvas();
  }
  if(msg.type === 'runFinished'){
    runLifecycle = 'idle';
    const status = msg.status || 'completed';
    const chip = status === 'completed' ? 'Completed'
      : status === 'cancelled' ? 'Cancelled'
      : status === 'failed' ? 'Failed'
      : String(status);
    setRunStatusChip(chip);
    updateRunButton();
    showResultStrip(status);
    renderCanvas();
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
