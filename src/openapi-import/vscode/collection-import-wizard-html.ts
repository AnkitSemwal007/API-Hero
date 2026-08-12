/**
 * Parameterized HTML/CSS/JS for file-only collection import wizards
 * (Postman / Insomnia). No vscode import.
 */

import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export { escapeAttribute };

export const COLLECTION_IMPORT_WIZARD_STEPS = [
  'workspace',
  'file',
  'preview',
  'progress',
  'summary',
] as const;

export type CollectionImportWizardStep =
  (typeof COLLECTION_IMPORT_WIZARD_STEPS)[number];

export interface CollectionImportWizardFolder {
  readonly name: string;
  readonly path: string;
}

export interface CollectionImportWizardPreview {
  readonly apiName: string;
  readonly apiVersion: string;
  readonly formatVersion: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly environmentCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly scriptWarningCount: number;
  readonly unsupportedFeatureCount: number;
  readonly outputDirectoryName: string;
  readonly warningCount: number;
  readonly warnings: readonly string[];
}

export interface CollectionImportWizardSummaryView {
  readonly success: boolean;
  readonly cancelled: boolean;
  readonly apiName: string;
  readonly apiVersion: string;
  readonly formatVersion: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly environmentCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly scriptWarningCount: number;
  readonly unsupportedFeatureCount: number;
  readonly targetDirectory: string;
  readonly writtenFileCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly secretHints: readonly string[];
  readonly manageAuthAvailable: boolean;
}

export interface CollectionImportWizardState {
  readonly folders: readonly CollectionImportWizardFolder[];
  readonly skipWorkspaceStep: boolean;
  readonly selectedFolderPath?: string;
  readonly manageAuthAvailable: boolean;
  readonly step: CollectionImportWizardStep;
}

export type CollectionImportWizardInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'cancel' }
  | { readonly type: 'close' }
  | { readonly type: 'selectWorkspace'; readonly path: string }
  | { readonly type: 'pickFile' }
  | { readonly type: 'analyze'; readonly outputDirectoryName: string }
  | { readonly type: 'startImport'; readonly outputDirectoryName: string }
  | { readonly type: 'cancelImport' }
  | { readonly type: 'manageAuthProfiles' }
  | { readonly type: 'back'; readonly to: CollectionImportWizardStep };

export interface CollectionImportWizardCopy {
  readonly documentTitle: string;
  readonly heading: string;
  readonly subtitle: string;
  readonly fileStepTitle: string;
  readonly fileStepHint: string;
  readonly pickFileLabel: string;
  readonly defaultCollectionLabel: string;
  readonly defaultFormatLabel: string;
  readonly analyzeErrorFallback: string;
}

const STEP_SET = new Set<string>(COLLECTION_IMPORT_WIZARD_STEPS);

/** Validates webview → extension messages for collection wizards. */
export function parseCollectionImportWizardMessage(
  value: unknown,
): CollectionImportWizardInboundMessage | undefined {
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
  if (
    type === 'back' &&
    typeof record.to === 'string' &&
    STEP_SET.has(record.to)
  ) {
    return {
      type: 'back',
      to: record.to as CollectionImportWizardStep,
    };
  }
  return undefined;
}

/** Builds a file-only collection import wizard document. */
export function renderCollectionImportWizardHtml(
  nonce: string,
  copy: CollectionImportWizardCopy,
): string {
  const safeNonce = escapeAttribute(nonce);
  const title = escapeAttribute(copy.documentTitle);
  const heading = escapeAttribute(copy.heading);
  const subtitle = escapeAttribute(copy.subtitle);
  const fileStepTitle = escapeAttribute(copy.fileStepTitle);
  const pickFileLabel = escapeAttribute(copy.pickFileLabel);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>${title}</title>
<style nonce="${safeNonce}">${WIZARD_CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>${heading}</h1>
    <p class="subtitle">${subtitle}</p>
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
    <h2>${fileStepTitle}</h2>
    <p class="hint">${escapeAttribute(copy.fileStepHint)}</p>
    <p id="fileLabel" class="file-label muted">No file selected</p>
    <footer class="actions">
      <button type="button" id="fileBack" class="secondary">Back</button>
      <button type="button" id="fileCancel" class="secondary">Cancel</button>
      <button type="button" id="pickFile" class="secondary">${pickFileLabel}</button>
      <button type="button" id="fileNext" class="primary" disabled>Next</button>
    </footer>
  </section>

  <section id="step-preview" class="panel" hidden>
    <h2>Preview</h2>
    <p class="hint">Review what will be created. Cancel now to avoid writing files.</p>
    <dl id="previewCounts" class="counts"></dl>
    <ul id="previewWarnings" class="warnings" hidden></ul>
    <label class="field">
      <span>Output directory</span>
      <input id="outputDirectory" type="text" spellcheck="false" />
    </label>
    <footer class="actions">
      <button type="button" id="previewBack" class="secondary">Back</button>
      <button type="button" id="previewCancel" class="secondary">Cancel</button>
      <button type="button" id="previewImport" class="primary" disabled>Import</button>
    </footer>
  </section>

  <section id="step-progress" class="panel" hidden>
    <h2>Importing</h2>
    <p id="progressPhase" class="phase"></p>
    <p id="progressMessage" class="hint"></p>
    <footer class="actions">
      <button type="button" id="progressCancel" class="secondary">Cancel</button>
    </footer>
  </section>

  <section id="step-summary" class="panel" hidden>
    <h2 id="summaryTitle">Done</h2>
    <dl id="summaryCounts" class="counts"></dl>
    <ul id="summaryDiagnostics" class="warnings" hidden></ul>
    <div id="secretBlock" hidden>
      <h3>Secret hints</h3>
      <ul id="secretHints" class="warnings"></ul>
      <button type="button" id="manageAuth" class="secondary">Manage Authentication</button>
    </div>
    <footer class="actions">
      <button type="button" id="summaryClose" class="primary">Close</button>
    </footer>
  </section>
</main>
<script nonce="${safeNonce}">
${buildWizardScript(copy)}
</script>
</body>
</html>`;
}

const WIZARD_CSS = `
${WEBVIEW_SHARED_CSS}
body { margin: 0; padding: 16px 20px 24px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
main { max-width: 640px; margin: 0 auto; }
header h1 { margin: 0 0 4px; font-size: 1.35rem; }
.subtitle, .hint { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
.steps { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.step { font-size: 0.75rem; opacity: 0.55; }
.step.active { opacity: 1; font-weight: 600; }
.step.done { opacity: 0.8; }
.panel { border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; padding: 14px 16px; }
.field { display: flex; flex-direction: column; gap: 4px; margin: 12px 0; }
.field input, .field select {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  padding: 6px 8px;
}
.actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px; }
button {
  border: 1px solid var(--vscode-button-border, transparent);
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 2px;
}
button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button:disabled { opacity: 0.5; cursor: default; }
.error { color: var(--vscode-errorForeground); margin: 0 0 12px; }
.file-label { font-family: var(--vscode-editor-font-family); word-break: break-all; }
.file-label.muted { opacity: 0.65; }
.counts { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0 0 12px; }
.counts dt { opacity: 0.75; }
.counts dd { margin: 0; font-weight: 600; }
.warnings { margin: 0 0 12px; padding-left: 18px; color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.phase { font-weight: 600; margin: 0 0 4px; }
`;

function buildWizardScript(copy: CollectionImportWizardCopy): string {
  const defaultCollection = JSON.stringify(copy.defaultCollectionLabel);
  const defaultFormat = JSON.stringify(copy.defaultFormatLabel);
  const analyzeFallback = JSON.stringify(copy.analyzeErrorFallback);
  return `
'use strict';
const vscode = acquireVsCodeApi();
const STEP_ORDER = ${JSON.stringify([...COLLECTION_IMPORT_WIZARD_STEPS])};
const STEP_LABELS = {
  workspace: 'Workspace',
  file: 'File',
  preview: 'Preview',
  progress: 'Progress',
  summary: 'Summary',
};
const DEFAULT_COLLECTION = ${defaultCollection};
const DEFAULT_FORMAT = ${defaultFormat};
const ANALYZE_FALLBACK = ${analyzeFallback};

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

function updateFileNext() {
  fileNext.disabled = analyzing || !filePath;
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
  const skipWorkspace = state && state.skipWorkspaceStep === true;
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
    state = Object.assign({}, state, { step: step });
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
  for (const folder of (state && state.folders) || []) {
    const option = document.createElement('option');
    option.value = folder.path;
    option.textContent = folder.name + ' — ' + folder.path;
    workspaceSelect.appendChild(option);
  }
  if (state && state.selectedFolderPath) {
    workspaceSelect.value = state.selectedFolderPath;
  }
}

function applyInit(next) {
  state = next;
  fillWorkspaces();
  manageAuth.hidden = !(state && state.manageAuthAvailable);
  const start =
    state && state.skipWorkspaceStep ? 'file' : 'workspace';
  showStep(start);
}

function beginAnalyze() {
  if (!filePath || analyzing) {
    return;
  }
  analyzing = true;
  updateFileNext();
  showError('');
  fileNext.textContent = 'Analyzing…';
  vscode.postMessage({
    type: 'analyze',
    outputDirectoryName: (outputDirectory.value || '').trim(),
  });
}

document.getElementById('workspaceNext').addEventListener('click', () => {
  vscode.postMessage({ type: 'selectWorkspace', path: workspaceSelect.value });
  showStep('file');
});
document.getElementById('workspaceCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});
document.getElementById('fileBack').addEventListener('click', () => {
  if (state && state.skipWorkspaceStep) {
    vscode.postMessage({ type: 'cancel' });
    return;
  }
  showStep('workspace');
});
document.getElementById('fileCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});
document.getElementById('pickFile').addEventListener('click', () => {
  vscode.postMessage({ type: 'pickFile' });
});
document.getElementById('fileNext').addEventListener('click', () => {
  beginAnalyze();
});
document.getElementById('previewBack').addEventListener('click', () => {
  showStep('file');
});
document.getElementById('previewCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});
document.getElementById('previewImport').addEventListener('click', () => {
  showStep('progress');
  vscode.postMessage({
    type: 'startImport',
    outputDirectoryName: (outputDirectory.value || '').trim(),
  });
});
document.getElementById('progressCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelImport' });
});
document.getElementById('summaryClose').addEventListener('click', () => {
  vscode.postMessage({ type: 'close' });
});
document.getElementById('manageAuth').addEventListener('click', () => {
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
    updateFileNext();
    showError('');
    return;
  }
  if (message.type === 'preview' && message.preview) {
    analyzing = false;
    fileNext.textContent = 'Next';
    updateFileNext();
    const p = message.preview;
    fillCounts(previewCounts, [
      ['Collection', (p.apiName || DEFAULT_COLLECTION) + (p.apiVersion ? ' ' + p.apiVersion : '')],
      ['Format', p.formatVersion || DEFAULT_FORMAT],
      ['Folders', p.folderCount],
      ['Requests', p.requestCount],
      ['Environments', p.environmentCount],
      ['Variables', p.variableCount],
      ['Auth profiles', p.authProfileCount],
      ['Unsupported scripts', p.scriptWarningCount],
      ['Unsupported features', p.unsupportedFeatureCount],
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
    fileNext.textContent = 'Next';
    updateFileNext();
    showError(message.message || ANALYZE_FALLBACK);
    return;
  }
  if (message.type === 'progress') {
    progressPhase.textContent = message.phase || '';
    progressMessage.textContent = message.message || '';
    return;
  }
  if (message.type === 'summary' && message.summary) {
    const s = message.summary;
    summaryTitle.textContent = s.cancelled
      ? 'Cancelled'
      : s.success
        ? 'Import complete'
        : 'Import failed';
    fillCounts(summaryCounts, [
      ['Collection', s.apiName || ''],
      ['Folders', s.folderCount],
      ['Requests', s.requestCount],
      ['Variables', s.variableCount],
      ['Auth profiles', s.authProfileCount],
      ['Scripts skipped', s.scriptWarningCount],
      ['Unsupported features', s.unsupportedFeatureCount],
      ['Files written', s.writtenFileCount],
      ['Target', s.targetDirectory || ''],
    ]);
    const diags = [].concat(s.errors || [], s.warnings || []);
    fillList(summaryDiagnostics, diags);
    const hints = s.secretHints || [];
    if (hints.length > 0 && s.manageAuthAvailable) {
      secretBlock.hidden = false;
      fillList(secretHints, hints);
    } else {
      secretBlock.hidden = true;
    }
    showStep('summary');
    return;
  }
  if (message.type === 'error') {
    // Stay on the current step (mirror OpenAPI) so allowlist / import
    // failures do not strand the user on an empty preview.
    showError(message.message || 'Import failed.');
  }
});

vscode.postMessage({ type: 'ready' });
`;
}
