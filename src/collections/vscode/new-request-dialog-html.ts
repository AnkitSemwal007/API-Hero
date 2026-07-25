/**
 * Pure HTML/CSS/JS for the New Request dialog webview (no vscode import).
 */

import type { RequestSourceDocument } from '../../request-source';
import { HTTP_METHODS, type HttpMethod } from '../../types';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export { escapeAttribute };

export interface NewRequestDialogDestination {
  readonly collectionId: string;
  readonly collectionLabel: string;
  readonly folderRelativePath: string;
  readonly folderLabel: string;
}

export interface NewRequestDialogState {
  readonly destinations: readonly NewRequestDialogDestination[];
  readonly preselectedCollectionId?: string;
  readonly preselectedFolderRelativePath?: string;
  readonly defaultName?: string;
  readonly defaultMethod?: string;
  readonly defaultUrl?: string;
}

export type NewRequestDialogInboundMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'create';
      readonly name: string;
      readonly method: string;
      readonly url: string;
      readonly description: string;
      readonly collectionId: string;
      readonly folderRelativePath: string;
    }
  | { readonly type: 'cancel' };

export type NewRequestDialogOutboundMessage =
  | { readonly type: 'init'; readonly state: NewRequestDialogState }
  | { readonly type: 'error'; readonly message: string };

/** Validates webview → extension messages. */
export function parseNewRequestDialogMessage(
  value: unknown,
): NewRequestDialogInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  if (record.type === 'ready' || record.type === 'cancel') {
    return { type: record.type };
  }
  if (record.type !== 'create') {
    return undefined;
  }
  if (
    typeof record.name !== 'string' ||
    typeof record.method !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.collectionId !== 'string' ||
    typeof record.folderRelativePath !== 'string'
  ) {
    return undefined;
  }
  return {
    type: 'create',
    name: record.name,
    method: record.method,
    url: record.url,
    description: record.description,
    collectionId: record.collectionId,
    folderRelativePath: record.folderRelativePath,
  };
}

/**
 * Validates create payload fields and allowlists destination against the
 * destinations list that was presented in the dialog.
 */
export function validateCreateMessage(
  message: {
    readonly name: string;
    readonly method: string;
    readonly url: string;
    readonly description: string;
    readonly collectionId: string;
    readonly folderRelativePath: string;
  },
  destinations: readonly NewRequestDialogDestination[],
): { readonly model?: RequestSourceDocument; readonly error?: string } {
  const name = message.name.trim();
  if (name.length === 0) {
    return { error: 'Request name is required.' };
  }
  const url = message.url.trim();
  if (url.length === 0) {
    return { error: 'URL is required.' };
  }
  const methodUpper = message.method.trim().toUpperCase();
  if (!HTTP_METHODS.includes(methodUpper as HttpMethod)) {
    return { error: `Unsupported HTTP method "${message.method}".` };
  }
  if (message.collectionId.trim().length === 0) {
    return { error: 'Select a collection.' };
  }

  const folderRelativePath = message.folderRelativePath;
  const allowed = destinations.some(
    (destination) =>
      destination.collectionId === message.collectionId &&
      destination.folderRelativePath === folderRelativePath,
  );
  if (!allowed) {
    return { error: 'Select a valid collection folder.' };
  }

  const description = message.description.trim();
  const model: RequestSourceDocument = {
    name,
    method: methodUpper as HttpMethod,
    url,
    ...(description.length > 0 ? { description } : {}),
  };
  return { model };
}

/** Builds the New Request dialog document. */
export function renderNewRequestDialogHtml(nonce: string): string {
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
<title>New Request</title>
<style nonce="${safeNonce}">${DIALOG_CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>New Request</h1>
    <p class="subtitle muted">Add a request to a collection.</p>
  </header>
  <form id="form" novalidate>
    <label class="field name-field">
      <span>Name</span>
      <input id="name" type="text" autocomplete="off" required placeholder="Get users" />
    </label>
    <div class="row request-line" role="group" aria-label="Method and URL">
      <label class="field method">
        <span>Method</span>
        <select id="method" class="method-select method-get">${methodOptions}</select>
      </label>
      <label class="field grow">
        <span>URL</span>
        <input id="url" type="text" autocomplete="off" required placeholder="https://api.example.com/users" />
      </label>
    </div>
    <fieldset class="destination">
      <legend>Save to</legend>
      <div class="row destination-row">
        <label class="field grow">
          <span>Collection</span>
          <select id="collection" required></select>
        </label>
        <label class="field grow">
          <span>Folder</span>
          <select id="folder"></select>
        </label>
      </div>
    </fieldset>
    <details class="optional">
      <summary>Description <span class="optional-hint">optional</span></summary>
      <label class="field">
        <span class="sr-only">Description</span>
        <textarea id="description" rows="2" placeholder="Short note about this request"></textarea>
      </label>
    </details>
    <p id="error" class="error" hidden></p>
    <footer>
      <button type="button" id="cancel">Cancel</button>
      <button type="submit" id="create" class="primary">Create Request</button>
    </footer>
  </form>
</main>
<script nonce="${safeNonce}">${DIALOG_SCRIPT}</script>
</body>
</html>`;
}

const DIALOG_CSS = `
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
}
main { max-width: 520px; margin: 0 auto; padding: var(--ah-space-5) var(--ah-space-4) var(--ah-space-4); }
header { margin-bottom: var(--ah-space-4); }
h1 { margin: 0 0 var(--ah-space-1); font-size: 1.15rem; font-weight: 600; }
.subtitle { margin: 0; color: var(--vscode-descriptionForeground); font-size: .92em; }
form { display: grid; gap: var(--ah-space-3); }
.row { display: flex; gap: var(--ah-space-2); align-items: end; }
.field { display: grid; gap: var(--ah-space-1); }
.field.grow { flex: 1; min-width: 0; }
.field.method { width: 108px; flex: 0 0 108px; }
.field span { color: var(--vscode-descriptionForeground); font-size: .85em; }
.name-field input { font-size: 1.05em; font-weight: 500; }
input, select, textarea {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  padding: 6px 8px;
  font: inherit;
}
textarea { resize: vertical; min-height: 48px; }
input:focus, select:focus, textarea:focus, summary:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.destination {
  margin: 0;
  padding: var(--ah-space-3);
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--ah-radius);
  background: var(--vscode-sideBar-background);
}
.destination legend {
  padding: 0 var(--ah-space-1);
  color: var(--vscode-descriptionForeground);
  font-size: .75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.destination-row { gap: var(--ah-space-3); }
.optional {
  border: none;
  padding: 0;
  margin: 0;
}
.optional summary {
  cursor: pointer;
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
  user-select: none;
  list-style: none;
}
.optional summary::-webkit-details-marker { display: none; }
.optional summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 6px;
  transition: transform .1s ease;
}
.optional[open] summary::before { transform: rotate(90deg); }
.optional-hint {
  opacity: .75;
  font-size: .9em;
}
.optional .field { margin-top: var(--ah-space-2); }
.error {
  margin: 0;
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: .92em;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--ah-space-2);
  margin-top: var(--ah-space-1);
  padding-top: var(--ah-space-3);
  border-top: 1px solid var(--vscode-panel-border);
}
footer button { min-width: 4.5rem; }
footer button.primary { min-width: 8rem; }
@media (max-width: 480px) {
  .row, .destination-row { flex-direction: column; align-items: stretch; }
  .field.method { width: 100%; flex: 1; }
}
`;

const DIALOG_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  /** @type {{ destinations: Array<{ collectionId: string, collectionLabel: string, folderRelativePath: string, folderLabel: string }>, preselectedCollectionId?: string, preselectedFolderRelativePath?: string, defaultName?: string, defaultMethod?: string, defaultUrl?: string } | undefined} */
  let state;

  const form = document.getElementById('form');
  const nameInput = document.getElementById('name');
  const methodSelect = document.getElementById('method');
  const urlInput = document.getElementById('url');
  const descriptionInput = document.getElementById('description');
  const collectionSelect = document.getElementById('collection');
  const folderSelect = document.getElementById('folder');
  const errorEl = document.getElementById('error');
  const createBtn = document.getElementById('create');
  const cancelBtn = document.getElementById('cancel');

  function syncMethodSelect() {
    const map = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head', OPTIONS: 'options' };
    const key = map[String(methodSelect.value || '').trim().toUpperCase()] || 'other';
    methodSelect.className = 'method-select method-' + key;
  }

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function destinationsForCollection(collectionId) {
    return (state?.destinations ?? []).filter((d) => d.collectionId === collectionId);
  }

  function uniqueCollections() {
    const map = new Map();
    for (const dest of state?.destinations ?? []) {
      if (!map.has(dest.collectionId)) {
        map.set(dest.collectionId, dest.collectionLabel);
      }
    }
    return [...map.entries()].map(([collectionId, collectionLabel]) => ({
      collectionId,
      collectionLabel,
    }));
  }

  function fillCollections() {
    const collections = uniqueCollections();
    collectionSelect.innerHTML = '';
    for (const collection of collections) {
      const option = document.createElement('option');
      option.value = collection.collectionId;
      option.textContent = collection.collectionLabel;
      collectionSelect.appendChild(option);
    }
    const preferred =
      state?.preselectedCollectionId &&
      collections.some((c) => c.collectionId === state.preselectedCollectionId)
        ? state.preselectedCollectionId
        : collections[0]?.collectionId;
    if (preferred) {
      collectionSelect.value = preferred;
    }
  }

  function fillFolders() {
    const collectionId = collectionSelect.value;
    const folders = destinationsForCollection(collectionId);
    folderSelect.innerHTML = '';
    for (const folder of folders) {
      const option = document.createElement('option');
      option.value = folder.folderRelativePath;
      option.textContent = folder.folderLabel;
      folderSelect.appendChild(option);
    }
    const preferred = state?.preselectedFolderRelativePath;
    if (
      preferred !== undefined &&
      folders.some((f) => f.folderRelativePath === preferred)
    ) {
      folderSelect.value = preferred;
    } else if (folders[0]) {
      folderSelect.value = folders[0].folderRelativePath;
    }
  }

  function applyInit(next) {
    state = next;
    nameInput.value = next.defaultName ?? 'New Request';
    urlInput.value = next.defaultUrl ?? 'https://httpbin.org/get';
    if (next.defaultMethod) {
      methodSelect.value = next.defaultMethod;
    }
    syncMethodSelect();
    fillCollections();
    fillFolders();
    showError('');
    nameInput.focus();
    nameInput.select();
  }

  methodSelect.addEventListener('change', syncMethodSelect);
  collectionSelect.addEventListener('change', () => {
    fillFolders();
  });

  cancelBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      vscode.postMessage({ type: 'cancel' });
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('');
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const collectionId = collectionSelect.value;
    if (!name) {
      showError('Request name is required.');
      nameInput.focus();
      return;
    }
    if (!url) {
      showError('URL is required.');
      urlInput.focus();
      return;
    }
    if (!collectionId) {
      showError('Select a collection.');
      return;
    }
    createBtn.disabled = true;
    vscode.postMessage({
      type: 'create',
      name,
      method: methodSelect.value,
      url,
      description: descriptionInput.value.trim(),
      collectionId,
      folderRelativePath: folderSelect.value ?? '',
    });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'init' && message.state) {
      applyInit(message.state);
      createBtn.disabled = false;
      return;
    }
    if (message.type === 'error' && typeof message.message === 'string') {
      showError(message.message);
      createBtn.disabled = false;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
