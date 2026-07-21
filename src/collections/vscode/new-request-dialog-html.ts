/**
 * Pure HTML/CSS/JS for the New Request dialog webview (no vscode import).
 */

import type { RequestSourceDocument } from '../../request-source';
import { HTTP_METHODS, type HttpMethod } from '../../types';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
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
    <p class="subtitle">Create a new <code>.api</code> request in a collection.</p>
  </header>
  <form id="form" novalidate>
    <label class="field">
      <span>Request name</span>
      <input id="name" type="text" autocomplete="off" required placeholder="New Request" />
    </label>
    <div class="row">
      <label class="field method">
        <span>Method</span>
        <select id="method">${methodOptions}</select>
      </label>
      <label class="field grow">
        <span>URL</span>
        <input id="url" type="text" autocomplete="off" required placeholder="https://httpbin.org/get" />
      </label>
    </div>
    <label class="field">
      <span>Description <em>(optional)</em></span>
      <textarea id="description" rows="2" placeholder="Short description"></textarea>
    </label>
    <label class="field">
      <span>Collection</span>
      <select id="collection" required></select>
    </label>
    <label class="field">
      <span>Folder</span>
      <select id="folder"></select>
    </label>
    <p id="error" class="error" hidden></p>
    <footer>
      <button type="button" id="cancel" class="secondary">Cancel</button>
      <button type="submit" id="create" class="primary">Create</button>
    </footer>
  </form>
</main>
<script nonce="${safeNonce}">${DIALOG_SCRIPT}</script>
</body>
</html>`;
}

const DIALOG_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
main { max-width: 560px; margin: 0 auto; padding: 20px 22px 24px; }
header { margin-bottom: 18px; }
h1 { margin: 0 0 6px; font-size: 1.25rem; font-weight: 600; }
.subtitle { margin: 0; color: var(--vscode-descriptionForeground); }
.subtitle code {
  font-family: var(--vscode-editor-font-family);
  font-size: .92em;
}
form { display: grid; gap: 14px; }
.row { display: flex; gap: 12px; align-items: end; }
.field { display: grid; gap: 6px; }
.field.grow { flex: 1; min-width: 0; }
.field.method { width: 118px; flex: 0 0 118px; }
.field span { color: var(--vscode-descriptionForeground); font-size: .9em; }
.field em { font-style: normal; opacity: .8; }
input, select, textarea {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px;
  padding: 7px 9px;
  font: inherit;
}
textarea { resize: vertical; min-height: 56px; }
input:focus, select:focus, textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.error {
  margin: 0;
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: .92em;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding-top: 8px;
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
@media (max-width: 480px) {
  .row { flex-direction: column; align-items: stretch; }
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
    fillCollections();
    fillFolders();
    showError('');
    nameInput.focus();
    nameInput.select();
  }

  collectionSelect.addEventListener('change', () => {
    fillFolders();
  });

  cancelBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
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
