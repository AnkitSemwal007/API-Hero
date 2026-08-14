/**
 * Pure HTML/CSS/JS for Collection Authentication (no vscode import).
 * Secrets never appear in HTML, init payloads, or inbound messages.
 */

import { isValidAuthenticationProfileId } from '../authentication-profile-validation';
import {
  AUTHENTICATION_UI_CSS,
  AUTHENTICATION_UI_KINDS,
  buildAuthenticationUiState,
  renderAuthenticationUiControlsHtml,
  type AuthenticationUiKind,
  type AuthenticationUiProfileSummary,
  type AuthenticationUiState,
} from '../ui';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export interface CollectionAuthState {
  readonly collectionName: string;
  readonly collectionId: string;
  readonly defaultAuthenticationId?: string;
  readonly profiles: readonly AuthenticationUiProfileSummary[];
  readonly ui: AuthenticationUiState;
}

export type CollectionAuthInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'cancel' }
  | { readonly type: 'manageAuthentication' }
  | {
      readonly type: 'save';
      readonly profileId?: string;
    };

export type CollectionAuthOutboundMessage =
  | { readonly type: 'init'; readonly state: CollectionAuthState }
  | { readonly type: 'error'; readonly message: string };

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseCollectionAuthMessage(
  value: unknown,
): CollectionAuthInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  if (record.type === 'ready' || record.type === 'cancel' || record.type === 'manageAuthentication') {
    if (Object.keys(record).length !== 1) {
      return undefined;
    }
    return { type: record.type };
  }
  if (record.type !== 'save') {
    return undefined;
  }
  const keys = Object.keys(record);
  if (keys.length === 1) {
    return { type: 'save' };
  }
  if (
    keys.length === 2 &&
    typeof record.profileId === 'string' &&
    record.profileId.trim().length > 0
  ) {
    return { type: 'save', profileId: record.profileId.trim() };
  }
  return undefined;
}

export type CollectionAuthSaveProfileResolution =
  | { readonly ok: true; readonly profileId?: string }
  | { readonly ok: false; readonly message: string };

/**
 * Accepts None (omitted id) or a known, well-formed profile id.
 * Unknown / malformed ids must not be written to the collection marker.
 */
export function resolveCollectionAuthSaveProfileId(
  profileId: string | undefined,
  knownIds: ReadonlySet<string> | readonly string[],
): CollectionAuthSaveProfileResolution {
  if (profileId === undefined) {
    return { ok: true };
  }
  const id = profileId.trim();
  if (id.length === 0) {
    return { ok: true };
  }
  if (!isValidAuthenticationProfileId(id)) {
    return { ok: false, message: 'Invalid Authentication id.' };
  }
  const ids = knownIds instanceof Set ? knownIds : new Set(knownIds);
  if (!ids.has(id)) {
    return { ok: false, message: 'Unknown Authentication profile.' };
  }
  return { ok: true, profileId: id };
}

export function buildCollectionAuthState(input: {
  readonly collectionName: string;
  readonly collectionId: string;
  readonly defaultAuthenticationId?: string;
  readonly profiles: readonly AuthenticationUiProfileSummary[];
  readonly selectedKind?: AuthenticationUiKind;
  readonly selectedProfileId?: string;
}): CollectionAuthState {
  const ui = buildAuthenticationUiState({
    surface: 'collection',
    profiles: input.profiles,
    collectionDefaultId: input.selectedProfileId ?? input.defaultAuthenticationId,
    ...(input.selectedKind !== undefined ? { selectedKind: input.selectedKind } : {}),
    ...(input.selectedProfileId !== undefined
      ? { selectedProfileId: input.selectedProfileId }
      : {}),
  });
  return {
    collectionName: input.collectionName,
    collectionId: input.collectionId,
    ...(input.defaultAuthenticationId !== undefined &&
    input.defaultAuthenticationId.trim().length > 0
      ? { defaultAuthenticationId: input.defaultAuthenticationId.trim() }
      : {}),
    profiles: ui.profiles,
    ui,
  };
}

/** Builds the Collection Authentication document. */
export function renderCollectionAuthHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Collection Authentication</title>
<style nonce="${safeNonce}">${COLLECTION_AUTH_CSS}</style>
</head>
<body>
<main>
  <h1>Collection Authentication</h1>
  <p id="collectionLabel" class="subtitle muted"></p>
  <p id="error" class="error" hidden></p>
  ${renderAuthenticationUiControlsHtml('collection')}
  <footer>
    <button type="button" id="manageAuthentication" class="secondary">Manage Authentication</button>
    <span class="spacer"></span>
    <button type="button" id="cancel" class="ghost">Cancel</button>
    <button type="button" id="save" class="primary">Save</button>
  </footer>
</main>
<script nonce="${safeNonce}">${COLLECTION_AUTH_SCRIPT}</script>
</body>
</html>`;
}

const COLLECTION_AUTH_CSS = `
${WEBVIEW_SHARED_CSS}
${AUTHENTICATION_UI_CSS}
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
main {
  padding: var(--ah-space-4);
  display: grid;
  gap: var(--ah-space-3);
  max-width: 32rem;
}
h1 { margin: 0; font-size: 1.1rem; }
.subtitle { margin: 0; font-size: 12px; }
.muted { color: var(--vscode-descriptionForeground); }
.field { display: grid; gap: var(--ah-space-1); }
.field span { color: var(--vscode-descriptionForeground); font-size: .85em; }
.hint { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
input, select {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  padding: 6px 8px;
  font: inherit;
}
input:focus, select:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
input[readonly] { opacity: 0.95; }
.error {
  margin: 0;
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-size: .92em;
}
footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ah-space-2);
  margin-top: var(--ah-space-1);
  padding-top: var(--ah-space-3);
  border-top: 1px solid var(--vscode-panel-border);
}
.spacer { flex: 1; }
footer button { min-width: 4.5rem; }
`;

const COLLECTION_AUTH_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const KINDS = ${JSON.stringify([...AUTHENTICATION_UI_KINDS])};
  let state = null;

  const el = (id) => document.getElementById(id);

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

  function currentKind() {
    const value = el('authKind').value;
    return KINDS.indexOf(value) >= 0 ? value : 'none';
  }

  function rebuildProfiles() {
    const kind = currentKind();
    const select = el('authProfile');
    const selected = select.value;
    const profiles = state && state.profiles ? state.profiles : [];
    const filtered = profiles.filter((profile) => {
      const provider = profile.providerId || 'none';
      if (kind === 'none') return provider === 'none';
      return provider === kind;
    });
    select.innerHTML = '<option value="">none</option>';
    filtered.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label || profile.id;
      select.appendChild(option);
    });
    if (selected && [...select.options].some((option) => option.value === selected)) {
      select.value = selected;
    }
  }

  function fieldDisplay(profile, name) {
    if (!profile || !Array.isArray(profile.fields)) return '';
    const field = profile.fields.find((entry) => entry.name === name);
    return field && field.display ? field.display : '';
  }

  function updateFields() {
    const kind = currentKind();
    const profileId = el('authProfile').value.trim();
    const profiles = state && state.profiles ? state.profiles : [];
    const profile = profiles.find((entry) => entry.id === profileId);
    el('authSavedBlock').hidden = kind === 'none';
    el('authTokenField').hidden = kind !== 'bearer';
    el('authUsernameField').hidden = kind !== 'basic';
    el('authPasswordField').hidden = kind !== 'basic';
    el('authApiKeyNameField').hidden = kind !== 'apiKey';
    el('authApiKeyValueField').hidden = kind !== 'apiKey';
    el('authAddToField').hidden = kind === 'none';
    el('authTokenDisplay').value = fieldDisplay(profile, 'token');
    el('authUsernameDisplay').value = fieldDisplay(profile, 'username');
    el('authPasswordDisplay').value = fieldDisplay(profile, 'password');
    el('authApiKeyNameDisplay').value = (profile && profile.apiKeyName) || fieldDisplay(profile, 'name');
    el('authApiKeyValueDisplay').value = fieldDisplay(profile, 'value');
    const addTo = el('authAddTo');
    addTo.innerHTML = '';
    if (kind === 'apiKey') {
      const header = document.createElement('option');
      header.value = 'header';
      header.textContent = 'Header';
      const query = document.createElement('option');
      query.value = 'query';
      query.textContent = 'Query';
      addTo.appendChild(header);
      addTo.appendChild(query);
      addTo.value = profile && profile.apiKeyLocation === 'query' ? 'query' : 'header';
    } else if (kind === 'bearer' || kind === 'basic') {
      const option = document.createElement('option');
      option.value = 'authorization-header';
      option.textContent = 'Authorization Header';
      addTo.appendChild(option);
    }
    addTo.disabled = true;
    el('save').disabled = kind !== 'none' && !profileId;
  }

  function applyState(next) {
    state = next;
    el('collectionLabel').textContent = next.collectionName
      ? ('Collection: ' + next.collectionName)
      : '';
    const ui = next.ui || {};
    const kind = ui.selectedKind && KINDS.indexOf(ui.selectedKind) >= 0
      ? ui.selectedKind
      : 'none';
    el('authKind').value = kind;
    rebuildProfiles();
    if (ui.selectedProfileId) {
      el('authProfile').value = ui.selectedProfileId;
    }
    updateFields();
    showError('');
  }

  el('authKind').addEventListener('change', () => {
    rebuildProfiles();
    updateFields();
  });
  el('authProfile').addEventListener('change', () => {
    updateFields();
  });
  el('cancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });
  el('manageAuthentication').addEventListener('click', () => {
    vscode.postMessage({ type: 'manageAuthentication' });
  });
  el('save').addEventListener('click', () => {
    const kind = currentKind();
    if (kind === 'none') {
      vscode.postMessage({ type: 'save' });
      return;
    }
    const profileId = el('authProfile').value.trim();
    if (!profileId) {
      showError('Choose a saved Authentication of this type.');
      return;
    }
    vscode.postMessage({ type: 'save', profileId: profileId });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init' && message.state) {
      applyState(message.state);
      return;
    }
    if (message.type === 'error') {
      showError(message.message || 'Unable to save Collection Authentication.');
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
