/**
 * Pure HTML/CSS/JS and message helpers for the Auth Profiles Manager webview.
 * No `vscode` import — keeps core/tests free of the extension host.
 * Secret values never appear in state or postMessage payloads.
 */

import {
  AUTHENTICATION_PRESENTATION_MASK,
  BASIC_MISSING_VALIDATION_PREFIX,
  BASIC_MISSING_VALIDATION_SUFFIX,
  buildAuthenticationPresentationPreview,
} from '../authentication-presentation-preview';
import {
  AUTH_PROVIDER_IDS as CORE_AUTH_PROVIDER_IDS,
  isAuthenticationCommitProviderId,
  isValidAuthenticationProfileId,
  secretFieldsForProvider as coreSecretFieldsForProvider,
  validateAuthenticationProfilesForCommit,
} from '../authentication-profile-validation';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
} from '../../ui/webview';

export { escapeAttribute };

export const AUTH_PROVIDER_IDS = CORE_AUTH_PROVIDER_IDS;

export type AuthManagerProviderId = (typeof AUTH_PROVIDER_IDS)[number];

/** Secret field status posted to the webview (never includes values). */
export interface AuthManagerSecretField {
  readonly field: string;
  readonly label: string;
  readonly status: 'set' | 'missing';
}

/** Editable profile row for the Auth Profiles Manager UI. */
export interface AuthManagerProfile {
  readonly id: string;
  readonly label: string;
  readonly providerId: AuthManagerProviderId;
  /** API key header/query parameter name. */
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: 'header' | 'query';
  readonly secretFields: readonly AuthManagerSecretField[];
}

/** Full snapshot posted between host and webview (metadata + secret status only). */
export interface AuthManagerState {
  readonly profiles: readonly AuthManagerProfile[];
  readonly defaultProfileId?: string;
  readonly selectedId?: string;
}

export type AuthManagerInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'commit'; readonly state: AuthManagerState }
  | {
      readonly type: 'setSecret';
      readonly profileId: string;
      readonly field: string;
    }
  | {
      readonly type: 'clearSecret';
      readonly profileId: string;
      readonly field: string;
    }
  | { readonly type: 'setDefault'; readonly profileId?: string };

export type AuthManagerOutboundMessage =
  | { readonly type: 'init'; readonly state: AuthManagerState }
  | { readonly type: 'error'; readonly message: string };

/** Validates webview → extension messages. */
export function parseAuthManagerMessage(
  value: unknown,
): AuthManagerInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  if (record.type === 'ready') {
    return { type: 'ready' };
  }
  if (record.type === 'commit') {
    const state = parseState(record.state);
    if (state === undefined) {
      return undefined;
    }
    return { type: 'commit', state };
  }
  if (record.type === 'setSecret' || record.type === 'clearSecret') {
    if (
      typeof record.profileId !== 'string' ||
      typeof record.field !== 'string' ||
      record.profileId.length === 0 ||
      record.field.length === 0
    ) {
      return undefined;
    }
    return {
      type: record.type,
      profileId: record.profileId,
      field: record.field,
    };
  }
  if (record.type === 'setDefault') {
    if (
      record.profileId !== undefined &&
      typeof record.profileId !== 'string'
    ) {
      return undefined;
    }
    return {
      type: 'setDefault',
      ...(typeof record.profileId === 'string' && record.profileId.length > 0
        ? { profileId: record.profileId }
        : {}),
    };
  }
  return undefined;
}

/**
 * Returns an error string when the committed state is invalid.
 * Thin projection of core commit validation — rules live in auth core.
 */
export function validateAuthManagerState(
  state: AuthManagerState,
): string | undefined {
  const { issues } = validateAuthenticationProfilesForCommit({
    profiles: state.profiles,
    defaultProfileId: state.defaultProfileId,
  });
  return issues[0]?.message;
}

/** True when the value is a supported manager provider id. */
export function isAuthManagerProviderId(
  value: unknown,
): value is AuthManagerProviderId {
  return isAuthenticationCommitProviderId(value);
}

/** True when a profile id matches the settings-friendly pattern. */
export function isValidAuthProfileId(id: string): boolean {
  return isValidAuthenticationProfileId(id);
}

/**
 * Allocates a stable, unique profile id from a display name.
 */
export function allocateAuthProfileId(
  name: string,
  existingIds: ReadonlySet<string>,
): string {
  const base = slugifyProfileId(name) || 'profile';
  if (!existingIds.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/** Secret field names required by a provider (empty for none). */
export function secretFieldsForProvider(
  providerId: AuthManagerProviderId,
): readonly { readonly field: string; readonly label: string }[] {
  return coreSecretFieldsForProvider(providerId);
}
/** Builds the Auth Profiles Manager document. */
export function renderAuthManagerHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Auth Profiles Manager</title>
<style nonce="${safeNonce}">${MANAGER_CSS}</style>
</head>
<body>
<div id="app">
  <aside>
    <div class="aside-header">
      <h1>Auth Profiles</h1>
      <button type="button" id="addProfile" class="primary" title="Add profile">Add</button>
    </div>
    <label class="search-field">
      <span class="sr-only">Search profiles</span>
      <input id="profileSearch" type="search" placeholder="Search profiles" autocomplete="off" />
    </label>
    <ul id="profileList" class="profile-list" role="listbox" aria-label="Authentication profiles"></ul>
  </aside>
  <main>
    <header class="main-header">
      <div class="title-row">
        <input id="profileLabel" type="text" autocomplete="off" placeholder="Profile label" aria-label="Profile label" />
        <button type="button" id="setDefault" class="secondary">Set Default</button>
        <button type="button" id="duplicateProfile" class="secondary">Duplicate</button>
        <button type="button" id="deleteProfile" class="danger">Delete</button>
      </div>
      <p id="defaultBadge" class="badge" hidden>Session default</p>
      <p id="emptyHint" class="hint" hidden>Add a profile to get started.</p>
    </header>
    <section id="editor" class="editor" hidden>
      <label class="field">
        <span>Profile id</span>
        <input id="profileId" type="text" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span>Provider</span>
        <select id="providerId" aria-label="Authentication provider">
          <option value="none">No authentication</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic</option>
          <option value="apiKey">API key</option>
        </select>
      </label>
      <div id="apiKeyFields" class="api-key-fields" hidden>
        <label class="field">
          <span>Key name</span>
          <input id="apiKeyName" type="text" autocomplete="off" placeholder="X-API-Key" />
        </label>
        <label class="field">
          <span>Location</span>
          <select id="apiKeyLocation" aria-label="API key location">
            <option value="header">Header</option>
            <option value="query">Query</option>
          </select>
        </label>
      </div>
      <section class="secrets">
        <div class="section-header">
          <h2>Secrets</h2>
        </div>
        <p class="hint">Secrets are entered via a password prompt and stored in VS Code Secret Storage. Values never appear in this panel.</p>
        <div id="secretList" class="secret-list"></div>
        <p id="noSecrets" class="empty" hidden>This provider does not require secrets.</p>
        <p id="missingCta" class="cta" hidden>
          <span id="missingCtaText"></span>
          <button type="button" id="missingCtaButton" class="primary">Set secret</button>
        </p>
      </section>
      <section class="preview">
        <div class="section-header">
          <h2>Preview</h2>
        </div>
        <pre id="authPreview" class="preview-box" aria-live="polite">Select a profile to preview.</pre>
        <p id="validationHint" class="hint" hidden></p>
      </section>
    </section>
    <p id="error" class="error" hidden></p>
    <footer>
      <span id="dirtyHint" class="hint" hidden>Unsaved changes</span>
      <button type="button" id="save" class="primary">Save</button>
    </footer>
  </main>
</div>
<script nonce="${safeNonce}">${MANAGER_SCRIPT}</script>
</body>
</html>`;
}

function parseState(value: unknown): AuthManagerState | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  const profiles = parseProfiles(record.profiles);
  if (profiles === undefined) {
    return undefined;
  }
  const defaultProfileId =
    record.defaultProfileId === undefined || record.defaultProfileId === null
      ? undefined
      : typeof record.defaultProfileId === 'string'
        ? record.defaultProfileId
        : undefined;
  if (
    record.defaultProfileId !== undefined &&
    record.defaultProfileId !== null &&
    typeof record.defaultProfileId !== 'string'
  ) {
    return undefined;
  }
  const selectedId =
    record.selectedId === undefined
      ? undefined
      : typeof record.selectedId === 'string'
        ? record.selectedId
        : undefined;
  if (
    record.selectedId !== undefined &&
    typeof record.selectedId !== 'string'
  ) {
    return undefined;
  }
  return {
    profiles,
    ...(defaultProfileId === undefined ? {} : { defaultProfileId }),
    ...(selectedId === undefined ? {} : { selectedId }),
  };
}

function parseProfiles(
  value: unknown,
): readonly AuthManagerProfile[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const profiles: AuthManagerProfile[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.label !== 'string' ||
      !isAuthManagerProviderId(record.providerId)
    ) {
      return undefined;
    }
    const secretFields = parseSecretFields(record.secretFields);
    if (secretFields === undefined) {
      return undefined;
    }
    if (
      record.apiKeyName !== undefined &&
      typeof record.apiKeyName !== 'string'
    ) {
      return undefined;
    }
    if (
      record.apiKeyLocation !== undefined &&
      record.apiKeyLocation !== 'header' &&
      record.apiKeyLocation !== 'query'
    ) {
      return undefined;
    }
    profiles.push({
      id: record.id,
      label: record.label,
      providerId: record.providerId,
      ...(typeof record.apiKeyName === 'string'
        ? { apiKeyName: record.apiKeyName }
        : {}),
      ...(record.apiKeyLocation === 'header' ||
      record.apiKeyLocation === 'query'
        ? { apiKeyLocation: record.apiKeyLocation }
        : {}),
      secretFields,
    });
  }
  return profiles;
}

function parseSecretFields(
  value: unknown,
): readonly AuthManagerSecretField[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const fields: AuthManagerSecretField[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.field !== 'string' ||
      typeof record.label !== 'string' ||
      (record.status !== 'set' && record.status !== 'missing')
    ) {
      return undefined;
    }
    fields.push({
      field: record.field,
      label: record.label,
      status: record.status,
    });
  }
  return fields;
}

function slugifyProfileId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
}

const MANAGER_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
#app {
  display: grid;
  grid-template-columns: minmax(200px, 260px) 1fr;
  min-height: 100vh;
}
aside {
  border-right: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  padding: 14px 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.aside-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h1 { margin: 0; font-size: 1.05rem; font-weight: 600; }
h2 { margin: 0; font-size: .95rem; font-weight: 600; }
.profile-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow: auto;
}
.profile-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  border-radius: 2px;
  padding: 7px 10px;
  color: var(--vscode-foreground);
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.profile-item:hover {
  background: var(--vscode-list-hoverBackground);
}
.profile-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.profile-item .meta {
  display: block;
  font-size: .85em;
  color: var(--vscode-descriptionForeground);
}
.profile-item.active .meta { color: inherit; opacity: .85; }
.profile-item .warn {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
}
main {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.main-header { display: flex; flex-direction: column; gap: 8px; }
.title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
#profileLabel {
  flex: 1 1 220px;
  min-width: 160px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.field span { color: var(--vscode-descriptionForeground); font-size: .9em; }
input[type="text"], select {
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 6px 8px;
  border-radius: 2px;
  font: inherit;
}
input[type="text"]:focus-visible, select:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.api-key-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.badge {
  align-self: flex-start;
  margin: 0;
  padding: 2px 8px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: .85em;
}
.hint { margin: 0; color: var(--vscode-descriptionForeground); }
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.secret-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.secret-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  border-radius: 2px;
}
.secret-row .label { font-weight: 600; min-width: 100px; }
.secret-row .status {
  flex: 1;
  color: var(--vscode-descriptionForeground);
}
.secret-row .status.missing {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  font-weight: 600;
}
.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 2px;
  background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
}
.empty { margin: 8px 0 0; color: var(--vscode-descriptionForeground); }
.error {
  margin: 0;
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
}
footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
}
button {
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 2px;
  padding: 5px 12px;
  font: inherit;
  cursor: pointer;
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
button.danger {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  background: transparent;
  border-color: var(--vscode-panel-border, var(--vscode-contrastBorder));
}
button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}
button:disabled {
  opacity: .55;
  cursor: default;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
.search-field input {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px;
  padding: 4px 8px;
  font: inherit;
}
.preview { margin-top: 16px; }
.preview-box {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  border-radius: 2px;
  background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  white-space: pre-wrap;
  word-break: break-word;
}
@media (max-width: 720px) {
  #app { grid-template-columns: 1fr; }
  aside { border-right: none; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); }
  .api-key-fields { grid-template-columns: 1fr; }
}
`;

/** Secret field catalogs injected from {@link coreSecretFieldsForProvider}. */
const AUTH_MANAGER_SECRET_META = {
  none: coreSecretFieldsForProvider('none'),
  bearer: coreSecretFieldsForProvider('bearer'),
  basic: coreSecretFieldsForProvider('basic'),
  apiKey: coreSecretFieldsForProvider('apiKey'),
} as const;

/** Static preview copy derived from the core helper so webview strings cannot drift. */
const AUTH_MANAGER_PREVIEW_COPY = {
  none: buildAuthenticationPresentationPreview({ providerId: 'none' }),
  bearerReady: buildAuthenticationPresentationPreview({
    providerId: 'bearer',
    secretFields: [{ field: 'token', label: 'Token', status: 'set' }],
  }),
  bearerMissing: buildAuthenticationPresentationPreview({
    providerId: 'bearer',
    secretFields: [{ field: 'token', label: 'Token', status: 'missing' }],
  }),
  basicPreview: buildAuthenticationPresentationPreview({
    providerId: 'basic',
    secretFields: [
      { field: 'username', label: 'Username', status: 'set' },
      { field: 'password', label: 'Password', status: 'set' },
    ],
  }).preview,
  basicMissingPrefix: BASIC_MISSING_VALIDATION_PREFIX,
  basicMissingSuffix: BASIC_MISSING_VALIDATION_SUFFIX,
  basicReadyValidation: buildAuthenticationPresentationPreview({
    providerId: 'basic',
    secretFields: [
      { field: 'username', label: 'Username', status: 'set' },
      { field: 'password', label: 'Password', status: 'set' },
    ],
  }).validation,
  apiKeySecretMissing: buildAuthenticationPresentationPreview({
    providerId: 'apiKey',
    apiKeyName: 'X-API-Key',
    apiKeyLocation: 'header',
    secretFields: [{ field: 'value', label: 'API key value', status: 'missing' }],
  }).validation,
  apiKeyNameEmpty: buildAuthenticationPresentationPreview({
    providerId: 'apiKey',
    apiKeyName: '',
    apiKeyLocation: 'header',
    secretFields: [{ field: 'value', label: 'API key value', status: 'set' }],
  }).validation,
  apiKeyReady: buildAuthenticationPresentationPreview({
    providerId: 'apiKey',
    apiKeyName: 'X-API-Key',
    apiKeyLocation: 'header',
    secretFields: [{ field: 'value', label: 'API key value', status: 'set' }],
  }).validation,
  unknown: buildAuthenticationPresentationPreview({ providerId: 'oauth2' }),
} as const;

const MANAGER_SCRIPT = `
const vscode = acquireVsCodeApi();
const MASK = ${JSON.stringify(AUTHENTICATION_PRESENTATION_MASK)};
const SECRET_META = ${JSON.stringify(AUTH_MANAGER_SECRET_META)};
const PREVIEW_COPY = ${JSON.stringify(AUTH_MANAGER_PREVIEW_COPY)};

/** @type {any} */
let state = {
  profiles: [],
  defaultProfileId: undefined,
  selectedId: undefined,
};
let dirty = false;
let profileFilter = '';
/** @type {string | undefined} */
let originalSelectedId;

const el = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing #' + id);
  return node;
};

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

function setDirty(value) {
  dirty = value;
  el('dirtyHint').hidden = !value;
}

function secretMeta(providerId) {
  return SECRET_META[providerId] || [];
}

function allocateId(name) {
  const existing = new Set(state.profiles.map((entry) => entry.id));
  const base = String(name || 'profile')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'profile';
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(base + '-' + suffix)) suffix += 1;
  return base + '-' + suffix;
}

function selectedProfile() {
  return state.profiles.find((entry) => entry.id === state.selectedId);
}

function syncSecretFields(profile) {
  const meta = secretMeta(profile.providerId);
  const previous = new Map(
    (profile.secretFields || []).map((entry) => [entry.field, entry.status]),
  );
  return meta.map((entry) => ({
    field: entry.field,
    label: entry.label,
    status: previous.get(entry.field) || 'missing',
  }));
}

function renderList() {
  const list = el('profileList');
  list.innerHTML = '';
  const query = profileFilter.trim().toLowerCase();
  for (const profile of state.profiles) {
    const haystack = ((profile.label || '') + ' ' + (profile.id || '') + ' ' + (profile.providerId || '')).toLowerCase();
    if (query && !haystack.includes(query)) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'profile-item' + (state.selectedId === profile.id ? ' active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', state.selectedId === profile.id ? 'true' : 'false');
    const label = document.createElement('span');
    label.textContent = profile.label || profile.id;
    item.appendChild(label);
    const meta = document.createElement('span');
    meta.className = 'meta';
    const missing = (profile.secretFields || []).filter((field) => field.status === 'missing').length;
    meta.textContent = profile.providerId + (missing > 0 ? ' · ' + missing + ' secret missing' : '');
    if (missing > 0) meta.classList.add('warn');
    item.appendChild(meta);
    item.addEventListener('click', () => {
      readEditorIntoState();
      state = { ...state, selectedId: profile.id };
      render();
    });
    list.appendChild(item);
  }
}

/** Thin adapter: static copy from core; dynamic apiKey name/location use injected MASK. */
function buildAuthPreview(profile) {
  const missing = (profile.secretFields || []).filter((field) => field.status === 'missing');
  if (profile.providerId === 'none') {
    return PREVIEW_COPY.none;
  }
  if (profile.providerId === 'bearer') {
    return missing.length > 0 ? PREVIEW_COPY.bearerMissing : PREVIEW_COPY.bearerReady;
  }
  if (profile.providerId === 'basic') {
    return {
      preview: PREVIEW_COPY.basicPreview,
      validation: missing.length > 0
        ? PREVIEW_COPY.basicMissingPrefix + missing.map((field) => field.label).join(', ') + PREVIEW_COPY.basicMissingSuffix
        : PREVIEW_COPY.basicReadyValidation,
    };
  }
  if (profile.providerId === 'apiKey') {
    const name = (profile.apiKeyName || 'X-API-Key').trim() || 'X-API-Key';
    const location = profile.apiKeyLocation === 'query' ? 'query' : 'header';
    return {
      preview: location === 'query'
        ? 'Query: ' + name + '=' + MASK
        : name + ': ' + MASK,
      validation: missing.length > 0
        ? PREVIEW_COPY.apiKeySecretMissing
        : (!profile.apiKeyName || !profile.apiKeyName.trim()
          ? PREVIEW_COPY.apiKeyNameEmpty
          : PREVIEW_COPY.apiKeyReady),
    };
  }
  return PREVIEW_COPY.unknown;
}

function renderSecrets(profile) {
  const list = el('secretList');
  list.innerHTML = '';
  const fields = profile.secretFields || [];
  el('noSecrets').hidden = fields.length > 0;
  const missing = fields.filter((field) => field.status === 'missing');
  const cta = el('missingCta');
  if (missing.length === 0) {
    cta.hidden = true;
  } else {
    cta.hidden = false;
    const first = missing[0];
    el('missingCtaText').textContent =
      'Missing secret: ' + first.label + '. Set it to use this profile.';
    el('missingCtaButton').onclick = () => {
      post({ type: 'setSecret', profileId: profile.id, field: first.field });
    };
  }
  for (const field of fields) {
    const row = document.createElement('div');
    row.className = 'secret-row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = field.label;
    const status = document.createElement('span');
    status.className = 'status' + (field.status === 'missing' ? ' missing' : '');
    status.textContent = field.status === 'set' ? 'Secret set' : 'Secret missing';
    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'primary';
    setBtn.textContent = field.status === 'set' ? 'Update secret' : 'Set secret';
    setBtn.addEventListener('click', () => {
      post({ type: 'setSecret', profileId: profile.id, field: field.field });
    });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'secondary';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = field.status !== 'set';
    clearBtn.addEventListener('click', () => {
      post({ type: 'clearSecret', profileId: profile.id, field: field.field });
    });
    row.appendChild(label);
    row.appendChild(status);
    row.appendChild(setBtn);
    row.appendChild(clearBtn);
    list.appendChild(row);
  }
}

function readEditorIntoState() {
  const profile = selectedProfile();
  if (!profile) return;
  const label = el('profileLabel').value;
  const id = el('profileId').value.trim();
  const providerId = el('providerId').value;
  const next = {
    ...profile,
    id: id || profile.id,
    label,
    providerId,
    apiKeyName: el('apiKeyName').value,
    apiKeyLocation: el('apiKeyLocation').value,
  };
  next.secretFields = syncSecretFields(next);
  const profiles = state.profiles.map((entry) =>
    entry.id === originalSelectedId || entry.id === profile.id ? next : entry);
  let defaultProfileId = state.defaultProfileId;
  if (defaultProfileId === originalSelectedId || defaultProfileId === profile.id) {
    defaultProfileId = next.id;
  }
  state = {
    ...state,
    profiles,
    defaultProfileId,
    selectedId: next.id,
  };
  originalSelectedId = next.id;
}

function renderEditor() {
  const profile = selectedProfile();
  const hasSelection = !!profile;
  el('editor').hidden = !hasSelection;
  el('emptyHint').hidden = state.profiles.length > 0;
  el('setDefault').disabled = !hasSelection;
  el('deleteProfile').disabled = !hasSelection;
  el('duplicateProfile').disabled = !hasSelection;
  el('profileLabel').disabled = !hasSelection;
  if (!profile) {
    el('defaultBadge').hidden = true;
    el('missingCta').hidden = true;
    el('authPreview').textContent = 'Select a profile to preview.';
    el('validationHint').hidden = true;
    return;
  }
  originalSelectedId = profile.id;
  el('profileLabel').value = profile.label || '';
  el('profileId').value = profile.id || '';
  el('providerId').value = profile.providerId || 'none';
  const isApiKey = profile.providerId === 'apiKey';
  el('apiKeyFields').hidden = !isApiKey;
  el('apiKeyName').value = profile.apiKeyName || '';
  el('apiKeyLocation').value = profile.apiKeyLocation || 'header';
  el('defaultBadge').hidden = state.defaultProfileId !== profile.id;
  renderSecrets(profile);
  const preview = buildAuthPreview(profile);
  el('authPreview').textContent = preview.preview;
  const hint = el('validationHint');
  if (preview.validation) {
    hint.hidden = false;
    hint.textContent = preview.validation;
  } else {
    hint.hidden = true;
  }
}

function render() {
  renderList();
  renderEditor();
}

function commitState() {
  readEditorIntoState();
  post({ type: 'commit', state });
}

el('addProfile').addEventListener('click', () => {
  readEditorIntoState();
  const id = allocateId('bearer');
  const profile = {
    id,
    label: 'Bearer',
    providerId: 'bearer',
    secretFields: secretMeta('bearer').map((entry) => ({
      field: entry.field,
      label: entry.label,
      status: 'missing',
    })),
  };
  state = {
    ...state,
    profiles: state.profiles.concat([profile]),
    selectedId: id,
  };
  setDirty(true);
  render();
});

el('profileSearch').addEventListener('input', () => {
  profileFilter = el('profileSearch').value;
  renderList();
});

el('duplicateProfile').addEventListener('click', () => {
  readEditorIntoState();
  const source = selectedProfile();
  if (!source) return;
  const label = (source.label || source.id) + ' Copy';
  const id = allocateId(label);
  const profile = {
    ...source,
    id,
    label,
    secretFields: (source.secretFields || []).map((field) => ({
      ...field,
      status: 'missing',
    })),
  };
  state = {
    ...state,
    profiles: state.profiles.concat([profile]),
    selectedId: id,
  };
  setDirty(true);
  render();
});

el('deleteProfile').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile) return;
  const profiles = state.profiles.filter((entry) => entry.id !== profile.id);
  state = {
    ...state,
    profiles,
    defaultProfileId:
      state.defaultProfileId === profile.id ? undefined : state.defaultProfileId,
    selectedId: profiles[0] ? profiles[0].id : undefined,
  };
  setDirty(true);
  render();
});

el('setDefault').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile) return;
  readEditorIntoState();
  post({ type: 'setDefault', profileId: selectedProfile().id });
});

el('save').addEventListener('click', () => {
  showError('');
  commitState();
});

['profileLabel', 'profileId', 'providerId', 'apiKeyName', 'apiKeyLocation'].forEach((id) => {
  el(id).addEventListener('input', () => setDirty(true));
  el(id).addEventListener('change', () => {
    if (id === 'providerId') {
      readEditorIntoState();
      const profile = selectedProfile();
      if (profile) {
        const next = {
          ...profile,
          providerId: el('providerId').value,
          secretFields: syncSecretFields({
            ...profile,
            providerId: el('providerId').value,
          }),
        };
        state = {
          ...state,
          profiles: state.profiles.map((entry) =>
            entry.id === profile.id ? next : entry),
        };
        render();
      }
    } else if (id === 'apiKeyName' || id === 'apiKeyLocation') {
      readEditorIntoState();
      render();
    }
    setDirty(true);
  });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'init') {
    state = message.state || state;
    if (!state.selectedId && state.profiles[0]) {
      state = { ...state, selectedId: state.profiles[0].id };
    }
    setDirty(false);
    showError('');
    render();
    return;
  }
  if (message.type === 'error') {
    showError(message.message || 'Unable to save authentication profiles.');
  }
});

post({ type: 'ready' });
`;
