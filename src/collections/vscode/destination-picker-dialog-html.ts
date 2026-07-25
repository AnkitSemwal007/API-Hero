/**
 * Pure HTML/CSS/JS for picking a native collection folder destination
 * (no vscode import). Reuses the New Request destination shape.
 */

import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';
import type { NewRequestDialogDestination } from './new-request-dialog-html';

export type DestinationPickerDestination = NewRequestDialogDestination;

export interface DestinationPickerDialogConfig {
  readonly title: string;
  readonly subtitle?: string;
  readonly destinations: readonly DestinationPickerDestination[];
  readonly preselectedCollectionId?: string;
  readonly preselectedFolderRelativePath?: string;
  readonly submitLabel: string;
}

export type DestinationPickerInboundMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'submit';
      readonly collectionId: string;
      readonly folderRelativePath: string;
    }
  | { readonly type: 'cancel' };

export type DestinationPickerOutboundMessage =
  | { readonly type: 'init'; readonly config: DestinationPickerDialogConfig }
  | { readonly type: 'error'; readonly message: string };

/** Validates webview → extension messages. */
export function parseDestinationPickerMessage(
  value: unknown,
): DestinationPickerInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  if (record.type === 'ready' || record.type === 'cancel') {
    return { type: record.type };
  }
  if (record.type !== 'submit') {
    return undefined;
  }
  if (
    typeof record.collectionId !== 'string' ||
    typeof record.folderRelativePath !== 'string'
  ) {
    return undefined;
  }
  return {
    type: 'submit',
    collectionId: record.collectionId,
    folderRelativePath: record.folderRelativePath,
  };
}

/**
 * Allowlists the submitted destination against options shown in the dialog.
 */
export function validateDestinationPickerSelection(
  message: {
    readonly collectionId: string;
    readonly folderRelativePath: string;
  },
  destinations: readonly DestinationPickerDestination[],
): {
  readonly collectionId?: string;
  readonly folderRelativePath?: string;
  readonly error?: string;
} {
  if (message.collectionId.trim().length === 0) {
    return { error: 'Select a collection.' };
  }
  const allowed = destinations.some(
    (destination) =>
      destination.collectionId === message.collectionId &&
      destination.folderRelativePath === message.folderRelativePath,
  );
  if (!allowed) {
    return { error: 'Select a valid collection folder.' };
  }
  return {
    collectionId: message.collectionId,
    folderRelativePath: message.folderRelativePath,
  };
}

/** Builds the destination-picker document. */
export function renderDestinationPickerDialogHtml(
  nonce: string,
  config: DestinationPickerDialogConfig,
): string {
  const safeNonce = escapeAttribute(nonce);
  const title = escapeHtml(config.title);
  const subtitle =
    config.subtitle !== undefined && config.subtitle.length > 0
      ? `<p class="subtitle muted">${escapeHtml(config.subtitle)}</p>`
      : '';
  const submitLabel = escapeHtml(config.submitLabel);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>${title}</title>
<style nonce="${safeNonce}">${DIALOG_CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>${title}</h1>
    ${subtitle}
  </header>
  <form id="form" novalidate>
    <fieldset class="destination">
      <legend>Destination</legend>
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
    <p id="error" class="error" hidden></p>
    <footer>
      <button type="button" id="cancel">Cancel</button>
      <button type="submit" id="submit" class="primary">${submitLabel}</button>
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
main { max-width: 480px; margin: 0 auto; padding: var(--ah-space-5) var(--ah-space-4) var(--ah-space-4); }
header { margin-bottom: var(--ah-space-4); }
h1 { margin: 0 0 var(--ah-space-1); font-size: 1.15rem; font-weight: 600; }
.subtitle { margin: 0; color: var(--vscode-descriptionForeground); font-size: .92em; }
form { display: grid; gap: var(--ah-space-3); }
.row { display: flex; gap: var(--ah-space-2); align-items: end; }
.field { display: grid; gap: var(--ah-space-1); }
.field.grow { flex: 1; min-width: 0; }
.field span { color: var(--vscode-descriptionForeground); font-size: .85em; }
select {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  padding: 6px 8px;
  font: inherit;
}
select:focus {
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
footer button.primary { min-width: 6rem; }
@media (max-width: 480px) {
  .row, .destination-row { flex-direction: column; align-items: stretch; }
}
`;

const DIALOG_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  /** @type {{ destinations: Array<{ collectionId: string, collectionLabel: string, folderRelativePath: string, folderLabel: string }>, preselectedCollectionId?: string, preselectedFolderRelativePath?: string } | undefined} */
  let state;

  const form = document.getElementById('form');
  const collectionSelect = document.getElementById('collection');
  const folderSelect = document.getElementById('folder');
  const errorEl = document.getElementById('error');
  const submitBtn = document.getElementById('submit');
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

  function applyInit(config) {
    state = config;
    fillCollections();
    fillFolders();
    showError('');
    submitBtn.disabled = false;
    collectionSelect.focus();
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
    const collectionId = collectionSelect.value;
    if (!collectionId) {
      showError('Select a collection.');
      return;
    }
    submitBtn.disabled = true;
    vscode.postMessage({
      type: 'submit',
      collectionId,
      folderRelativePath: folderSelect.value ?? '',
    });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      vscode.postMessage({ type: 'cancel' });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'init' && message.config) {
      applyInit(message.config);
      return;
    }
    if (message.type === 'error' && typeof message.message === 'string') {
      showError(message.message);
      submitBtn.disabled = false;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
