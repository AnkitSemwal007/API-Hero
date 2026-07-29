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

export type ScenarioEditorMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'run'; readonly scenario: Scenario }
  | { readonly type: 'save'; readonly scenario: Scenario }
  | { readonly type: 'selectStep'; readonly stepId: string | undefined };

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
  if (raw.type === 'selectStep') {
    return {
      type: 'selectStep',
      stepId: typeof raw.stepId === 'string' ? raw.stepId : undefined,
    };
  }
  if (raw.type === 'save' || raw.type === 'run') {
    const parsed = parseScenarioPayload(raw.scenario);
    if (!parsed.ok) return undefined;
    return { type: raw.type, scenario: parsed.scenario };
  }
  return undefined;
}

export function renderScenarioEditorHtml(nonce: string): string {
  const csp = buildNonceOnlyCsp(nonce);
  const maskLiteral = JSON.stringify(MASKED_VARIABLE_VALUE);
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
  grid-template-rows: auto 1fr;
  font: 13px/1.4 var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
.toolbar {
  display: flex; gap: var(--ah-space-2); align-items: center;
  padding: var(--ah-space-2) var(--ah-space-3);
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
}
.toolbar h1 { font-size: 13px; margin: 0; flex: 1; }
.layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  min-height: 0;
}
.canvas-wrap {
  position: relative; overflow: auto;
  background:
    linear-gradient(var(--vscode-panel-border, rgba(128,128,128,0.2)) 1px, transparent 1px),
    linear-gradient(90deg, var(--vscode-panel-border, rgba(128,128,128,0.2)) 1px, transparent 1px);
  background-size: 24px 24px;
}
svg.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.node {
  position: absolute; min-width: 120px; max-width: 180px;
  padding: 8px 10px; border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-focusBorder, #007fd4);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.node.selected { outline: 2px solid var(--vscode-focusBorder); }
.node .type { font-size: 10px; text-transform: uppercase; opacity: 0.7; }
.node .name { font-weight: 600; margin-top: 2px; word-break: break-word; }
.side {
  border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  overflow: auto; padding: var(--ah-space-3);
  background: var(--vscode-sideBar-background, transparent);
}
.side h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 var(--ah-space-2); opacity: 0.8; }
.side section { margin-bottom: var(--ah-space-4); }
label { display: block; font-size: 11px; opacity: 0.8; margin-bottom: 2px; }
input, textarea, select {
  width: 100%; box-sizing: border-box; margin-bottom: var(--ah-space-2);
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent); border-radius: var(--ah-radius);
  padding: 4px 6px; font: inherit;
}
textarea { min-height: 72px; resize: vertical; }
.hint { opacity: 0.7; font-size: 11px; }
.var-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
}
.var-row input[type="checkbox"] { width: auto; margin: 0; }
</style>
</head>
<body>
  <div class="toolbar">
    <h1 id="title">Scenario</h1>
    <button type="button" id="btn-save">Save</button>
    <button type="button" class="primary" id="btn-run">Run</button>
  </div>
  <div class="layout">
    <div class="canvas-wrap" id="canvas">
      <svg class="edges" id="edges"></svg>
      <div id="nodes"></div>
    </div>
    <aside class="side">
      <section>
        <h2>Properties</h2>
        <div id="props"><p class="hint">Select a step on the canvas.</p></div>
      </section>
      <section>
        <h2>Variables</h2>
        <div id="vars"></div>
      </section>
      <section>
        <h2>Inspector</h2>
        <div id="inspector" class="hint">Connections and step summary.</div>
      </section>
    </aside>
  </div>
<script nonce="${escapeAttribute(nonce)}">
const vscode = acquireVsCodeApi();
const MASK = ${maskLiteral};
let scenario = null;
let selectedId = undefined;

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function layoutPositions(sc){
  const positions = new Map();
  sc.steps.forEach((step, i) => {
    if (step.position) positions.set(step.id, step.position);
    else positions.set(step.id, { x: 40 + (i % 3) * 180, y: 40 + Math.floor(i / 3) * 100 });
  });
  return positions;
}

function renderCanvas(){
  if(!scenario) return;
  const positions = layoutPositions(scenario);
  const nodesEl = document.getElementById('nodes');
  nodesEl.innerHTML = scenario.steps.map(step => {
    const p = positions.get(step.id);
    const sel = step.id === selectedId ? ' selected' : '';
    return '<div class="node'+sel+'" data-id="'+esc(step.id)+'" style="left:'+p.x+'px;top:'+p.y+'px">'
      +'<div class="type">'+esc(step.type)+'</div>'
      +'<div class="name">'+esc(step.name)+'</div></div>';
  }).join('');
  nodesEl.querySelectorAll('.node').forEach(el => {
    el.addEventListener('click', () => {
      selectedId = el.getAttribute('data-id');
      vscode.postMessage({ type: 'selectStep', stepId: selectedId });
      renderAll();
    });
  });
  const svg = document.getElementById('edges');
  let maxX = 400, maxY = 300;
  positions.forEach(p => { maxX = Math.max(maxX, p.x + 200); maxY = Math.max(maxY, p.y + 120); });
  svg.setAttribute('viewBox', '0 0 '+maxX+' '+maxY);
  svg.style.width = maxX+'px'; svg.style.height = maxY+'px';
  const byId = new Map(scenario.steps.map(s => [s.id, s]));
  svg.innerHTML = scenario.connections.map(c => {
    const a = positions.get(c.fromStepId); const b = positions.get(c.toStepId);
    if(!a||!b) return '';
    const x1 = a.x + 60, y1 = a.y + 28, x2 = b.x + 60, y2 = b.y + 10;
    return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="var(--vscode-foreground)" stroke-opacity="0.45" stroke-width="1.5" marker-end="url(#arrow)" />';
  }).join('');
  svg.innerHTML = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--vscode-foreground)" fill-opacity="0.45"/></marker></defs>' + svg.innerHTML;
}

function renderProps(){
  const el = document.getElementById('props');
  if(!scenario || !selectedId){ el.innerHTML = '<p class="hint">Select a step on the canvas.</p>'; return; }
  const step = scenario.steps.find(s => s.id === selectedId);
  if(!step){ el.innerHTML = '<p class="hint">Unknown step.</p>'; return; }
  let extra = '';
  if(step.type === 'request'){
    extra = '<label>requestRef</label><input id="f-requestRef" value="'+esc(step.requestRef||'')+'" />'
      +'<label>requestFilePath</label><input id="f-file" value="'+esc(step.requestFilePath||'')+'" />'
      +'<label>requestOffset</label><input id="f-offset" type="number" value="'+esc(step.requestOffset||0)+'" />';
  } else if(step.type === 'delay'){
    extra = '<label>durationMs</label><input id="f-duration" type="number" value="'+esc(step.durationMs)+'" />';
  } else if(step.type === 'condition'){
    extra = '<label>expression</label><textarea id="f-expression">'+esc(step.expression||'')+'</textarea>'
      +'<p class="hint">e.g. statusCode == 200 &amp;&amp; {{token}} != ""</p>';
  } else if(step.type === 'variable'){
    extra = '<label>assignments (name=value per line)</label><textarea id="f-assignments">'
      +esc((step.assignments||[]).map(a=>a.name+'='+a.value).join('\\n'))+'</textarea>';
  } else if(step.type === 'group'){
    extra = '<p class="hint">Group is UI-only in MVP (pass-through at runtime).</p>';
  }
  el.innerHTML = '<label>Name</label><input id="f-name" value="'+esc(step.name)+'" />'
    +'<label>Type</label><input value="'+esc(step.type)+'" disabled />'
    + extra
    +'<button type="button" id="btn-apply">Apply to step</button>';
  document.getElementById('btn-apply').onclick = () => {
    const name = document.getElementById('f-name').value.trim() || step.name;
    const next = { ...step, name };
    if(step.type==='request'){
      next.requestRef = document.getElementById('f-requestRef').value.trim() || undefined;
      next.requestFilePath = document.getElementById('f-file').value.trim();
      next.requestOffset = Number(document.getElementById('f-offset').value)||0;
    } else if(step.type==='delay'){
      next.durationMs = Math.max(0, Number(document.getElementById('f-duration').value)||0);
    } else if(step.type==='condition'){
      next.expression = document.getElementById('f-expression').value;
    } else if(step.type==='variable'){
      next.assignments = document.getElementById('f-assignments').value.split(/\\r?\\n/).map(line=>{
        const i = line.indexOf('='); if(i<0) return null;
        return { name: line.slice(0,i).trim(), value: line.slice(i+1) };
      }).filter(Boolean);
    }
    scenario = { ...scenario, steps: scenario.steps.map(s => s.id===step.id ? next : s) };
    renderAll();
  };
}

function displayDefaultValue(v){
  if(v.sensitive && v.defaultValue) return MASK;
  return v.defaultValue || '';
}

function renderVars(){
  const el = document.getElementById('vars');
  if(!scenario){ el.innerHTML=''; return; }
  el.innerHTML = (scenario.variables||[]).map(v =>
    '<div class="var-row">'
      +'<input data-var-name value="'+esc(v.name)+'" placeholder="name" />'
      +'<input data-var-value value="'+esc(displayDefaultValue(v))+'" placeholder="'+(v.sensitive ? esc(MASK) : 'value')+'" />'
      +'<input data-var-sensitive type="checkbox" title="Sensitive"'+(v.sensitive ? ' checked' : '')+' />'
    +'</div>'
  ).join('') + '<button type="button" id="btn-add-var">Add variable</button>';
  document.getElementById('btn-add-var').onclick = () => {
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
  const conns = (scenario.connections||[]).map(c => c.fromStepId+' → '+c.toStepId).join('\\n') || 'No connections';
  el.innerHTML = '<pre style="white-space:pre-wrap;margin:0;font:inherit">'+esc(conns)+'</pre>'
    +'<p class="hint">'+esc(scenario.steps.length)+' steps · '+esc((scenario.connections||[]).length)+' connections</p>';
}

function renderAll(){
  if(!scenario) return;
  // Preserve in-progress variable edits across canvas/Add-variable re-renders.
  if(document.querySelector('#vars [data-var-name]')){
    scenario = { ...scenario, variables: collectVariablesFromUi() };
  }
  document.getElementById('title').textContent = scenario.name || 'Scenario';
  renderCanvas();
  renderProps();
  renderVars();
  renderInspector();
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
  scenario = buildScenarioForHost();
  vscode.postMessage({ type: 'run', scenario });
};

window.addEventListener('message', (e) => {
  const msg = e.data;
  if(!msg || typeof msg !== 'object') return;
  if(msg.type === 'init' || msg.type === 'update'){
    scenario = msg.scenario;
    selectedId = undefined;
    renderAll();
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
