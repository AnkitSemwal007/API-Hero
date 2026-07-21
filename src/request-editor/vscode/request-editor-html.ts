/**
 * Pure HTML/CSS/JS for the Request Editor custom text editor webview.
 * No vscode import — unit-testable generation and CSP helpers.
 */

import { HTTP_METHODS } from '../../types';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
} from '../../ui/webview';
import type { RequestEditorState } from './request-editor-messages';

export { escapeAttribute, escapeHtml };

/** Builds the request editor document for a Custom Text Editor webview. */
export function renderRequestEditorHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  const methodOptions = HTTP_METHODS.map(
    (method) =>
      `<option value="${method}"${method === 'GET' ? ' selected' : ''}>${method}</option>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Request Editor</title>
<style nonce="${safeNonce}">${EDITOR_CSS}</style>
</head>
<body>
<div id="banner" class="banner" hidden></div>
<header class="toolbar">
  <div class="run-row" role="group" aria-label="Request execution">
    <label class="field method">
      <span class="sr-only">Method</span>
      <select id="method" aria-label="HTTP method">${methodOptions}</select>
    </label>
    <label class="field grow">
      <span class="sr-only">URL</span>
      <input id="url" type="text" placeholder="https://api.example.com/resource" autocomplete="off" aria-label="URL" />
    </label>
    <button type="button" id="envShortcut" class="ghost" title="Switch Environment" aria-label="Switch Environment">Environment</button>
    <button type="button" id="authShortcut" class="ghost" title="Select Authentication" aria-label="Select Authentication">Authentication</button>
    <button type="button" id="run" class="primary">Run</button>
  </div>
  <div class="identity-row">
    <div class="identity">
      <input id="name" type="text" placeholder="Request name" aria-label="Request name" />
      <input id="description" type="text" placeholder="Description (optional)" aria-label="Description" />
    </div>
    <div class="actions">
      <button type="button" id="openText" class="secondary" title="Open With Text Editor">Open Text</button>
    </div>
  </div>
</header>
<nav class="tabs" role="tablist" aria-label="Request sections">
  ${TAB_BUTTONS}
</nav>
<div id="formRoot" class="panels">
  <section id="tab-request" class="panel active" role="tabpanel">
    <p class="hint">Method and URL are edited in the top bar. Query parameters are edited on the Params tab and encoded into the URL.</p>
  </section>
  <section id="tab-headers" class="panel" role="tabpanel" hidden>
    <div class="table-toolbar">
      <button type="button" data-add="headers" class="secondary">Add header</button>
    </div>
    <table class="kv" id="headersTable">
      <thead><tr><th>Key</th><th>Value</th><th>Enabled</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <section id="tab-params" class="panel" role="tabpanel" hidden>
    <div class="table-toolbar">
      <button type="button" data-add="params" class="secondary">Add param</button>
    </div>
    <table class="kv" id="paramsTable">
      <thead><tr><th>Key</th><th>Value</th><th>Enabled</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <section id="tab-body" class="panel" role="tabpanel" hidden>
    <label class="field">
      <span>Body type</span>
      <select id="bodyType">
        <option value="none">none</option>
        <option value="json">json</option>
        <option value="text">text</option>
        <option value="form">form</option>
        <option value="raw">raw</option>
        <option value="multipart">multipart</option>
        <option value="binary">binary</option>
      </select>
    </label>
    <div id="bodyJsonText" class="body-block">
      <label class="field">
        <span>Body</span>
        <textarea id="bodyText" rows="12" spellcheck="false"></textarea>
      </label>
      <label class="field" id="rawContentTypeField" hidden>
        <span>Content-Type</span>
        <input id="rawContentType" type="text" placeholder="application/xml" />
      </label>
    </div>
    <div id="bodyForm" class="body-block" hidden>
      <div class="table-toolbar">
        <button type="button" data-add="form" class="secondary">Add field</button>
      </div>
      <table class="kv" id="formTable">
        <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div id="bodyMultipart" class="body-block" hidden>
      <label class="field">
        <span>Boundary</span>
        <input id="multipartBoundary" type="text" placeholder="boundary" />
      </label>
      <div class="table-toolbar">
        <button type="button" data-add="multipart" class="secondary">Add field</button>
      </div>
      <table class="kv" id="multipartTable">
        <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div id="bodyBinary" class="body-block" hidden>
      <label class="field">
        <span>Note / path hint</span>
        <input id="binaryNote" type="text" placeholder="avatar.png" />
      </label>
      <p class="hint">Binary bodies are emitted as a stub comment in the .api file.</p>
    </div>
  </section>
  <section id="tab-auth" class="panel" role="tabpanel" hidden>
    <label class="field">
      <span>Authentication profile</span>
      <select id="authProfile">
        <option value="">none</option>
      </select>
    </label>
    <p class="hint">Writes <code>@auth &lt;id&gt;</code>. Secrets stay in Secret Storage — never in the webview.</p>
    <div class="table-toolbar">
      <button type="button" id="manageAuthProfiles" class="secondary">Manage Authentication</button>
      <button type="button" id="selectAuthentication" class="ghost">Session default…</button>
    </div>
  </section>
  <section id="tab-variables" class="panel" role="tabpanel" hidden>
    <div class="table-toolbar">
      <button type="button" data-add="variables" class="secondary">Add variable</button>
      <button type="button" id="manageEnvironments" class="ghost">Manage Environments</button>
    </div>
    <table class="kv" id="variablesTable">
      <thead><tr><th>Name</th><th>Value</th><th>Insert</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
    <h3>Resolution preview</h3>
    <pre id="variablePreview" class="preview-box">No preview</pre>
  </section>
  <section id="tab-tests" class="panel" role="tabpanel" hidden>
    <div class="tests-builder">
      <h3>Add assertion</h3>
      <div class="row wrap">
        <label class="field">
          <span>Kind</span>
          <select id="testKind">
            <option value="status">Status equals</option>
            <option value="headerExists">Header exists</option>
            <option value="jsonEquals">JSON path equals</option>
            <option value="responseTime">Response time &lt;</option>
            <option value="contains">Body contains text</option>
          </select>
        </label>
        <label class="field grow">
          <span>Value</span>
          <input id="testValue" type="text" placeholder="200" />
        </label>
        <button type="button" id="addTest" class="secondary">Add</button>
      </div>
      <p class="hint" id="testHint">Example: expect status == 200</p>
    </div>
    <ul id="testsList" class="tests-list"></ul>
  </section>
  <section id="tab-settings" class="panel" role="tabpanel" hidden>
    <label class="field">
      <span>Timeout (ms) — <code>@timeout</code></span>
      <input id="timeoutMs" type="number" min="0" step="1" placeholder="(use extension default)" />
    </label>
    <p class="hint">Only directives already in the .api format are editable here. Redirect following is always on at runtime (no directive).</p>
  </section>
  <section id="tab-preview" class="panel" role="tabpanel" hidden>
    <pre id="previewSource" class="preview-box source"></pre>
  </section>
</div>
<p id="error" class="error" hidden></p>
<script nonce="${safeNonce}">${EDITOR_SCRIPT}</script>
</body>
</html>`;
}

const TAB_BUTTONS = [
  'request',
  'headers',
  'params',
  'body',
  'auth',
  'variables',
  'tests',
  'settings',
  'preview',
]
  .map(
    (id, index) =>
      `<button type="button" class="tab${index === 0 ? ' active' : ''}" role="tab" data-tab="${id}" aria-selected="${index === 0 ? 'true' : 'false'}">${labelForTab(id)}</button>`,
  )
  .join('');

function labelForTab(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Builds a stable empty form model for the webview. */
export function emptyRequestEditorModel(): RequestEditorState['model'] {
  return {
    name: 'New Request',
    method: 'GET',
    url: 'https://httpbin.org/get',
    headers: [],
    queryParams: [],
    body: { type: 'none' },
    expectLines: [],
    variables: [],
  };
}

const EDITOR_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.banner {
  padding: 8px 12px;
  background: var(--vscode-inputValidation-warningBackground);
  border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
  color: var(--vscode-foreground);
  font-size: 12px;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
}
.run-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.run-row .field { margin: 0; }
.run-row .field.method { width: 104px; flex: 0 0 104px; }
.run-row .field.grow { flex: 1 1 220px; min-width: 140px; }
.identity-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: flex-start;
  justify-content: space-between;
}
.identity {
  flex: 1 1 220px;
  display: grid;
  gap: 4px;
  min-width: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  flex: 0 1 auto;
  justify-content: flex-end;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  padding: 0 8px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-editor-background);
}
.tab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  opacity: .85;
}
.tab:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
.tab.active {
  border-bottom-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground);
  font-weight: 600;
  opacity: 1;
}
.panels {
  padding: 12px;
  flex: 1;
  overflow: auto;
}
.panel { display: none; }
.panel.active { display: block; }
.row { display: flex; gap: 12px; align-items: end; }
.row.wrap { flex-wrap: wrap; }
.field { display: grid; gap: 4px; }
.field.grow { flex: 1; min-width: 0; }
.field.method { width: 104px; flex: 0 0 104px; }
.field span {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
}
input, select, textarea {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px;
  padding: 4px 8px;
  min-height: 24px;
  font: inherit;
  line-height: 1.4;
}
#url, #name, #description {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}
textarea, pre.source, .preview-box {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  line-height: 1.5;
}
textarea { resize: vertical; min-height: 140px; padding: 6px 8px; }
input:focus, select:focus, textarea:focus, button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
button {
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  border-radius: 2px;
  padding: 3px 10px;
  min-height: 24px;
  border: 1px solid var(--vscode-button-border, transparent);
}
button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
}
button.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
}
button.ghost {
  color: var(--vscode-textLink-foreground);
  background: transparent;
  border-color: transparent;
  padding: 3px 6px;
  text-decoration: none;
}
button.ghost:hover {
  background: var(--vscode-list-hoverBackground);
  text-decoration: underline;
}
button:disabled { opacity: .55; cursor: default; }
.hint {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  margin: 8px 0 0;
  line-height: 1.4;
}
.hint code, h3 code { font-family: var(--vscode-editor-font-family); }
.table-toolbar { margin-bottom: 6px; }
table.kv {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
table.kv th, table.kv td {
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  padding: 4px 6px;
  text-align: left;
  vertical-align: middle;
}
table.kv th {
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
  font-size: 11px;
  padding-top: 2px;
  padding-bottom: 4px;
}
table.kv tbody tr:hover { background: var(--vscode-list-hoverBackground); }
table.kv td.enabled { width: 56px; text-align: center; }
table.kv td.actions { width: 112px; white-space: nowrap; }
table.kv td.actions button {
  padding: 2px 6px;
  min-height: 22px;
  margin-right: 2px;
}
table.kv input[type="checkbox"] {
  width: auto;
  min-height: 0;
  margin: 0;
}
.body-block { margin-top: 12px; }
.preview-box {
  margin: 0;
  padding: 8px 10px;
  background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  border-radius: 2px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow: auto;
}
.tests-builder h3 { margin-top: 0; }
.tests-list { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 4px; }
.tests-list li {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-input-background);
  border-radius: 2px;
}
.tests-list code {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}
.error {
  margin: 0 12px 12px;
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: 12px;
}
h3 {
  margin: 12px 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
@media (max-width: 560px) {
  .run-row { flex-direction: column; align-items: stretch; }
  .run-row .field.method { width: 100%; flex: 1; }
  .identity-row { flex-direction: column; align-items: stretch; }
  .actions { justify-content: flex-start; }
  .row { flex-direction: column; align-items: stretch; }
  .field.method { width: 100%; flex: 1; }
}
@media (prefers-contrast: more) {
  .tab.active { border-bottom-width: 3px; }
}
@media (forced-colors: active) {
  .tab.active { border-bottom: 2px solid CanvasText; }
  button, input, select, textarea { border: 1px solid CanvasText; }
}
`;

const EDITOR_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  let state = null;
  let applying = false;
  let debounceTimer = undefined;
  const DEBOUNCE_MS = 300;

  const el = (id) => document.getElementById(id);

  function post(message) {
    vscode.postMessage(message);
  }

  function showError(message) {
    const node = el('error');
    if (!message) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.textContent = message;
  }

  function setTab(tabId) {
    document.querySelectorAll('.tab').forEach((button) => {
      const active = button.getAttribute('data-tab') === tabId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      const active = panel.id === 'tab-' + tabId;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (tabId === 'preview') {
      refreshPreview();
    }
  }

  function defaultModel() {
    return {
      name: 'New Request',
      method: 'GET',
      url: 'https://httpbin.org/get',
      headers: [],
      queryParams: [],
      body: { type: 'none' },
      expectLines: [],
      variables: []
    };
  }

  function currentModel() {
    const model = state && state.model ? structuredClone(state.model) : defaultModel();
    model.name = el('name').value.trim() || 'New Request';
    model.description = el('description').value.trim() || undefined;
    if (!model.description) delete model.description;
    model.method = el('method').value;
    model.url = el('url').value.trim();
    model.queryParams = readKvTable('paramsTable', true);
    model.headers = readKvTable('headersTable', true);
    model.variables = readVariables();
    model.expectLines = readExpectLines();
    const timeoutRaw = el('timeoutMs').value.trim();
    if (timeoutRaw.length > 0 && Number.isFinite(Number(timeoutRaw))) {
      model.timeoutMs = Math.max(0, Math.floor(Number(timeoutRaw)));
    } else {
      delete model.timeoutMs;
    }
    const auth = el('authProfile').value.trim();
    if (auth) model.authProfileId = auth;
    else delete model.authProfileId;
    model.body = readBody();
    return model;
  }

  function readKvTable(tableId, withEnabled) {
    const rows = [];
    el(tableId).querySelectorAll('tbody tr').forEach((tr) => {
      const name = tr.querySelector('[data-k]').value;
      const value = tr.querySelector('[data-v]').value;
      const enabled = withEnabled ? tr.querySelector('[data-e]').checked : true;
      rows.push(withEnabled ? { name, value, enabled } : { name, value });
    });
    return rows;
  }

  function readVariables() {
    return Array.from(el('variablesTable').querySelectorAll('tbody tr')).map((tr) => {
      const name = tr.querySelector('[data-k]').value;
      const value = tr.querySelector('[data-v]').value;
      const sensitive = tr.getAttribute('data-sensitive') === 'true';
      return sensitive
        ? { name, value, sensitive: true }
        : { name, value };
    });
  }

  function readExpectLines() {
    return Array.from(el('testsList').querySelectorAll('li')).map((li) =>
      li.getAttribute('data-line') || ''
    ).filter(Boolean);
  }

  function readBody() {
    const type = el('bodyType').value;
    if (type === 'none') return { type: 'none' };
    if (type === 'json') return { type: 'json', text: el('bodyText').value };
    if (type === 'text') return { type: 'text', text: el('bodyText').value };
    if (type === 'raw') {
      const contentType = el('rawContentType').value.trim();
      return contentType
        ? { type: 'raw', text: el('bodyText').value, contentType }
        : { type: 'raw', text: el('bodyText').value };
    }
    if (type === 'form') {
      return { type: 'form', fields: readKvTable('formTable', false) };
    }
    if (type === 'multipart') {
      const boundary = el('multipartBoundary').value.trim();
      const fields = readKvTable('multipartTable', false);
      return boundary
        ? { type: 'multipart', boundary, fields }
        : { type: 'multipart', fields };
    }
    if (type === 'binary') {
      const note = el('binaryNote').value.trim();
      return note ? { type: 'binary', note } : { type: 'binary' };
    }
    return { type: 'none' };
  }

  function scheduleUpdate() {
    if (applying || !state || state.mode !== 'form') return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      const model = currentModel();
      state.model = model;
      refreshPreview();
      refreshVariablePreviewLocal(model);
      post({
        type: 'updateModel',
        documentVersion: state.documentVersion,
        model
      });
    }, DEBOUNCE_MS);
  }

  function bindChange(node) {
    node.addEventListener('input', scheduleUpdate);
    node.addEventListener('change', scheduleUpdate);
  }

  function renderKvRows(tableId, rows, withEnabled) {
    const tbody = el(tableId).querySelector('tbody');
    tbody.innerHTML = '';
    (rows || []).forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input data-k type="text" /></td>' +
        '<td><input data-v type="text" /></td>' +
        (withEnabled
          ? '<td class="enabled"><input data-e type="checkbox" /></td>'
          : '') +
        '<td class="actions">' +
        (withEnabled
          ? '<button type="button" data-dup class="secondary">Dup</button>'
          : '') +
        '<button type="button" data-del class="secondary">Remove</button></td>';
      tr.querySelector('[data-k]').value = row.name || '';
      tr.querySelector('[data-v]').value = row.value || '';
      if (withEnabled) {
        tr.querySelector('[data-e]').checked = row.enabled !== false;
      }
      tr.querySelector('[data-del]').addEventListener('click', () => {
        tr.remove();
        scheduleUpdate();
      });
      const dup = tr.querySelector('[data-dup]');
      if (dup) {
        dup.addEventListener('click', () => {
          const copy = {
            name: tr.querySelector('[data-k]').value,
            value: tr.querySelector('[data-v]').value,
            enabled: tr.querySelector('[data-e]').checked
          };
          const list = readKvTable(tableId, true);
          list.splice(index + 1, 0, copy);
          renderKvRows(tableId, list, true);
          scheduleUpdate();
        });
      }
      bindChange(tr.querySelector('[data-k]'));
      bindChange(tr.querySelector('[data-v]'));
      if (withEnabled) bindChange(tr.querySelector('[data-e]'));
      tbody.appendChild(tr);
    });
  }

  function renderVariables(rows) {
    const tbody = el('variablesTable').querySelector('tbody');
    tbody.innerHTML = '';
    (rows || []).forEach((row) => {
      const tr = document.createElement('tr');
      const sensitive = row.sensitive === true;
      if (sensitive) {
        tr.setAttribute('data-sensitive', 'true');
      }
      tr.innerHTML =
        '<td><input data-k type="text" /></td>' +
        '<td><input data-v type="password" autocomplete="off" /></td>' +
        '<td class="actions"><button type="button" data-ins class="secondary">{{ }}</button></td>' +
        '<td class="actions"><button type="button" data-del class="secondary">Remove</button></td>';
      tr.querySelector('[data-k]').value = row.name || '';
      tr.querySelector('[data-v]').value = row.value || '';
      if (sensitive) {
        tr.querySelector('[data-v]').setAttribute('spellcheck', 'false');
      }
      tr.querySelector('[data-del]').addEventListener('click', () => {
        tr.remove();
        scheduleUpdate();
      });
      tr.querySelector('[data-ins]').addEventListener('click', () => {
        const name = tr.querySelector('[data-k]').value.trim();
        if (!name) return;
        const url = el('url');
        const token = '{{' + name + '}}';
        const start = url.selectionStart || url.value.length;
        const end = url.selectionEnd || start;
        url.value = url.value.slice(0, start) + token + url.value.slice(end);
        url.focus();
        scheduleUpdate();
      });
      bindChange(tr.querySelector('[data-k]'));
      bindChange(tr.querySelector('[data-v]'));
      tbody.appendChild(tr);
    });
  }

  function renderTests(lines) {
    const list = el('testsList');
    list.innerHTML = '';
    (lines || []).forEach((line) => {
      const li = document.createElement('li');
      li.setAttribute('data-line', line);
      li.innerHTML = '<code></code><button type="button" class="secondary" data-del>Remove</button>';
      li.querySelector('code').textContent = line;
      li.querySelector('[data-del]').addEventListener('click', () => {
        li.remove();
        scheduleUpdate();
      });
      list.appendChild(li);
    });
  }

  function updateBodyVisibility() {
    const type = el('bodyType').value;
    el('bodyJsonText').hidden = !(type === 'json' || type === 'text' || type === 'raw');
    el('rawContentTypeField').hidden = type !== 'raw';
    el('bodyForm').hidden = type !== 'form';
    el('bodyMultipart').hidden = type !== 'multipart';
    el('bodyBinary').hidden = type !== 'binary';
  }

  function applyBody(body) {
    const type = body && body.type ? body.type : 'none';
    el('bodyType').value = type;
    el('bodyText').value = '';
    el('rawContentType').value = '';
    el('multipartBoundary').value = '';
    el('binaryNote').value = '';
    renderKvRows('formTable', [], false);
    renderKvRows('multipartTable', [], false);
    if (type === 'json' || type === 'text' || type === 'raw') {
      el('bodyText').value = body.text || '';
      if (type === 'raw' && body.contentType) {
        el('rawContentType').value = body.contentType;
      }
    } else if (type === 'form') {
      renderKvRows('formTable', body.fields || [], false);
    } else if (type === 'multipart') {
      el('multipartBoundary').value = body.boundary || '';
      renderKvRows('multipartTable', body.fields || [], false);
    } else if (type === 'binary') {
      el('binaryNote').value = body.note || '';
    }
    updateBodyVisibility();
  }

  function applyAuthProfiles(profiles, selected) {
    const select = el('authProfile');
    select.innerHTML = '<option value="">none</option>';
    (profiles || []).forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label || profile.id;
      select.appendChild(option);
    });
    select.value = selected || '';
  }

  function refreshPreview() {
    if (!state) return;
    el('previewSource').textContent = state.sourceText || '';
  }

  function refreshVariablePreviewLocal(model) {
    const preview = state && state.variablePreview ? state.variablePreview : {};
    const lines = Object.keys(preview).sort().map((key) => key + ' = ' + preview[key]);
    const docVars = (model.variables || [])
      .filter((row) => row.name)
      .map((row) => row.name + ' (document) = ' + row.value);
    el('variablePreview').textContent =
      lines.length || docVars.length
        ? [...docVars, ...lines].join('\\n')
        : 'No resolved variables yet';
  }

  function applyState(next) {
    applying = true;
    state = next;
    showError('');
    const banner = el('banner');
    const formRoot = el('formRoot');
    const run = el('run');
    const envShortcut = el('envShortcut');
    const authShortcut = el('authShortcut');
    const manageAuthProfiles = el('manageAuthProfiles');
    const selectAuthentication = el('selectAuthentication');
    const manageEnvironments = el('manageEnvironments');

    if (next.mode === 'multi') {
      banner.hidden = false;
      banner.textContent =
        'This file contains ' + next.requestCount +
        ' requests. Use the text editor for multi-request files — the form editor only syncs single-request documents.';
      formRoot.hidden = true;
      run.disabled = true;
      envShortcut.disabled = true;
      authShortcut.disabled = true;
      manageAuthProfiles.disabled = true;
      selectAuthentication.disabled = true;
      manageEnvironments.disabled = true;
      applying = false;
      refreshPreview();
      return;
    }

    if (next.mode === 'empty') {
      banner.hidden = false;
      banner.textContent =
        'No HTTP request found in this file. Add a METHOD URL line, or open the text editor.';
      formRoot.hidden = true;
      run.disabled = true;
      envShortcut.disabled = true;
      authShortcut.disabled = true;
      manageAuthProfiles.disabled = true;
      selectAuthentication.disabled = true;
      manageEnvironments.disabled = true;
      applying = false;
      refreshPreview();
      return;
    }

    banner.hidden = true;
    formRoot.hidden = false;
    run.disabled = false;
    envShortcut.disabled = false;
    authShortcut.disabled = false;
    manageAuthProfiles.disabled = false;
    selectAuthentication.disabled = false;
    manageEnvironments.disabled = false;

    const model = next.model || defaultModel();
    el('name').value = model.name || '';
    el('description').value = model.description || '';
    el('method').value = model.method || 'GET';
    el('url').value = model.url || '';
    el('timeoutMs').value =
      model.timeoutMs === undefined || model.timeoutMs === null
        ? ''
        : String(model.timeoutMs);
    applyAuthProfiles(next.authProfiles || [], model.authProfileId || '');
    renderKvRows('paramsTable', model.queryParams || [], true);
    renderKvRows('headersTable', model.headers || [], true);
    renderVariables(model.variables || []);
    renderTests(model.expectLines || []);
    applyBody(model.body || { type: 'none' });
    refreshPreview();
    refreshVariablePreviewLocal(model);
    applying = false;
  }

  function buildExpectLine() {
    const kind = el('testKind').value;
    const value = el('testValue').value.trim();
    if (kind === 'status') {
      return 'expect status == ' + (value || '200');
    }
    if (kind === 'headerExists') {
      return 'expect header ' + (value || 'Content-Type') + ' exists';
    }
    if (kind === 'jsonEquals') {
      const parts = value.split('=');
      const path = (parts[0] || 'id').trim();
      const expected = (parts.slice(1).join('=') || '""').trim();
      return 'expect body.' + path.replace(/^body\\./, '') + ' == ' + expected;
    }
    if (kind === 'responseTime') {
      return 'expect responseTime < ' + (value || '2000');
    }
    if (kind === 'contains') {
      const text = value.replace(/"/g, '\\\\"');
      return 'expect body contains "' + text + '"';
    }
    return '';
  }

  function updateTestHint() {
    const kind = el('testKind').value;
    const hints = {
      status: 'Value: status code (e.g. 200)',
      headerExists: 'Value: header name (e.g. Content-Type)',
      jsonEquals: 'Value: path=expected (e.g. user.id=1 or name="Ada")',
      responseTime: 'Value: max ms (e.g. 2000)',
      contains: 'Value: substring to find in the body'
    };
    el('testHint').textContent = hints[kind] || '';
    el('testValue').placeholder = {
      status: '200',
      headerExists: 'Content-Type',
      jsonEquals: 'id=1',
      responseTime: '2000',
      contains: 'ok'
    }[kind] || '';
  }

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => setTab(button.getAttribute('data-tab')));
  });

  ['name', 'description', 'method', 'url', 'timeoutMs', 'authProfile', 'bodyType',
    'bodyText', 'rawContentType', 'multipartBoundary', 'binaryNote'].forEach((id) => {
    bindChange(el(id));
  });

  el('bodyType').addEventListener('change', () => {
    updateBodyVisibility();
    scheduleUpdate();
  });

  document.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      const kind = button.getAttribute('data-add');
      if (kind === 'params') {
        const rows = readKvTable('paramsTable', true);
        rows.push({ name: '', value: '', enabled: true });
        renderKvRows('paramsTable', rows, true);
      } else if (kind === 'headers') {
        const rows = readKvTable('headersTable', true);
        rows.push({ name: '', value: '', enabled: true });
        renderKvRows('headersTable', rows, true);
      } else if (kind === 'variables') {
        const rows = readVariables();
        rows.push({ name: '', value: '' });
        renderVariables(rows);
      } else if (kind === 'form') {
        const rows = readKvTable('formTable', false);
        rows.push({ name: '', value: '' });
        renderKvRows('formTable', rows, false);
      } else if (kind === 'multipart') {
        const rows = readKvTable('multipartTable', false);
        rows.push({ name: '', value: '' });
        renderKvRows('multipartTable', rows, false);
      }
      scheduleUpdate();
    });
  });

  el('testKind').addEventListener('change', updateTestHint);
  el('addTest').addEventListener('click', () => {
    const line = buildExpectLine();
    if (!line) return;
    const lines = readExpectLines();
    lines.push(line);
    renderTests(lines);
    scheduleUpdate();
  });

  el('run').addEventListener('click', () => post({ type: 'run' }));
  el('openText').addEventListener('click', () => post({ type: 'openTextEditor' }));
  el('envShortcut').addEventListener('click', () => post({ type: 'switchEnvironment' }));
  el('authShortcut').addEventListener('click', () => post({ type: 'selectAuthentication' }));
  el('manageAuthProfiles').addEventListener('click', () => post({ type: 'manageAuthProfiles' }));
  el('selectAuthentication').addEventListener('click', () => post({ type: 'selectAuthentication' }));
  el('manageEnvironments').addEventListener('click', () => post({ type: 'manageEnvironments' }));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init' || message.type === 'state') {
      applyState(message.state);
      return;
    }
    if (message.type === 'error') {
      showError(message.message || 'Something went wrong.');
    }
  });

  updateTestHint();
  updateBodyVisibility();
  post({ type: 'ready' });
})();
`;
