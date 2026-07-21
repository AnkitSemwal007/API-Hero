/**
 * Pure HTML/CSS/JS for the OpenAPI Import multi-step wizard (no vscode import).
 */

import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
} from '../../ui/webview';

export { escapeAttribute };

/** Ordered wizard steps shown in the progress indicator. */
export const OPENAPI_IMPORT_WIZARD_STEPS = [
  'workspace',
  'file',
  'preview',
  'progress',
  'summary',
] as const;

export type OpenApiImportWizardStep =
  (typeof OPENAPI_IMPORT_WIZARD_STEPS)[number];

export interface OpenApiImportWizardFolder {
  readonly name: string;
  readonly path: string;
}

export interface OpenApiImportWizardPreview {
  readonly apiName: string;
  readonly apiVersion: string;
  readonly openapiVersion: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly environmentCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly outputDirectoryName: string;
  readonly warningCount: number;
  readonly warnings: readonly string[];
}

export interface OpenApiImportWizardSummaryView {
  readonly success: boolean;
  readonly cancelled: boolean;
  readonly apiName: string;
  readonly apiVersion: string;
  readonly openapiVersion: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly environmentCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly targetDirectory: string;
  readonly writtenFileCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly secretHints: readonly string[];
  readonly manageAuthAvailable: boolean;
}

export interface OpenApiImportWizardState {
  readonly folders: readonly OpenApiImportWizardFolder[];
  readonly skipWorkspaceStep: boolean;
  readonly selectedFolderPath?: string;
  readonly manageAuthAvailable: boolean;
  readonly step: OpenApiImportWizardStep;
}

export type OpenApiImportWizardInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'cancel' }
  | { readonly type: 'close' }
  | { readonly type: 'selectWorkspace'; readonly path: string }
  | { readonly type: 'pickFile' }
  | { readonly type: 'analyze'; readonly outputDirectoryName: string }
  | { readonly type: 'startImport'; readonly outputDirectoryName: string }
  | { readonly type: 'cancelImport' }
  | { readonly type: 'manageAuthProfiles' }
  | { readonly type: 'back'; readonly to: OpenApiImportWizardStep };

export type OpenApiImportWizardOutboundMessage =
  | { readonly type: 'init'; readonly state: OpenApiImportWizardState }
  | {
      readonly type: 'fileSelected';
      readonly path: string;
      readonly name: string;
    }
  | {
      readonly type: 'preview';
      readonly preview: OpenApiImportWizardPreview;
    }
  | { readonly type: 'previewError'; readonly message: string }
  | {
      readonly type: 'progress';
      readonly phase: string;
      readonly message: string;
    }
  | {
      readonly type: 'summary';
      readonly summary: OpenApiImportWizardSummaryView;
    }
  | { readonly type: 'error'; readonly message: string };

const STEP_SET = new Set<string>(OPENAPI_IMPORT_WIZARD_STEPS);

/** Validates webview → extension messages. */
export function parseOpenApiImportWizardMessage(
  value: unknown,
): OpenApiImportWizardInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  const type = record.type;
  if (
    type === 'ready' ||
    type === 'cancel' ||
    type === 'close' ||
    type === 'pickFile' ||
    type === 'cancelImport' ||
    type === 'manageAuthProfiles'
  ) {
    return { type };
  }
  if (type === 'selectWorkspace' && typeof record.path === 'string') {
    return { type: 'selectWorkspace', path: record.path };
  }
  if (
    (type === 'analyze' || type === 'startImport') &&
    typeof record.outputDirectoryName === 'string'
  ) {
    return { type, outputDirectoryName: record.outputDirectoryName };
  }
  if (type === 'back' && typeof record.to === 'string' && STEP_SET.has(record.to)) {
    return { type: 'back', to: record.to as OpenApiImportWizardStep };
  }
  return undefined;
}

/** Builds the OpenAPI Import wizard document. */
export function renderOpenApiImportWizardHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Import OpenAPI</title>
<style nonce="${safeNonce}">${WIZARD_CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>Import OpenAPI</h1>
    <p class="subtitle">Generate a collection from an OpenAPI 3.0 / 3.1 specification.</p>
  </header>
  <nav id="steps" class="steps" aria-label="Import steps"></nav>
  <p id="error" class="error" hidden></p>

  <section id="step-workspace" class="panel" hidden>
    <h2>Workspace folder</h2>
    <p class="hint">Choose where imported <code>.api</code> files will be written.</p>
    <label class="field">
      <span>Folder</span>
      <select id="workspace"></select>
    </label>
    <footer class="actions">
      <button type="button" id="workspaceCancel" class="secondary">Cancel</button>
      <button type="button" id="workspaceNext" class="primary">Next</button>
    </footer>
  </section>

  <section id="step-file" class="panel" hidden>
    <h2>Specification file</h2>
    <p class="hint">Select a JSON or YAML OpenAPI document.</p>
    <div class="file-row">
      <button type="button" id="browseFile" class="primary">Browse…</button>
      <p id="fileLabel" class="file-label muted">No file selected</p>
    </div>
    <footer class="actions">
      <button type="button" id="fileBack" class="secondary">Back</button>
      <button type="button" id="fileCancel" class="secondary">Cancel</button>
      <button type="button" id="fileNext" class="primary" disabled>Next</button>
    </footer>
  </section>

  <section id="step-preview" class="panel" hidden>
    <h2>Preview</h2>
    <p class="hint">Review what will be imported. Nothing is written until you confirm.</p>
    <dl id="previewCounts" class="counts"></dl>
    <ul id="previewWarnings" class="diag-list" hidden></ul>
    <label class="field">
      <span>Output directory <em>(under workspace)</em></span>
      <input id="outputDirectory" type="text" autocomplete="off" spellcheck="false" />
    </label>
    <footer class="actions">
      <button type="button" id="previewBack" class="secondary">Back</button>
      <button type="button" id="previewCancel" class="secondary">Cancel</button>
      <button type="button" id="previewImport" class="primary">Import</button>
    </footer>
  </section>

  <section id="step-progress" class="panel" hidden>
    <h2>Importing…</h2>
    <p id="progressMessage" class="progress-message">Starting…</p>
    <p id="progressPhase" class="muted"></p>
    <footer class="actions">
      <button type="button" id="progressCancel" class="secondary">Cancel</button>
    </footer>
  </section>

  <section id="step-summary" class="panel" hidden>
    <h2 id="summaryTitle">Import complete</h2>
    <dl id="summaryCounts" class="counts"></dl>
    <ul id="summaryDiagnostics" class="diag-list" hidden></ul>
    <div id="secretBlock" class="secret-block" hidden>
      <h3>Secrets to configure</h3>
      <p class="hint">Imported auth profiles use Secret Storage placeholders. Set real values in Auth Profiles.</p>
      <ul id="secretHints" class="diag-list"></ul>
      <button type="button" id="manageAuth" class="primary" hidden>Manage Auth Profiles</button>
    </div>
    <footer class="actions">
      <button type="button" id="summaryClose" class="primary">Close</button>
    </footer>
  </section>
</main>
<script nonce="${safeNonce}">${WIZARD_SCRIPT}</script>
</body>
</html>`;
}

const WIZARD_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
main { max-width: 640px; margin: 0 auto; padding: 20px 22px 28px; }
header { margin-bottom: 14px; }
h1 { margin: 0 0 6px; font-size: 1.25rem; font-weight: 600; }
h2 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 600; }
h3 { margin: 0 0 6px; font-size: .95rem; font-weight: 600; }
.subtitle, .hint, .muted {
  margin: 0;
  color: var(--vscode-descriptionForeground);
}
.hint { margin-bottom: 12px; }
.hint code, .file-label code {
  font-family: var(--vscode-editor-font-family);
  font-size: .92em;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 16px;
  padding: 0;
  list-style: none;
}
.steps .step {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 2px;
  padding: 3px 8px;
  font-size: .82em;
  color: var(--vscode-descriptionForeground);
}
.steps .step.active {
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-color: transparent;
}
.steps .step.done {
  color: var(--vscode-foreground);
  border-color: var(--vscode-focusBorder);
}
.panel { display: grid; gap: 12px; }
.field { display: grid; gap: 6px; }
.field span { color: var(--vscode-descriptionForeground); font-size: .9em; }
.field em { font-style: normal; opacity: .8; }
input, select {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px;
  padding: 7px 9px;
  font: inherit;
}
input:focus, select:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.file-row { display: grid; gap: 8px; justify-items: start; }
.file-label { word-break: break-all; }
.counts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  margin: 0;
}
.counts dt { color: var(--vscode-descriptionForeground); }
.counts dd { margin: 0; }
.diag-list {
  margin: 0;
  padding-left: 1.2em;
  color: var(--vscode-descriptionForeground);
}
.diag-list li { margin: 2px 0; }
.error {
  margin: 0 0 12px;
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: .92em;
}
.progress-message { margin: 0; font-weight: 500; }
.secret-block {
  border-top: 1px solid var(--vscode-panel-border);
  padding-top: 12px;
  display: grid;
  gap: 8px;
  justify-items: start;
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--vscode-panel-border);
}
button {
  border: 1px solid var(--vscode-contrastBorder, transparent);
  border-radius: 2px;
  padding: 6px 14px;
  font: inherit;
  cursor: pointer;
}
button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
button:disabled { opacity: .55; cursor: default; }
`;

const WIZARD_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const STEP_ORDER = ${JSON.stringify([...OPENAPI_IMPORT_WIZARD_STEPS])};
  const STEP_LABELS = {
    workspace: 'Workspace',
    file: 'File',
    preview: 'Preview',
    progress: 'Progress',
    summary: 'Summary',
  };

  /** @type {{ folders: Array<{ name: string, path: string }>, skipWorkspaceStep: boolean, selectedFolderPath?: string, manageAuthAvailable: boolean, step: string } | undefined} */
  let state;
  let filePath = '';
  let fileName = '';
  let analyzing = false;

  const errorEl = document.getElementById('error');
  const stepsNav = document.getElementById('steps');
  const workspaceSelect = document.getElementById('workspace');
  const fileLabel = document.getElementById('fileLabel');
  const fileNext = document.getElementById('fileNext');
  const outputDirectory = document.getElementById('outputDirectory');
  const previewCounts = document.getElementById('previewCounts');
  const previewWarnings = document.getElementById('previewWarnings');
  const progressMessage = document.getElementById('progressMessage');
  const progressPhase = document.getElementById('progressPhase');
  const summaryTitle = document.getElementById('summaryTitle');
  const summaryCounts = document.getElementById('summaryCounts');
  const summaryDiagnostics = document.getElementById('summaryDiagnostics');
  const secretBlock = document.getElementById('secretBlock');
  const secretHints = document.getElementById('secretHints');
  const manageAuth = document.getElementById('manageAuth');

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function fillCounts(target, rows) {
    target.innerHTML = '';
    for (const [label, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      target.appendChild(dt);
      target.appendChild(dd);
    }
  }

  function fillList(target, items) {
    target.innerHTML = '';
    if (!items || items.length === 0) {
      target.hidden = true;
      return;
    }
    target.hidden = false;
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      target.appendChild(li);
    }
  }

  function renderSteps(active) {
    stepsNav.innerHTML = '';
    const activeIndex = STEP_ORDER.indexOf(active);
    const skipWorkspace = state?.skipWorkspaceStep === true;
    for (let index = 0; index < STEP_ORDER.length; index += 1) {
      const id = STEP_ORDER[index];
      if (id === 'workspace' && skipWorkspace) {
        continue;
      }
      const el = document.createElement('span');
      el.className = 'step';
      if (id === active) {
        el.classList.add('active');
      } else if (index < activeIndex) {
        el.classList.add('done');
      }
      el.textContent = STEP_LABELS[id] || id;
      stepsNav.appendChild(el);
    }
  }

  function showStep(step) {
    if (state) {
      state = { ...state, step };
    }
    for (const id of STEP_ORDER) {
      const panel = document.getElementById('step-' + id);
      if (panel) {
        panel.hidden = id !== step;
      }
    }
    renderSteps(step);
  }

  function fillWorkspaces() {
    workspaceSelect.innerHTML = '';
    for (const folder of state?.folders ?? []) {
      const option = document.createElement('option');
      option.value = folder.path;
      option.textContent = folder.name + ' — ' + folder.path;
      workspaceSelect.appendChild(option);
    }
    if (state?.selectedFolderPath) {
      workspaceSelect.value = state.selectedFolderPath;
    }
  }

  function applyInit(next) {
    state = next;
    fillWorkspaces();
    showError('');
    filePath = '';
    fileName = '';
    fileLabel.textContent = 'No file selected';
    fileLabel.classList.add('muted');
    fileNext.disabled = true;
    document.getElementById('fileBack').hidden = next.skipWorkspaceStep === true;
    if (next.skipWorkspaceStep) {
      showStep('file');
    } else {
      showStep(next.step || 'workspace');
    }
  }

  document.getElementById('workspaceCancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });
  document.getElementById('workspaceNext').addEventListener('click', () => {
    showError('');
    const path = workspaceSelect.value;
    if (!path) {
      showError('Select a workspace folder.');
      return;
    }
    vscode.postMessage({ type: 'selectWorkspace', path });
    showStep('file');
  });

  document.getElementById('fileBack').addEventListener('click', () => {
    if (state?.skipWorkspaceStep) {
      vscode.postMessage({ type: 'cancel' });
      return;
    }
    showError('');
    showStep('workspace');
    vscode.postMessage({ type: 'back', to: 'workspace' });
  });
  document.getElementById('fileCancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });
  document.getElementById('browseFile').addEventListener('click', () => {
    showError('');
    vscode.postMessage({ type: 'pickFile' });
  });
  document.getElementById('fileNext').addEventListener('click', () => {
    if (!filePath || analyzing) {
      return;
    }
    showError('');
    analyzing = true;
    fileNext.disabled = true;
    document.getElementById('previewImport').disabled = true;
    showStep('preview');
    previewCounts.innerHTML = '';
    const loading = document.createElement('dt');
    loading.textContent = 'Status';
    const loadingDd = document.createElement('dd');
    loadingDd.textContent = 'Analyzing specification…';
    previewCounts.appendChild(loading);
    previewCounts.appendChild(loadingDd);
    fillList(previewWarnings, []);
    vscode.postMessage({
      type: 'analyze',
      outputDirectoryName: outputDirectory.value.trim(),
    });
  });

  document.getElementById('previewBack').addEventListener('click', () => {
    showError('');
    analyzing = false;
    fileNext.disabled = !filePath;
    showStep('file');
    vscode.postMessage({ type: 'back', to: 'file' });
  });
  document.getElementById('previewCancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });
  document.getElementById('previewImport').addEventListener('click', () => {
    showError('');
    showStep('progress');
    progressMessage.textContent = 'Starting import…';
    progressPhase.textContent = '';
    vscode.postMessage({
      type: 'startImport',
      outputDirectoryName: outputDirectory.value.trim(),
    });
  });

  document.getElementById('progressCancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelImport' });
  });

  document.getElementById('summaryClose').addEventListener('click', () => {
    vscode.postMessage({ type: 'close' });
  });
  manageAuth.addEventListener('click', () => {
    vscode.postMessage({ type: 'manageAuthProfiles' });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'init' && message.state) {
      applyInit(message.state);
      return;
    }
    if (message.type === 'fileSelected') {
      filePath = message.path || '';
      fileName = message.name || '';
      fileLabel.textContent = filePath || 'No file selected';
      fileLabel.classList.toggle('muted', !filePath);
      fileNext.disabled = !filePath;
      showError('');
      return;
    }
    if (message.type === 'preview' && message.preview) {
      analyzing = false;
      const p = message.preview;
      fillCounts(previewCounts, [
        ['API', (p.apiName || 'OpenAPI') + (p.apiVersion ? ' ' + p.apiVersion : '')],
        ['OpenAPI', p.openapiVersion || 'unknown'],
        ['Folders', p.folderCount],
        ['Requests', p.requestCount],
        ['Environments', p.environmentCount],
        ['Variables', p.variableCount],
        ['Auth profiles', p.authProfileCount],
      ]);
      fillList(previewWarnings, p.warnings || []);
      if (p.outputDirectoryName) {
        outputDirectory.value = p.outputDirectoryName;
      }
      document.getElementById('previewImport').disabled = false;
      showStep('preview');
      return;
    }
    if (message.type === 'previewError') {
      analyzing = false;
      fileNext.disabled = !filePath;
      showError(message.message || 'Could not analyze specification.');
      showStep('file');
      return;
    }
    if (message.type === 'progress') {
      progressMessage.textContent = message.message || 'Working…';
      progressPhase.textContent = message.phase ? 'Phase: ' + message.phase : '';
      return;
    }
    if (message.type === 'summary' && message.summary) {
      const s = message.summary;
      if (s.cancelled) {
        summaryTitle.textContent = 'Import cancelled';
      } else if (s.success) {
        summaryTitle.textContent = 'Import complete';
      } else {
        summaryTitle.textContent = 'Import finished with errors';
      }
      fillCounts(summaryCounts, [
        ['API', (s.apiName || 'OpenAPI') + (s.apiVersion ? ' ' + s.apiVersion : '')],
        ['OpenAPI', s.openapiVersion || 'unknown'],
        ['Folders', s.folderCount],
        ['Requests', s.requestCount],
        ['Environments', s.environmentCount],
        ['Variables', s.variableCount],
        ['Auth profiles', s.authProfileCount],
        ['Files written', s.writtenFileCount],
        ['Output', s.targetDirectory || '—'],
        ['Warnings', s.warningCount],
        ['Errors', s.errorCount],
      ]);
      const diags = [...(s.errors || []), ...(s.warnings || [])];
      fillList(summaryDiagnostics, diags);
      const hints = s.secretHints || [];
      if (hints.length > 0) {
        secretBlock.hidden = false;
        fillList(secretHints, hints);
        manageAuth.hidden = s.manageAuthAvailable !== true;
      } else {
        secretBlock.hidden = true;
        manageAuth.hidden = true;
      }
      showStep('summary');
      return;
    }
    if (message.type === 'error' && typeof message.message === 'string') {
      showError(message.message);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
