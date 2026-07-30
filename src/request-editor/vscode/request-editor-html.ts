/**
 * Pure HTML/CSS/JS for the Request Editor custom text editor webview.
 * No vscode import — unit-testable generation and CSP helpers.
 */

import { HTTP_METHODS } from '../../types';
import {
  VARIABLE_PRECEDENCE_LEGEND,
  VARIABLE_SCOPE_UI,
} from '../../variables';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
  iconHtml,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';
import type { RequestSourceDocument } from '../../request-source';
import { VARIABLE_INTELLISENSE_SCRIPT } from './variable-intellisense-script';

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
<header class="toolbar sticky-toolbar">
  <div class="run-row" role="group" aria-label="Request execution">
    <label class="field method">
      <span class="sr-only">Method</span>
      <select id="method" class="method-select method-get" aria-label="HTTP method">${methodOptions}</select>
    </label>
    <label class="field grow url-field">
      <span class="sr-only">URL</span>
      <input id="url" type="text" placeholder="https://api.example.com/resource" autocomplete="off" aria-label="URL" data-var-complete="true" data-var-preview="urlResolved" data-var-hint="urlVarHint" />
      <p id="urlResolved" class="var-resolved" hidden></p>
      <p id="urlVarHint" class="var-hint" hidden></p>
    </label>
    <button type="button" id="envShortcut" class="chip" title="Switch Environment" aria-label="Switch Environment">Env: None</button>
    <button type="button" id="authShortcut" class="chip" title="Session default Authentication" aria-label="Session default Authentication">Authentication</button>
    <button type="button" id="run" class="primary run-btn">${iconHtml('play', { decorative: true })} Run</button>
  </div>
</header>
<nav class="tabs" role="tablist" aria-label="Request sections">
  ${TAB_BUTTONS}
</nav>
<div id="formRoot" class="panels">
  <section id="tab-request" class="panel active" role="tabpanel">
    <div class="identity-block">
      <label class="field">
        <span>Name</span>
        <input id="name" type="text" placeholder="Request name" aria-label="Request name" />
      </label>
      <label class="field">
        <span>Description <em class="optional-hint">optional</em></span>
        <input id="description" type="text" placeholder="Short description" aria-label="Description" />
      </label>
      <div class="identity-actions">
        <button type="button" id="openText" class="ghost" title="Open With Text Editor">Open Text Editor</button>
      </div>
    </div>
    <div class="execution-block dependencies-block">
      <h3 class="ah-section-title execution-title">
        Execution
        <span id="dependenciesInfoBtn" class="dependencies-info-btn" title="Dependencies are other requests this one needs. Detected ones stay off the file until you pin them. A folder or selection run may not include every detected dependency." role="img" aria-label="Dependencies are other requests this one needs. Detected ones stay off the file until you pin them. A folder or selection run may not include every detected dependency.">${iconHtml('info', { className: 'ah-icon--muted', decorative: true })}</span>
      </h3>
      <div id="executionStatus" class="execution-status" role="status" data-testid="execution-status">
        <span id="executionStatusIcon" class="execution-status-icon">${iconHtml('check-circle', { className: 'ah-icon--success ah-icon--status', decorative: true })}</span>
        <div class="execution-status-copy">
          <div id="executionStatusHeadline" class="execution-status-headline">Runs independently</div>
          <div id="executionStatusDetail" class="execution-status-detail">No dependencies required.</div>
        </div>
      </div>
      <p id="dependencyProjectionError" class="hint depends-projection-error" data-testid="dependency-projection-error" hidden></p>
      <div id="dependenciesContent" class="dependencies-content" hidden>
        <h4 class="execution-subsection-heading">Dependencies</h4>
        <div id="autoDependenciesSection" class="depend-section" hidden>
          <span class="execution-subsection-label">Automatically detected</span>
          <div id="autoDependenciesList" class="depends-projection-list" data-testid="auto-dependencies" aria-live="polite"></div>
        </div>
      </div>
      <div id="manualDependenciesSection" class="depend-section">
        <span id="pinnedLabel" class="execution-subsection-label" hidden>Pinned</span>
        <div id="dependsOnPicker" class="depends-picker" data-testid="depends-on-picker">
          <div id="dependsOnChips" class="depends-chips" aria-live="polite"></div>
          <button type="button" id="dependsOnAddBtn" class="secondary depends-add-btn">+ Add Dependency</button>
          <div id="dependsOnPopover" class="depends-popover" hidden>
            <input id="dependsOnSearch" type="search" placeholder="Search requests by name…" autocomplete="off" aria-label="Search dependency requests" aria-controls="dependsOnList" />
            <div id="dependsOnList" class="depends-list" role="listbox" aria-multiselectable="true"></div>
          </div>
        </div>
      </div>
      <div id="issuesContent" class="issues-content" hidden>
        <h4 class="execution-subsection-heading">Issues</h4>
        <div id="unknownVariablesSection" class="depend-section" hidden>
          <span class="execution-subsection-label">Missing variables</span>
          <p class="execution-issue-explain">Variables without a producer.</p>
          <div id="unknownVariablesList" class="depends-projection-list" data-testid="unknown-variables" aria-live="polite"></div>
        </div>
        <div id="ambiguousProducersSection" class="depend-section" hidden>
          <span class="execution-subsection-label">Multiple producers</span>
          <p class="execution-issue-explain">More than one request produces the same variable.</p>
          <div id="ambiguousProducersList" class="depends-projection-list" data-testid="ambiguous-producers" aria-live="polite"></div>
        </div>
      </div>
    </div>
  </section>
  <section id="tab-headers" class="panel" role="tabpanel" hidden>
    <div class="table-toolbar">
      <button type="button" data-add="headers" class="secondary">Add header</button>
    </div>
    <p class="empty-state compact" data-empty-for="headersTable" hidden><strong>No headers</strong> — add one to send custom headers.</p>
    <table class="kv" id="headersTable">
      <thead><tr><th>Key</th><th>Value</th><th>Enabled</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <section id="tab-params" class="panel" role="tabpanel" hidden>
    <div class="table-toolbar">
      <button type="button" data-add="params" class="secondary">Add param</button>
    </div>
    <p class="empty-state compact" data-empty-for="paramsTable" hidden><strong>No query params</strong> — add one to encode into the URL.</p>
    <table class="kv" id="paramsTable">
      <thead><tr><th>Key</th><th>Value</th><th>Enabled</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <section id="tab-body" class="panel" role="tabpanel" hidden>
    <div class="form-compact">
      <label class="field inline-field">
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
          <textarea id="bodyText" rows="10" spellcheck="false" data-var-complete="true"></textarea>
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
        <p class="empty-state compact" data-empty-for="formTable" hidden><strong>No form fields</strong></p>
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
        <p class="empty-state compact" data-empty-for="multipartTable" hidden><strong>No multipart fields</strong></p>
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
    </div>
  </section>
  <section id="tab-auth" class="panel" role="tabpanel" hidden>
    <div class="form-compact">
      <p id="authEmptyGuidance" class="empty-state compact" hidden>
        <strong>No Authentication selected</strong> — choose Saved Authentication, paste a one-shot Bearer token, or open Manage Authentication.
      </p>
      <label class="field">
        <span>Authentication mode</span>
        <select id="authMode">
          <option value="none">None</option>
          <option value="oneshot">One-shot</option>
          <option value="saved">Saved Authentication</option>
        </select>
      </label>
      <div id="authSavedBlock">
        <label class="field">
          <span>Authentication</span>
          <select id="authProfile">
            <option value="">none</option>
          </select>
        </label>
        <p class="hint">Writes <code>@auth &lt;id&gt;</code>. Secrets stay in Secret Storage — never in the webview.</p>
      </div>
      <div id="authOneshotBlock" hidden>
        <label class="field">
          <span>Bearer token (one-shot)</span>
          <input id="oneshotToken" type="password" autocomplete="off" placeholder="Paste token — not saved to .api" />
        </label>
        <p class="hint">Token stays in editor memory until Send, then is cleared unless you Save as Authentication.</p>
      </div>
      <h3 class="ah-section-title">Preview</h3>
      <pre id="authPreview" class="preview-box" aria-live="polite">No authentication headers will be added.</pre>
      <button type="button" id="copyAuthHeaderName" class="ghost" hidden>Copy header name</button>
      <h3 class="ah-section-title">Why This Authentication?</h3>
      <ol id="authResolutionChain" class="auth-resolution" aria-label="Authentication resolution chain"></ol>
      <div id="saveAsAuthBanner" class="cta" hidden role="status">
        <span>Reuse this Authentication?</span>
        <button type="button" id="saveAsAuthConfirm" class="primary">Save</button>
        <button type="button" id="saveAsAuthDismiss" class="ghost">Dismiss</button>
      </div>
      <div class="table-toolbar">
        <button type="button" id="manageAuthProfiles" class="secondary">Manage Authentication</button>
        <button type="button" id="selectAuthentication" class="ghost">Session default…</button>
      </div>
    </div>
  </section>
  <section id="tab-variables" class="panel" role="tabpanel" hidden>
    <p id="variablesActiveEnv" class="hint" aria-live="polite">Active environment: None</p>
    <p class="hint" id="variablesScopeHint">These are <strong>${escapeHtml(VARIABLE_SCOPE_UI.document.sourceLabel)}</strong> variables (highest precedence). They override Environment, Workspace, and Global.</p>
    <p class="hint" id="variablesPrecedenceLegend">${escapeHtml(VARIABLE_PRECEDENCE_LEGEND)}</p>
    <div class="table-toolbar">
      <button type="button" data-add="variables" class="secondary">Add variable</button>
      <button type="button" id="manageEnvironments" class="ghost">Manage Environments</button>
    </div>
    <p class="empty-state compact" data-empty-for="variablesTable" hidden><strong>No Request variables</strong></p>
    <table class="kv" id="variablesTable">
      <thead><tr><th>Name</th><th>Value</th><th>Insert</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
    <h3 class="ah-section-title">Resolution preview</h3>
    <p class="hint">Effective values after precedence (source label shown per variable).</p>
    <pre id="variablePreview" class="preview-box">No preview</pre>
  </section>
  <section id="tab-extract" class="panel" role="tabpanel" hidden>
    <p class="hint">Default scope is Run (session). Environment, Collection, and Workspace persist. Request writes are a session overlay for this request. Global is not available for extract.</p>
    <div class="table-toolbar">
      <button type="button" data-add="extract" class="secondary">Add extraction</button>
    </div>
    <p class="empty-state compact" data-empty-for="extractTable" hidden><strong>No extractions</strong> — add one to write response values into variables.</p>
    <table class="kv" id="extractTable">
      <thead><tr><th>Name</th><th>From</th><th>Scope</th><th>Sensitive</th><th>Optional</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <section id="tab-tests" class="panel" role="tabpanel" hidden>
    <div class="tests-builder form-compact">
      <h3 class="ah-section-title">Add assertion</h3>
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
          <input id="testValue" type="text" placeholder="200" data-var-complete="true" />
        </label>
        <button type="button" id="addTest" class="secondary">Add</button>
      </div>
      <p class="hint" id="testHint">Example: expect status == 200</p>
    </div>
    <ul id="testsList" class="tests-list"></ul>
  </section>
  <section id="tab-settings" class="panel" role="tabpanel" hidden>
    <div class="form-compact">
      <label class="field">
        <span>Timeout (ms) — <code>@timeout</code></span>
        <input id="timeoutMs" type="number" min="0" step="1" placeholder="(use extension default)" />
      </label>
      <p class="hint">Only directives already in the .api format are editable here. Redirect following is always on at runtime (no directive).</p>
    </div>
  </section>
  <section id="tab-preview" class="panel" role="tabpanel" hidden>
    <pre id="previewSource" class="preview-box source"></pre>
  </section>
</div>
<p id="error" class="error" hidden></p>
<div id="varSuggest" class="var-suggest" hidden role="listbox" aria-label="Variable suggestions"></div>
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
  'extract',
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
  if (id === 'extract') {
    return 'Extract';
  }
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Builds a stable empty form model for the webview. */
export function emptyRequestEditorModel(): RequestSourceDocument {
  return {
    name: 'New Request',
    method: 'GET',
    url: 'https://httpbin.org/get',
    headers: [],
    queryParams: [],
    body: { type: 'none' },
    expectLines: [],
    variables: [],
    extractionRules: [],
    dependsOn: [],
  };
}

const EDITOR_CSS = `
${WEBVIEW_SHARED_CSS}
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
  padding: var(--ah-space-2) var(--ah-space-3);
  background: var(--vscode-inputValidation-warningBackground);
  border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
  color: var(--vscode-foreground);
  font-size: 12px;
}
.toolbar {
  display: block;
  padding: var(--ah-space-1) var(--ah-space-2);
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}
.run-row {
  display: flex;
  flex-wrap: nowrap;
  gap: var(--ah-space-1);
  align-items: center;
}
.run-row .field { margin: 0; }
.run-row .field.method { width: 92px; flex: 0 0 92px; }
.run-row .field.grow.url-field { flex: 1 1 auto; min-width: 0; }
.run-row .chip,
.run-row .run-btn {
  flex: 0 0 auto;
  height: var(--ah-control-height);
  min-height: var(--ah-control-height);
  box-sizing: border-box;
}
.run-btn {
  min-width: 64px;
  padding: 0 14px;
  font-weight: 600;
}
.identity-block {
  display: grid;
  gap: var(--ah-space-2);
  max-width: 36rem;
  margin-bottom: var(--ah-space-2);
}
.identity-block .optional-hint {
  font-style: normal;
  opacity: .8;
  font-weight: 400;
}
.identity-actions {
  display: flex;
  gap: var(--ah-space-1);
  align-items: center;
}
.execution-block,
.dependencies-block {
  max-width: 36rem;
  margin-bottom: var(--ah-space-1);
  display: grid;
  gap: 8px;
}
.execution-block .ah-section-title,
.dependencies-block .ah-section-title { margin-top: 0; margin-bottom: 0; }
.execution-title {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dependencies-info-btn {
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: help;
  padding: 0 2px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.85;
  display: inline-flex;
  align-items: center;
}
.dependencies-info-btn:hover { opacity: 1; color: var(--vscode-foreground); }
.execution-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.execution-status-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
}
.execution-status-copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.execution-status-headline {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}
.execution-status-detail {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.3;
}
.execution-subsection-heading {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.execution-subsection-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
}
.execution-issue-explain {
  margin: 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.3;
}
.dependencies-content,
.issues-content {
  display: grid;
  gap: 6px;
}
.dependencies-content[hidden],
.issues-content[hidden] { display: none; }
.dependson-field { margin: 0; }
.depend-section {
  display: grid;
  gap: 4px;
}
.depend-section[hidden] { display: none; }
.depends-projection-list {
  display: grid;
  gap: 4px;
  min-height: 0;
}
.depends-projection-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.depends-projection-row .dep-label {
  font-weight: 600;
  color: var(--vscode-foreground);
}
.depends-reason {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  line-height: 1.3;
}
.depends-pin-btn {
  padding: 0 4px;
  min-height: 18px;
  font-size: 11px;
  line-height: 1.2;
}
.depends-pinned-badge {
  font-size: 11px;
  line-height: 1;
  opacity: 0.9;
}
.depends-projection-error {
  color: var(--vscode-errorForeground);
  margin: 0;
}
.depends-picker {
  display: grid;
  gap: 4px;
  padding: 0;
  position: relative;
}
.depends-add-btn {
  justify-self: start;
  padding: 2px 8px;
  min-height: 22px;
  font-size: 11px;
}
.depends-popover {
  display: grid;
  gap: 4px;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px;
  padding: 4px;
  background: var(--vscode-editor-background, var(--vscode-input-background));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.depends-popover[hidden] { display: none; }
.depends-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 0;
}
.depends-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 11px;
  max-width: 100%;
}
.depends-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  font-size: inherit;
}
.depends-chip button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  opacity: 0.85;
}
.depends-list {
  max-height: 180px;
  overflow: auto;
  border-top: 1px solid var(--vscode-panel-border, transparent);
  padding-top: var(--ah-space-1);
}
.depends-option {
  display: flex;
  align-items: flex-start;
  gap: var(--ah-space-1);
  padding: 4px 2px;
  cursor: pointer;
  font-size: 12px;
}
.depends-option:hover {
  background: var(--vscode-list-hoverBackground);
}
.depends-option input { width: auto; margin-top: 2px; }
.depends-option-meta {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.depends-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.depends-option-folder {
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
}
.depends-empty {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  padding: 4px 2px;
}
.tabs {
  padding: 0 var(--ah-space-1);
}
.tabs .tab {
  padding: 3px 8px;
  min-height: 22px;
  font-size: 11px;
  line-height: 1.3;
}
.tabs .tab:hover {
  opacity: 1;
  background: var(--vscode-list-hoverBackground);
}
.panels {
  padding: var(--ah-space-2);
  flex: 1;
  overflow: auto;
}
.panel { display: none; }
.panel.active { display: block; }
.form-compact { display: grid; gap: var(--ah-space-2); max-width: 42rem; }
.row { display: flex; gap: var(--ah-space-2); align-items: end; }
.row.wrap { flex-wrap: wrap; }
.field { display: grid; gap: var(--ah-space-1); }
.field.grow { flex: 1; min-width: 0; }
.field.method { width: 92px; flex: 0 0 92px; }
.field span, .field em {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  font-style: normal;
}
.inline-field {
  grid-template-columns: auto minmax(120px, 180px);
  align-items: center;
  gap: var(--ah-space-2);
  max-width: 280px;
}
input, select, textarea { width: 100%; }
#url, #name {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}
#description { font-size: 12px; }
textarea, pre.source, .preview-box {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  line-height: 1.5;
}
textarea { resize: vertical; min-height: 120px; }
.hint {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  margin: var(--ah-space-1) 0 0;
  line-height: 1.4;
}
.panel > .hint:first-child,
.identity-block + .hint {
  margin-top: var(--ah-space-1);
}
.hint code, h3 code { font-family: var(--vscode-editor-font-family); }
.url-field { position: relative; }
.var-resolved, .var-hint {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.35;
}
.var-resolved {
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.var-hint {
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground));
  white-space: pre-wrap;
  word-break: break-all;
}
.var-suggest {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  max-height: min(320px, 50vh);
  overflow: hidden;
  border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-panel-border));
  background: var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  color: var(--vscode-editorSuggestWidget-foreground, var(--vscode-foreground));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  border-radius: 4px;
}
.var-suggest-list {
  overflow: auto;
  max-height: 180px;
  padding: 2px 0;
}
.var-suggest-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 4px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.var-suggest-item:hover,
.var-suggest-item.active {
  background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground));
}
.var-suggest-icon { opacity: 0.95; }
.var-suggest-label {
  font-family: var(--vscode-editor-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.var-suggest-source {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
.var-suggest-item.active .var-suggest-source {
  color: inherit;
  opacity: 0.85;
}
.var-suggest-detail {
  border-top: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-panel-border));
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.4;
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
}
.var-suggest-name {
  font-family: var(--vscode-editor-font-family);
  font-weight: 600;
  margin-bottom: 4px;
}
.var-suggest-meta { margin-bottom: 6px; opacity: 0.9; }
.var-suggest-value-label {
  color: var(--vscode-descriptionForeground);
  margin-bottom: 2px;
}
.var-suggest-value {
  font-family: var(--vscode-editor-font-family);
  word-break: break-all;
  margin-bottom: 6px;
}
.table-toolbar {
  display: flex;
  gap: var(--ah-space-2);
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: var(--ah-space-1);
}
table.kv {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
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
.body-block { margin-top: 0; }
.preview-box {
  margin: 0;
  padding: var(--ah-space-2) 10px;
  background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  border-radius: var(--ah-radius);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow: auto;
}
.auth-resolution {
  margin: 0 0 var(--ah-space-3);
  padding-left: 1.25rem;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.5;
}
.auth-resolution .selected {
  color: var(--vscode-foreground);
  font-weight: 600;
}
.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: var(--ah-space-2) 0;
  padding: 10px 12px;
  border-radius: var(--ah-radius);
  background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
}
.tests-builder h3 { margin-top: 0; }
.tests-list { list-style: none; padding: 0; margin: var(--ah-space-3) 0 0; display: grid; gap: var(--ah-space-1); }
.tests-list li {
  display: flex;
  gap: var(--ah-space-2);
  align-items: center;
  justify-content: space-between;
  padding: var(--ah-space-1) var(--ah-space-2);
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-input-background);
  border-radius: var(--ah-radius);
}
.tests-list code {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}
.error {
  margin: 0 var(--ah-space-3) var(--ah-space-3);
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: 12px;
}
.field-error {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: 10px;
  min-height: 1em;
}
h3, .ah-section-title {
  margin: var(--ah-space-2) 0 var(--ah-space-1);
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.empty-state.compact {
  margin: var(--ah-space-1) 0;
  padding: var(--ah-space-1) var(--ah-space-2);
}
@media (max-width: 560px) {
  .run-row {
    flex-direction: column;
    flex-wrap: wrap;
    align-items: stretch;
  }
  .run-row .field.method { width: 100%; flex: 1; }
  .run-row .chip,
  .run-row .run-btn { width: 100%; }
  .row { flex-direction: column; align-items: stretch; }
  .inline-field { grid-template-columns: 1fr; }
}
`;

const EDITOR_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  let state = null;
  let applying = false;
  let debounceTimer = undefined;
  /** True when the user edited a field since the last successful flush or inbound apply. */
  let formDirty = false;
  const DEBOUNCE_MS = 300;
  /** Selected human depend refs for Depends-on (bare or Folder/Name). */
  let dependsOnSelectedRefs = [];
  /** Catalog from host: { name, folderPath, dependRef, folderLabel? }[] */
  let dependencyCatalog = [];
  /** ADR 0003 projection rows from host (never written to .api as Auto). */
  let autoDependencies = [];
  let manualDependencies = [];
  let unknownVariables = [];
  let ambiguousProducers = [];
  let dependencyProjectionError = null;
  /** Host Authentication list for Saved mode preview (metadata only; no secrets). */
  let authProfileOptions = [];

  const el = (id) => document.getElementById(id);

${VARIABLE_INTELLISENSE_SCRIPT}

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

  function tabLabelWithCount(base, count) {
    return count > 0 ? base + ' (' + count + ')' : base;
  }

  function refreshTabBadges() {
    const counts = {
      variables: readVariables().length,
      extract: readExtractionRules().length,
      tests: readExpectLines().length
    };
    document.querySelectorAll('.tab[data-tab]').forEach((button) => {
      const id = button.getAttribute('data-tab');
      if (id === 'variables') {
        button.textContent = tabLabelWithCount('Variables', counts.variables);
      } else if (id === 'extract') {
        button.textContent = tabLabelWithCount('Extract', counts.extract);
      } else if (id === 'tests') {
        button.textContent = tabLabelWithCount('Tests', counts.tests);
      }
    });
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
      variables: [],
      extractionRules: [],
      dependsOn: []
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
    model.extractionRules = readExtractionRules();
    model.expectLines = readExpectLines();
    model.dependsOn = readDependsOn();
    const timeoutRaw = el('timeoutMs').value.trim();
    if (timeoutRaw.length > 0 && Number.isFinite(Number(timeoutRaw))) {
      model.timeoutMs = Math.max(0, Math.floor(Number(timeoutRaw)));
    } else {
      delete model.timeoutMs;
    }
    const authMode = el('authMode').value;
    if (authMode === 'saved') {
      const auth = el('authProfile').value.trim();
      if (auth) model.authProfileId = auth;
      else delete model.authProfileId;
    } else if (authMode === 'none') {
      // Explicit None clears @auth from the document.
      delete model.authProfileId;
    }
    // oneshot: leave authProfileId unchanged — never strip @auth or write token.
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

  function readExtractionRules() {
    const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
    const names = new Map();
    return Array.from(el('extractTable').querySelectorAll('tbody tr')).map((tr) => {
      const nameInput = tr.querySelector('[data-name]');
      const fromInput = tr.querySelector('[data-from]');
      const name = nameInput.value.trim();
      const from = fromInput.value.trim();
      const scope = tr.querySelector('[data-scope]').value;
      const sensitive = tr.querySelector('[data-sensitive]').checked;
      const optional = tr.querySelector('[data-optional]').checked;
      const nameError = tr.querySelector('[data-name-error]');
      const fromError = tr.querySelector('[data-from-error]');
      let nameMessage = '';
      if (name.length === 0) {
        nameMessage = 'Name required';
      } else if (!VARIABLE_NAME.test(name)) {
        nameMessage = 'Invalid name';
      } else if (names.has(name)) {
        nameMessage = 'Duplicate name';
      } else {
        names.set(name, true);
      }
      if (nameError) nameError.textContent = nameMessage;
      if (fromError) fromError.textContent = from.length === 0 ? 'From required' : '';
      const rule = { name, from };
      if (scope && scope !== 'run') rule.scope = scope;
      if (sensitive) rule.sensitive = true;
      if (optional) rule.optional = true;
      return rule;
    });
  }

  function renderExtractionRules(rows) {
    const tbody = el('extractTable').querySelector('tbody');
    tbody.innerHTML = '';
    (rows || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input data-name type="text" placeholder="token" /><div class="field-error" data-name-error></div></td>' +
        '<td><input data-from type="text" placeholder="body.access_token" /><div class="field-error" data-from-error></div></td>' +
        '<td><select data-scope>' +
        '<option value="run">Run</option>' +
        '<option value="document">Request</option>' +
        '<option value="collection">Collection</option>' +
        '<option value="environment">Environment</option>' +
        '<option value="workspace">Workspace</option>' +
        '</select></td>' +
        '<td class="enabled"><input data-sensitive type="checkbox" /></td>' +
        '<td class="enabled"><input data-optional type="checkbox" /></td>' +
        '<td class="actions"><button type="button" data-del class="secondary">Remove</button></td>';
      tr.querySelector('[data-name]').value = row.name || '';
      tr.querySelector('[data-from]').value = row.from || '';
      tr.querySelector('[data-scope]').value = row.scope || 'run';
      tr.querySelector('[data-sensitive]').checked = row.sensitive === true;
      tr.querySelector('[data-optional]').checked = row.optional === true;
      tr.querySelector('[data-del]').addEventListener('click', () => {
        tr.remove();
        syncEmptyState('extractTable');
        refreshTabBadges();
        scheduleUpdate();
      });
      bindChange(tr.querySelector('[data-name]'));
      bindChange(tr.querySelector('[data-from]'));
      bindChange(tr.querySelector('[data-scope]'));
      bindChange(tr.querySelector('[data-sensitive]'));
      bindChange(tr.querySelector('[data-optional]'));
      tbody.appendChild(tr);
    });
    syncEmptyState('extractTable');
    readExtractionRules();
    refreshTabBadges();
  }

  function replaceExtractionRulesIfChanged(rows) {
    if (tableHasFocus('extractTable')) {
      return;
    }
    if (rowsEqual(readExtractionRules(), rows || [])) {
      return;
    }
    renderExtractionRules(rows || []);
  }

  function catalogEntryByRef(dependRef) {
    return dependencyCatalog.find((entry) => entry.dependRef === dependRef);
  }

  function catalogEntryByLegacyId(legacyId) {
    return dependencyCatalog.find((entry) => entry.legacyAuthoredId === legacyId);
  }

  function catalogEntryByName(name) {
    const matches = dependencyCatalog.filter((entry) => entry.name === name);
    return matches.length === 1 ? matches[0] : undefined;
  }

  function displayLabelForDependsToken(token) {
    const byRef = catalogEntryByRef(token);
    if (byRef) {
      return byRef.folderLabel
        ? byRef.name + ' (' + byRef.folderLabel + ')'
        : byRef.name;
    }
    const byLegacy = catalogEntryByLegacyId(token);
    if (byLegacy) {
      return byLegacy.folderLabel
        ? byLegacy.name + ' (' + byLegacy.folderLabel + ')'
        : byLegacy.name;
    }
    if (/^req_[A-Za-z0-9]+$/.test(token)) {
      return 'Unknown request';
    }
    return token;
  }

  function readDependsOn() {
    return dependsOnSelectedRefs.slice();
  }

  function setDependsOnFromModel(tokens) {
    const next = [];
    const seen = new Set();
    (tokens || []).forEach((token) => {
      const trimmed = String(token || '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      const byRef = catalogEntryByRef(trimmed);
      if (byRef) {
        seen.add(byRef.dependRef);
        next.push(byRef.dependRef);
        return;
      }
      const byLegacy = catalogEntryByLegacyId(trimmed);
      if (byLegacy) {
        seen.add(byLegacy.dependRef);
        next.push(byLegacy.dependRef);
        return;
      }
      const byName = catalogEntryByName(trimmed);
      if (byName) {
        seen.add(byName.dependRef);
        next.push(byName.dependRef);
        return;
      }
      // Keep unresolved tokens so save-time migration / validation can see them.
      seen.add(trimmed);
      next.push(trimmed);
    });
    dependsOnSelectedRefs = next;
    renderDependsOnPicker();
  }

  function toggleDependsOnRef(dependRef, checked) {
    if (!dependRef) return;
    const set = new Set(dependsOnSelectedRefs);
    if (checked) set.add(dependRef);
    else set.delete(dependRef);
    dependsOnSelectedRefs = Array.from(set);
    renderDependsOnPicker();
    renderDependencyProjections();
    scheduleUpdate();
  }

  function removeDependsOnRef(dependRef) {
    dependsOnSelectedRefs = dependsOnSelectedRefs.filter((ref) => ref !== dependRef);
    renderDependsOnPicker();
    renderDependencyProjections();
    scheduleUpdate();
  }

  function pinAutoDependency(dependRef) {
    // Pin Auto → Manual: add human dependRef to dependsOn + normal save/refresh.
    // Does not change runtime semantics (Q1 Option A / RULE 8).
    if (!dependRef) return;
    toggleDependsOnRef(dependRef, true);
  }

  const EXEC_ICON_READY = ${JSON.stringify(iconHtml('check-circle', { className: 'ah-icon--success ah-icon--status', decorative: true }))};
  const EXEC_ICON_DEPS = ${JSON.stringify(iconHtml('network', { className: 'ah-icon--info ah-icon--status', decorative: true }))};
  const EXEC_ICON_ISSUE = ${JSON.stringify(iconHtml('alert-triangle', { className: 'ah-icon--warning ah-icon--status', decorative: true }))};
  // pin/remove use shared ahIconSpan from VARIABLE_INTELLISENSE_SCRIPT (single client helper).

  function setExecutionStatus(iconHtmlMarkup, headline, detail) {
    const iconEl = el('executionStatusIcon');
    const headlineEl = el('executionStatusHeadline');
    const detailEl = el('executionStatusDetail');
    if (iconEl) iconEl.innerHTML = iconHtmlMarkup;
    if (headlineEl) headlineEl.textContent = headline;
    if (detailEl) detailEl.textContent = detail;
  }

  function renderDependencyProjections() {
    const errorEl = el('dependencyProjectionError');
    const autoRoot = el('autoDependenciesList');
    const unknownRoot = el('unknownVariablesList');
    const ambiguousRoot = el('ambiguousProducersList');
    const unknownSection = el('unknownVariablesSection');
    const ambiguousSection = el('ambiguousProducersSection');
    const dependenciesContent = el('dependenciesContent');
    const autoSection = el('autoDependenciesSection');
    const pinnedLabel = el('pinnedLabel');
    const issuesContent = el('issuesContent');
    if (!autoRoot || !unknownRoot || !ambiguousRoot) return;

    if (errorEl) {
      if (dependencyProjectionError && dependencyProjectionError.message) {
        errorEl.hidden = false;
        errorEl.textContent = dependencyProjectionError.message;
      } else {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
    }

    const hasAuto = autoDependencies.length > 0;
    const hasManual = dependsOnSelectedRefs.length > 0;
    const hasUnknown = unknownVariables.length > 0;
    const hasAmbiguous = ambiguousProducers.length > 0;
    const hasIssues = hasUnknown || hasAmbiguous;

    if (hasUnknown && hasAmbiguous) {
      setExecutionStatus(
        EXEC_ICON_ISSUE,
        'Needs attention',
        'Fix missing variables and multiple producers'
      );
    } else if (hasUnknown) {
      setExecutionStatus(
        EXEC_ICON_ISSUE,
        'Missing required variables',
        'One or more variables have no producer'
      );
    } else if (hasAmbiguous) {
      setExecutionStatus(
        EXEC_ICON_ISSUE,
        'Multiple producers found',
        'Choose which request should provide each value'
      );
    } else {
      const uniqueRefs = new Set();
      autoDependencies.forEach((entry) => {
        if (entry && entry.dependRef) uniqueRefs.add(entry.dependRef);
      });
      dependsOnSelectedRefs.forEach((ref) => {
        if (ref) uniqueRefs.add(ref);
      });
      manualDependencies.forEach((entry) => {
        if (entry && entry.dependRef) uniqueRefs.add(entry.dependRef);
      });
      const n = uniqueRefs.size;
      if (n > 0) {
        setExecutionStatus(
          EXEC_ICON_DEPS,
          'Depends on ' + n + ' request' + (n === 1 ? '' : 's'),
          'Will run after its dependencies'
        );
      } else {
        setExecutionStatus(
          EXEC_ICON_READY,
          'Runs independently',
          'No dependencies required.'
        );
      }
    }

    if (dependenciesContent) dependenciesContent.hidden = !hasAuto;
    if (autoSection) autoSection.hidden = !hasAuto;
    if (pinnedLabel) pinnedLabel.hidden = !hasManual;
    if (issuesContent) issuesContent.hidden = !hasIssues;

    autoRoot.replaceChildren();
    if (hasAuto) {
      autoDependencies.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'depends-projection-row';
        const label = document.createElement('span');
        label.className = 'dep-label';
        label.textContent = entry.dependRef;
        row.appendChild(label);
        (entry.variables || []).forEach((variable) => {
          const reason = document.createElement('span');
          reason.className = 'depends-reason';
          reason.textContent = 'Uses ' + variable;
          row.appendChild(reason);
        });
        const alreadyManual =
          dependsOnSelectedRefs.includes(entry.dependRef) ||
          manualDependencies.some((manual) => manual.dependRef === entry.dependRef);
        if (!alreadyManual) {
          const pin = document.createElement('button');
          pin.type = 'button';
          pin.className = 'secondary depends-pin-btn';
          pin.innerHTML = ahIconSpan('pin');
          pin.title = 'Keep dependency ' + entry.dependRef;
          pin.setAttribute('aria-label', 'Keep dependency ' + entry.dependRef);
          pin.addEventListener('click', () => pinAutoDependency(entry.dependRef));
          row.appendChild(pin);
        } else {
          const pinned = document.createElement('span');
          pinned.className = 'depends-pinned-badge';
          pinned.innerHTML = ahIconSpan('pin');
          pinned.title = 'Already pinned: ' + entry.dependRef;
          pinned.setAttribute('role', 'img');
          pinned.setAttribute('aria-label', 'Already pinned: ' + entry.dependRef);
          row.appendChild(pinned);
        }
        autoRoot.appendChild(row);
      });
    }

    unknownRoot.replaceChildren();
    if (unknownSection) {
      unknownSection.hidden = !hasUnknown;
    }
    if (hasUnknown) {
      unknownVariables.forEach((name) => {
        const row = document.createElement('div');
        row.className = 'depends-projection-row';
        const label = document.createElement('span');
        label.className = 'dep-label';
        label.textContent = name;
        row.appendChild(label);
        const explain = document.createElement('span');
        explain.className = 'depends-reason';
        explain.textContent = 'No request produces this value.';
        row.appendChild(explain);
        const ignore = document.createElement('button');
        ignore.type = 'button';
        ignore.className = 'ghost';
        ignore.textContent = 'Ignore';
        ignore.title = 'Hide this variable in this workspace';
        ignore.addEventListener('click', () => {
          post({ type: 'ignoreUnknownVariable', name });
        });
        row.appendChild(ignore);
        unknownRoot.appendChild(row);
      });
    }

    ambiguousRoot.replaceChildren();
    if (ambiguousSection) {
      ambiguousSection.hidden = !hasAmbiguous;
    }
    if (hasAmbiguous) {
      ambiguousProducers.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'depends-projection-row';
        const label = document.createElement('span');
        label.className = 'dep-label';
        label.textContent = entry.variable;
        row.appendChild(label);
        const explain = document.createElement('span');
        explain.className = 'depends-reason';
        explain.textContent = 'Choose which request should provide this value.';
        row.appendChild(explain);
        (entry.producers || []).forEach((producer) => {
          const pin = document.createElement('button');
          pin.type = 'button';
          pin.className = 'secondary depends-pin-btn';
          pin.innerHTML = ahIconSpan('pin');
          pin.appendChild(document.createTextNode(' ' + producer.dependRef));
          pin.title = 'Use ' + producer.dependRef + ' for this value';
          pin.setAttribute(
            'aria-label',
            'Use ' + producer.dependRef + ' for this value'
          );
          pin.addEventListener('click', () => pinAutoDependency(producer.dependRef));
          row.appendChild(pin);
        });
        ambiguousRoot.appendChild(row);
      });
    }
  }

  function renderDependsOnPicker() {
    const chips = el('dependsOnChips');
    const list = el('dependsOnList');
    const search = el('dependsOnSearch');
    if (!chips || !list || !search) return;

    chips.innerHTML = '';
    dependsOnSelectedRefs.forEach((token) => {
      const chip = document.createElement('span');
      chip.className = 'depends-chip';
      chip.setAttribute('data-depends-ref', token);
      const label = document.createElement('span');
      label.textContent = displayLabelForDependsToken(token);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + label.textContent);
      remove.innerHTML = ahIconSpan('x');
      remove.addEventListener('click', () => removeDependsOnRef(token));
      chip.appendChild(label);
      chip.appendChild(remove);
      chips.appendChild(chip);
    });

    const query = (search.value || '').trim().toLowerCase();
    list.innerHTML = '';
    const options = dependencyCatalog.filter((entry) => {
      if (!query) return true;
      const hay = (entry.name + ' ' + (entry.folderLabel || entry.folderPath || '')).toLowerCase();
      return hay.includes(query);
    });
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'depends-empty';
      empty.textContent = dependencyCatalog.length === 0
        ? 'No other requests in this collection.'
        : 'No matching requests.';
      list.appendChild(empty);
    } else {
      options.forEach((entry) => {
        const label = document.createElement('label');
        label.className = 'depends-option';
        label.setAttribute('role', 'option');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = entry.dependRef;
        input.checked = dependsOnSelectedRefs.includes(entry.dependRef);
        input.addEventListener('change', () => {
          toggleDependsOnRef(entry.dependRef, input.checked);
        });
        const meta = document.createElement('span');
        meta.className = 'depends-option-meta';
        const name = document.createElement('span');
        name.className = 'depends-option-name';
        name.textContent = entry.name;
        meta.appendChild(name);
        if (entry.folderLabel || entry.folderPath) {
          const folder = document.createElement('span');
          folder.className = 'depends-option-folder';
          folder.textContent = entry.folderLabel || entry.folderPath;
          meta.appendChild(folder);
        }
        label.appendChild(input);
        label.appendChild(meta);
        list.appendChild(label);
      });
    }
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

  function flushPendingUpdate() {
    if (applying || !state || state.mode !== 'form') return false;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (!formDirty) return false;
    const model = currentModel();
    state.model = model;
    formDirty = false;
    refreshPreview();
    refreshVariablePreviewLocal(model);
    post({
      type: 'updateModel',
      documentVersion: state.documentVersion,
      model
    });
    return true;
  }

  function scheduleUpdate() {
    if (applying || !state || state.mode !== 'form') return;
    formDirty = true;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      flushPendingUpdate();
    }, DEBOUNCE_MS);
  }

  function bindChange(node) {
    node.addEventListener('input', scheduleUpdate);
    node.addEventListener('change', scheduleUpdate);
    // Only flush on blur when the user actually edited while focused — never
    // post stale DOM over a newer inbound model after applyState skipped the field.
    node.addEventListener('blur', () => {
      if (formDirty) {
        flushPendingUpdate();
      }
    });
  }

  function syncMethodSelect() {
    const select = el('method');
    const map = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head', OPTIONS: 'options' };
    const key = map[String(select.value || '').trim().toUpperCase()] || 'other';
    select.className = 'method-select method-' + key;
  }

  function syncEmptyState(tableId) {
    const empty = document.querySelector('[data-empty-for="' + tableId + '"]');
    if (!empty) return;
    const count = el(tableId).querySelectorAll('tbody tr').length;
    empty.hidden = count > 0;
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
        syncEmptyState(tableId);
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
      bindVarComplete(tr.querySelector('[data-v]'));
      tbody.appendChild(tr);
    });
    syncEmptyState(tableId);
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
        syncEmptyState('variablesTable');
        refreshTabBadges();
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
      bindVarComplete(tr.querySelector('[data-k]'));
      bindVarComplete(tr.querySelector('[data-v]'));
      tbody.appendChild(tr);
    });
    syncEmptyState('variablesTable');
    refreshTabBadges();
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
        refreshTabBadges();
        scheduleUpdate();
      });
      list.appendChild(li);
    });
    refreshTabBadges();
  }

  function updateBodyVisibility() {
    const type = el('bodyType').value;
    el('bodyJsonText').hidden = !(type === 'json' || type === 'text' || type === 'raw');
    el('rawContentTypeField').hidden = type !== 'raw';
    el('bodyForm').hidden = type !== 'form';
    el('bodyMultipart').hidden = type !== 'multipart';
    el('bodyBinary').hidden = type !== 'binary';
  }

  function isFocused(node) {
    return document.activeElement === node;
  }

  function setFieldValue(id, nextValue) {
    const node = el(id);
    if (isFocused(node)) {
      return;
    }
    const value = nextValue == null ? '' : String(nextValue);
    if (node.value !== value) {
      node.value = value;
    }
  }

  function rowsEqual(a, b) {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  }

  function tableHasFocus(tableId) {
    const active = document.activeElement;
    return !!(active && el(tableId).contains(active));
  }

  function replaceKvRowsIfChanged(tableId, rows, withEnabled) {
    if (tableHasFocus(tableId)) {
      return;
    }
    const current = readKvTable(tableId, withEnabled);
    if (rowsEqual(current, rows || [])) {
      return;
    }
    renderKvRows(tableId, rows || [], withEnabled);
  }

  function replaceVariablesIfChanged(rows) {
    if (tableHasFocus('variablesTable')) {
      return;
    }
    if (rowsEqual(readVariables(), rows || [])) {
      return;
    }
    renderVariables(rows || []);
  }

  function replaceTestsIfChanged(lines) {
    const list = el('testsList');
    const active = document.activeElement;
    if (active && list.contains(active)) {
      return;
    }
    const next = lines || [];
    if (rowsEqual(readExpectLines(), next)) {
      return;
    }
    renderTests(next);
  }

  function applyBody(body) {
    const type = body && body.type ? body.type : 'none';
    setFieldValue('bodyType', type);
    if (type === 'json' || type === 'text' || type === 'raw') {
      setFieldValue('bodyText', body.text || '');
      if (type === 'raw') {
        setFieldValue('rawContentType', body.contentType || '');
      } else {
        setFieldValue('rawContentType', '');
      }
      replaceKvRowsIfChanged('formTable', [], false);
      replaceKvRowsIfChanged('multipartTable', [], false);
      setFieldValue('multipartBoundary', '');
      setFieldValue('binaryNote', '');
    } else if (type === 'form') {
      setFieldValue('bodyText', '');
      setFieldValue('rawContentType', '');
      setFieldValue('multipartBoundary', '');
      setFieldValue('binaryNote', '');
      replaceKvRowsIfChanged('formTable', body.fields || [], false);
      replaceKvRowsIfChanged('multipartTable', [], false);
    } else if (type === 'multipart') {
      setFieldValue('bodyText', '');
      setFieldValue('rawContentType', '');
      setFieldValue('multipartBoundary', body.boundary || '');
      setFieldValue('binaryNote', '');
      replaceKvRowsIfChanged('formTable', [], false);
      replaceKvRowsIfChanged('multipartTable', body.fields || [], false);
    } else if (type === 'binary') {
      setFieldValue('bodyText', '');
      setFieldValue('rawContentType', '');
      setFieldValue('multipartBoundary', '');
      setFieldValue('binaryNote', body.note || '');
      replaceKvRowsIfChanged('formTable', [], false);
      replaceKvRowsIfChanged('multipartTable', [], false);
    } else {
      setFieldValue('bodyText', '');
      setFieldValue('rawContentType', '');
      setFieldValue('multipartBoundary', '');
      setFieldValue('binaryNote', '');
      replaceKvRowsIfChanged('formTable', [], false);
      replaceKvRowsIfChanged('multipartTable', [], false);
    }
    updateBodyVisibility();
  }

  function applyAuthProfiles(profiles, selected) {
    authProfileOptions = profiles || [];
    const select = el('authProfile');
    const focused = isFocused(select);
    const nextSelected = selected || '';
    const profileKey = JSON.stringify(
      (profiles || []).map((profile) => [
        profile.id,
        profile.label || profile.id,
        profile.providerId || '',
        profile.name || '',
        profile.location || '',
      ])
    );
    const currentKey = JSON.stringify(
      Array.from(select.options)
        .filter((option) => option.value)
        .map((option) => [
          option.value,
          option.textContent || option.value,
          option.getAttribute('data-provider-id') || '',
          option.getAttribute('data-api-key-name') || '',
          option.getAttribute('data-api-key-location') || '',
        ])
    );
    if (profileKey !== currentKey) {
      const keepValue = focused ? select.value : nextSelected;
      select.innerHTML = '<option value="">none</option>';
      (profiles || []).forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.label || profile.id;
        if (profile.providerId) option.setAttribute('data-provider-id', profile.providerId);
        if (profile.name) option.setAttribute('data-api-key-name', profile.name);
        if (profile.location) option.setAttribute('data-api-key-location', profile.location);
        select.appendChild(option);
      });
      if (!focused) select.value = nextSelected;
      else if ([...select.options].some((option) => option.value === keepValue)) {
        select.value = keepValue;
      }
    } else if (!focused) {
      select.value = nextSelected;
    }
    const mode = el('authMode');
    if (!isFocused(mode)) {
      if (nextSelected) mode.value = 'saved';
      else if (mode.value !== 'oneshot') mode.value = 'none';
    }
    updateAuthModeVisibility();
    updateAuthPreview();
  }

  function updateAuthModeVisibility() {
    const mode = el('authMode').value;
    el('authSavedBlock').hidden = mode !== 'saved';
    el('authOneshotBlock').hidden = mode !== 'oneshot';
    const guidance = el('authEmptyGuidance');
    const selected = el('authProfile').value.trim();
    const oneshot = el('oneshotToken').value.length > 0;
    guidance.hidden = !(mode === 'none' || (mode === 'saved' && !selected) || (mode === 'oneshot' && !oneshot));
  }

  /** Scheme-aware masked preview matching Auth Manager (never shows secrets). */
  function buildSavedAuthPreview(profile) {
    const mask = '••••••••';
    if (!profile || !profile.providerId || profile.providerId === 'none') {
      return {
        preview: 'No authentication headers will be added.',
        headerNames: [],
      };
    }
    if (profile.providerId === 'bearer') {
      return {
        preview: 'Authorization: Bearer ' + mask,
        headerNames: ['Authorization'],
      };
    }
    if (profile.providerId === 'basic') {
      return {
        preview: 'Authorization: Basic ' + mask,
        headerNames: ['Authorization'],
      };
    }
    if (profile.providerId === 'apiKey') {
      const name = ((profile.name || 'X-API-Key') + '').trim() || 'X-API-Key';
      const location = profile.location === 'query' ? 'query' : 'header';
      return {
        preview: location === 'query'
          ? ('Query: ' + name + '=' + mask)
          : (name + ': ' + mask),
        headerNames: location === 'header' ? [name] : [],
      };
    }
    return { preview: 'Unknown provider.', headerNames: [] };
  }

  function updateAuthPreview() {
    const mode = el('authMode').value;
    const mask = '••••••••';
    const preview = el('authPreview');
    const copyBtn = el('copyAuthHeaderName');
    if (mode === 'none') {
      preview.textContent = 'No authentication headers will be added.';
      copyBtn.hidden = true;
      return;
    }
    if (mode === 'oneshot') {
      const hasToken = el('oneshotToken').value.length > 0;
      preview.textContent = 'Authorization: Bearer ' + mask;
      preview.title = hasToken
        ? 'One-shot Bearer ready for this Send.'
        : 'Paste a Bearer token for one-shot authentication.';
      copyBtn.hidden = false;
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText('Authorization'); } catch (err) {}
      };
      return;
    }
    const selected = el('authProfile').value.trim();
    if (!selected) {
      preview.textContent = 'No authentication headers will be added.';
      copyBtn.hidden = true;
      return;
    }
    const profile = authProfileOptions.find((entry) => entry.id === selected);
    const built = buildSavedAuthPreview(profile);
    const label = (profile && profile.label) || selected;
    preview.textContent = built.preview + ' (Authentication: ' + label + ')';
    preview.title = '';
    const headerName = built.headerNames && built.headerNames[0];
    copyBtn.hidden = !headerName;
    if (headerName) {
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(headerName); } catch (err) {}
      };
    }
  }

  function renderAuthResolution() {
    const list = el('authResolutionChain');
    list.innerHTML = '';
    const resolution = state && state.authResolution;
    const steps = resolution && resolution.steps ? resolution.steps : [
      { label: 'Request Override', selected: false },
      { label: 'Collection Default', selected: false },
      { label: 'Workspace/Session Default', selected: false },
    ];
    for (const step of steps) {
      const item = document.createElement('li');
      item.className = step.selected ? 'selected' : '';
      const idPart = step.authenticationId ? ' → ' + step.authenticationId : ' — none';
      item.textContent = step.label + idPart + (step.selected ? ' (selected)' : '');
      list.appendChild(item);
    }
  }

  function refreshPreview() {
    if (!state) return;
    el('previewSource').textContent = state.sourceText || '';
  }

  function refreshVariablePreviewLocal(model) {
    const preview = state && state.variablePreview ? state.variablePreview : {};
    const lines = Object.keys(preview).sort().map((key) => key + ' = ' + preview[key]);
    el('variablePreview').textContent =
      lines.length
        ? lines.join('\\n')
        : 'No resolved variables yet';
  }

  function refreshActiveEnvironmentUi() {
    const label = state && state.activeEnvironmentLabel
      ? String(state.activeEnvironmentLabel)
      : '';
    const envShortcut = el('envShortcut');
    const variablesActiveEnv = el('variablesActiveEnv');
    if (label) {
      envShortcut.textContent = 'Env: ' + label;
      envShortcut.title = 'Active environment: ' + label + ' — click to switch';
      envShortcut.setAttribute('aria-label', 'Active environment ' + label + '. Switch Environment');
      variablesActiveEnv.textContent = 'Active environment: ' + label;
    } else {
      envShortcut.textContent = 'Env: None';
      envShortcut.title = 'No active environment — click to switch';
      envShortcut.setAttribute('aria-label', 'No active environment. Switch Environment');
      variablesActiveEnv.textContent = 'Active environment: None';
    }
  }

  function applyState(next) {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    formDirty = false;
    applying = true;
    state = next;
    showError('');
    refreshActiveEnvironmentUi();
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
      // Toolbar url/method sit outside formRoot; disable so edits are not lost.
      el('url').disabled = true;
      el('method').disabled = true;
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
      // Toolbar url/method sit outside formRoot; disable so edits are not lost.
      el('url').disabled = true;
      el('method').disabled = true;
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
    el('url').disabled = false;
    el('method').disabled = false;

    const model = next.model || defaultModel();
    setFieldValue('name', model.name || '');
    setFieldValue('description', model.description || '');
    dependencyCatalog = Array.isArray(next.dependencyCatalog)
      ? next.dependencyCatalog.slice()
      : [];
    autoDependencies = Array.isArray(next.autoDependencies)
      ? next.autoDependencies.slice()
      : [];
    manualDependencies = Array.isArray(next.manualDependencies)
      ? next.manualDependencies.slice()
      : [];
    unknownVariables = Array.isArray(next.unknownVariables)
      ? next.unknownVariables.slice()
      : [];
    ambiguousProducers = Array.isArray(next.ambiguousProducers)
      ? next.ambiguousProducers.slice()
      : [];
    dependencyProjectionError =
      next.dependencyProjectionError &&
      typeof next.dependencyProjectionError.message === 'string'
        ? next.dependencyProjectionError
        : null;
    setDependsOnFromModel(model.dependsOn || []);
    renderDependencyProjections();
    setFieldValue('method', model.method || 'GET');
    syncMethodSelect();
    setFieldValue('url', model.url || '');
    setFieldValue(
      'timeoutMs',
      model.timeoutMs === undefined || model.timeoutMs === null
        ? ''
        : String(model.timeoutMs)
    );
    applyAuthProfiles(next.authProfiles || [], model.authProfileId || '');
    renderAuthResolution();
    updateAuthModeVisibility();
    updateAuthPreview();
    replaceKvRowsIfChanged('paramsTable', model.queryParams || [], true);
    replaceKvRowsIfChanged('headersTable', model.headers || [], true);
    replaceVariablesIfChanged(model.variables || []);
    replaceExtractionRulesIfChanged(model.extractionRules || []);
    replaceTestsIfChanged(model.expectLines || []);
    applyBody(model.body || { type: 'none' });
    refreshPreview();
    refreshVariablePreviewLocal(model);
    setVarCatalog(next.variableCompletions || []);
    bindAllVarFields();
    refreshTabBadges();
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

  const dependsSearch = el('dependsOnSearch');
  const dependsList = el('dependsOnList');
  const dependsAddBtn = el('dependsOnAddBtn');
  const dependsPopover = el('dependsOnPopover');
  if (dependsSearch && dependsList && dependsAddBtn && dependsPopover) {
    function openDependsOnPopover() {
      dependsPopover.hidden = false;
      renderDependsOnPicker();
      dependsSearch.focus();
    }
    function closeDependsOnPopover() {
      if (dependsPopover.hidden) return;
      dependsPopover.hidden = true;
      dependsAddBtn.focus();
    }
    dependsAddBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dependsPopover.hidden) {
        openDependsOnPopover();
      } else {
        closeDependsOnPopover();
      }
    });
    dependsSearch.addEventListener('input', () => {
      renderDependsOnPicker();
    });
    dependsSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDependsOnPopover();
      }
    });
    document.addEventListener('click', (event) => {
      const picker = el('dependsOnPicker');
      if (!picker || picker.contains(event.target)) return;
      if (dependsPopover.hidden) return;
      closeDependsOnPopover();
    });
  }

  el('method').addEventListener('change', syncMethodSelect);
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
      } else if (kind === 'extract') {
        const rows = readExtractionRules();
        rows.push({ name: '', from: '', scope: 'run' });
        renderExtractionRules(rows);
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

  function runRequest() {
    const mode = el('authMode').value;
    if (mode === 'oneshot') {
      const token = el('oneshotToken').value;
      if (!token || token.length === 0) {
        window.alert('Paste a Bearer token for one-shot authentication before Send.');
        return;
      }
      // Flush other form fields; oneshot path preserves authProfileId (see currentModel).
      flushPendingUpdate();
      post({
        type: 'run',
        ephemeralAuth: {
          providerId: 'bearer',
          material: { token },
        },
      });
      // Clear one-shot token from UI memory after Send (save prompt uses host copy).
      el('oneshotToken').value = '';
      updateAuthPreview();
      return;
    }
    // Flush pending form edits before run so execution sees the latest model.
    flushPendingUpdate();
    post({ type: 'run' });
  }
  el('run').addEventListener('click', () => {
    runRequest();
  });
  // Belt-and-suspenders when the webview has keyboard focus (host keybinding
  // may not fire for Custom Text Editor webviews).
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
    if (event.key !== 'r' && event.key !== 'R') return;
    event.preventDefault();
    runRequest();
  });
  el('openText').addEventListener('click', () => post({ type: 'openTextEditor' }));
  el('envShortcut').addEventListener('click', () => post({ type: 'switchEnvironment' }));
  el('authShortcut').addEventListener('click', () => post({ type: 'selectAuthentication' }));
  el('manageAuthProfiles').addEventListener('click', () => post({ type: 'manageAuthProfiles' }));
  el('selectAuthentication').addEventListener('click', () => post({ type: 'selectAuthentication' }));
  el('saveAsAuthConfirm').addEventListener('click', () => {
    el('saveAsAuthBanner').hidden = true;
    post({ type: 'saveAsAuthentication' });
  });
  el('saveAsAuthDismiss').addEventListener('click', () => {
    el('saveAsAuthBanner').hidden = true;
    post({ type: 'dismissSaveAsAuthentication' });
  });
  el('authMode').addEventListener('change', () => {
    updateAuthModeVisibility();
    updateAuthPreview();
    scheduleUpdate();
  });
  el('authProfile').addEventListener('change', () => {
    updateAuthPreview();
    scheduleUpdate();
  });
  el('oneshotToken').addEventListener('input', () => {
    updateAuthModeVisibility();
    updateAuthPreview();
  });
  el('manageEnvironments').addEventListener('click', () => post({ type: 'manageEnvironments' }));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init' || message.type === 'state') {
      applyState(message.state);
      return;
    }
    if (message.type === 'ack') {
      if (!state) return;
      state.documentVersion = message.documentVersion;
      if (typeof message.sourceText === 'string') {
        state.sourceText = message.sourceText;
        refreshPreview();
      }
      return;
    }
    if (message.type === 'resubmit') {
      if (!state) return;
      state.documentVersion = message.documentVersion;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      if (state.mode !== 'form') return;
      const model = currentModel();
      state.model = model;
      post({
        type: 'updateModel',
        documentVersion: state.documentVersion,
        model
      });
      return;
    }
    if (message.type === 'error') {
      showError(message.message || 'Something went wrong.');
      return;
    }
    if (message.type === 'offerSaveAsAuthentication') {
      el('saveAsAuthBanner').hidden = false;
      return;
    }
  });

  syncMethodSelect();
  updateTestHint();
  updateBodyVisibility();
  bindAllVarFields();
  post({ type: 'ready' });
})();
`;
