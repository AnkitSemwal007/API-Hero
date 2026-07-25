/**
 * Pure HTML/CSS/JS for a Create/Edit CRUD name prompt (no vscode import).
 * Name-only mode remains the default; optional Description when configured.
 */

import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export interface CrudPromptDialogConfig {
  readonly title: string;
  readonly subtitle?: string;
  readonly fieldLabel: string;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly submitLabel: string;
  /** When set, shows an optional Description textarea. */
  readonly descriptionFieldLabel?: string;
  readonly descriptionPlaceholder?: string;
  readonly initialDescription?: string;
}

export type CrudPromptInboundMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'submit';
      readonly value: string;
      readonly description?: string;
    }
  | { readonly type: 'cancel' };

export type CrudPromptOutboundMessage =
  | { readonly type: 'init'; readonly config: CrudPromptDialogConfig }
  | { readonly type: 'error'; readonly message: string };

/** Validates webview → extension messages. */
export function parseCrudPromptMessage(
  value: unknown,
): CrudPromptInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  if (record.type === 'ready' || record.type === 'cancel') {
    return { type: record.type };
  }
  if (record.type !== 'submit' || typeof record.value !== 'string') {
    return undefined;
  }
  const description =
    typeof record.description === 'string' ? record.description : undefined;
  return {
    type: 'submit',
    value: record.value,
    ...(description !== undefined ? { description } : {}),
  };
}

/** Requires a non-empty trimmed name. */
export function validateCrudPromptValue(
  value: string,
): { readonly value?: string; readonly error?: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { error: 'Name is required.' };
  }
  return { value: trimmed };
}

/** Trims optional description; empty → undefined. */
export function normalizeCrudPromptDescription(
  description: string | undefined,
): string | undefined {
  if (description === undefined) {
    return undefined;
  }
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Builds the CRUD name-prompt document. */
export function renderCrudPromptDialogHtml(
  nonce: string,
  config: CrudPromptDialogConfig,
): string {
  const safeNonce = escapeAttribute(nonce);
  const title = escapeHtml(config.title);
  const subtitle =
    config.subtitle !== undefined && config.subtitle.length > 0
      ? `<p class="subtitle muted">${escapeHtml(config.subtitle)}</p>`
      : '';
  const fieldLabel = escapeHtml(config.fieldLabel);
  const placeholder = escapeAttribute(config.placeholder ?? '');
  const initialValue = escapeAttribute(config.initialValue ?? '');
  const submitLabel = escapeHtml(config.submitLabel);
  const hasDescription = config.descriptionFieldLabel !== undefined;
  const descriptionField =
    hasDescription && config.descriptionFieldLabel !== undefined
      ? `<label class="field">
      <span>${escapeHtml(config.descriptionFieldLabel)}</span>
      <textarea id="description" rows="3" placeholder="${escapeAttribute(config.descriptionPlaceholder ?? '')}">${escapeHtml(config.initialDescription ?? '')}</textarea>
    </label>`
      : '';

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
    <label class="field">
      <span>${fieldLabel}</span>
      <input id="value" type="text" autocomplete="off" required placeholder="${placeholder}" value="${initialValue}" />
    </label>
    ${descriptionField}
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
main { max-width: 420px; margin: 0 auto; padding: var(--ah-space-5) var(--ah-space-4) var(--ah-space-4); }
header { margin-bottom: var(--ah-space-4); }
h1 { margin: 0 0 var(--ah-space-1); font-size: 1.15rem; font-weight: 600; }
.subtitle { margin: 0; color: var(--vscode-descriptionForeground); font-size: .92em; }
form { display: grid; gap: var(--ah-space-3); }
.field { display: grid; gap: var(--ah-space-1); }
.field span { color: var(--vscode-descriptionForeground); font-size: .85em; }
input, textarea {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  padding: 6px 8px;
  font: inherit;
  font-size: 1.05em;
  font-weight: 500;
}
textarea {
  resize: vertical;
  min-height: 4.5rem;
  line-height: 1.35;
  font-weight: 400;
}
input:focus, textarea:focus {
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
  gap: var(--ah-space-2);
  margin-top: var(--ah-space-1);
  padding-top: var(--ah-space-3);
  border-top: 1px solid var(--vscode-panel-border);
}
footer button { min-width: 4.5rem; }
footer button.primary { min-width: 6rem; }
`;

const DIALOG_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const form = document.getElementById('form');
  const valueInput = document.getElementById('value');
  const descriptionInput = document.getElementById('description');
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

  function focusValue() {
    valueInput.focus();
    valueInput.select();
  }

  cancelBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('');
    const value = valueInput.value.trim();
    if (!value) {
      showError('Name is required.');
      focusValue();
      return;
    }
    submitBtn.disabled = true;
    const message = { type: 'submit', value };
    if (descriptionInput) {
      message.description = descriptionInput.value;
    }
    vscode.postMessage(message);
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
      const config = message.config;
      if (typeof config.initialValue === 'string') {
        valueInput.value = config.initialValue;
      }
      if (descriptionInput && typeof config.initialDescription === 'string') {
        descriptionInput.value = config.initialDescription;
      }
      showError('');
      submitBtn.disabled = false;
      focusValue();
      return;
    }
    if (message.type === 'error' && typeof message.message === 'string') {
      showError(message.message);
      submitBtn.disabled = false;
      focusValue();
    }
  });

  focusValue();
  vscode.postMessage({ type: 'ready' });
})();
`;
