/**
 * Pure HTML/CSS/JS and message helpers for the Manage Authentication webview.
 * No `vscode` import — keeps core/tests free of the extension host.
 * Secret values never appear in state or init payloads; cleartext may post once
 * on Save/Replace via storeSecret, then the webview clears immediately.
 */

import {
  AUTHENTICATION_PRESENTATION_MASK,
  AUTHENTICATION_SECRET_FIELD_MASK,
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
  WEBVIEW_SHARED_CSS,
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

/** Non-secret credential source shown read-only in the manager. */
export interface AuthManagerCredentialSource {
  readonly field: string;
  readonly label: string;
  readonly kind: 'variable' | 'literal';
  readonly detail: string;
}

/** Secret-free Login API metadata shown/edited in the manager. */
export interface AuthManagerLoginConfig {
  readonly method: string;
  readonly url: string;
  readonly bodyTemplate?: string;
  readonly contentType?: string;
  readonly tokenPath?: string;
  readonly refreshTokenPath?: string;
  readonly sendAs: 'bearer' | 'apiKey';
}

/** Richer secret-free test result for Auth Manager presentation (panel memory). */
export interface AuthManagerTestResult {
  readonly ok: boolean;
  readonly url?: string;
  readonly statusCode?: number;
  readonly latencyMs?: number;
  readonly identity?: string;
  readonly expiresAt?: string;
  readonly rateLimitRemaining?: string;
  readonly rateLimitLimit?: string;
  readonly lastSuccessfulTestAt?: string;
  readonly summary: string;
  readonly error?: string;
}

/** Detected token candidate (paths only — never values). */
export interface AuthManagerTokenCandidate {
  readonly path: string;
  readonly kind: string;
  readonly key: string;
}

/** Login run result posted to the webview (secret-free). */
export interface AuthManagerLoginResult {
  readonly ok: boolean;
  readonly statusCode?: number;
  readonly latencyMs?: number;
  readonly identity?: string;
  readonly summary: string;
  readonly candidates: readonly AuthManagerTokenCandidate[];
  readonly sessionExists: boolean;
  readonly error?: string;
}

/** Editable Authentication row for the manager UI. */
export interface AuthManagerProfile {
  readonly id: string;
  readonly label: string;
  readonly providerId: AuthManagerProviderId;
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: 'header' | 'query';
  readonly secretFields: readonly AuthManagerSecretField[];
  readonly credentialSources?: readonly AuthManagerCredentialSource[];
  readonly healthLabel?: string;
  readonly healthDetail?: string;
  readonly healthStatus?: string;
  readonly sessionAccessTokenPresent?: boolean;
  readonly sessionRefreshTokenPresent?: boolean;
  readonly sessionExpiresAt?: string;
  readonly lastTestSummary?: string;
  readonly login?: AuthManagerLoginConfig;
  readonly loginUsernameStatus?: 'set' | 'missing';
  readonly loginPasswordStatus?: 'set' | 'missing';
}

/** Full snapshot posted between host and webview (metadata + secret status only). */
export interface AuthManagerState {
  readonly profiles: readonly AuthManagerProfile[];
  readonly defaultProfileId?: string;
  readonly selectedId?: string;
  readonly focusSecretField?: string;
  readonly openLoginWizard?: boolean;
}

export type AuthManagerInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'commit'; readonly state: AuthManagerState }
  | {
      readonly type: 'storeSecret';
      readonly profileId: string;
      readonly field: string;
      readonly value: string;
    }
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
  | { readonly type: 'setDefault'; readonly profileId?: string }
  | {
      readonly type: 'testAuth';
      readonly profileId: string;
      readonly testUrl?: string;
    }
  | {
      readonly type: 'saveLoginConfig';
      readonly profileId: string;
      readonly login: AuthManagerLoginConfig;
    }
  | {
      readonly type: 'runLogin';
      readonly profileId: string;
      readonly login?: AuthManagerLoginConfig;
      readonly username?: string;
      readonly password?: string;
    }
  | {
      readonly type: 'applyLoginTokens';
      readonly profileId: string;
      readonly accessTokenPath: string;
      readonly refreshTokenPath?: string;
      readonly confirmOverwrite: boolean;
    }
  | { readonly type: 'cancelLoginWizard'; readonly profileId: string };

export type AuthManagerOutboundMessage =
  | { readonly type: 'init'; readonly state: AuthManagerState }
  | { readonly type: 'error'; readonly message: string }
  | {
      readonly type: 'testResult';
      readonly profileId: string;
      readonly result: AuthManagerTestResult;
    }
  | {
      readonly type: 'loginResult';
      readonly profileId: string;
      readonly result: AuthManagerLoginResult;
    };

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
  if (record.type === 'storeSecret') {
    if (
      typeof record.profileId !== 'string' ||
      typeof record.field !== 'string' ||
      typeof record.value !== 'string' ||
      record.profileId.length === 0 ||
      record.field.length === 0
    ) {
      return undefined;
    }
    return {
      type: 'storeSecret',
      profileId: record.profileId,
      field: record.field,
      value: record.value,
    };
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
  if (record.type === 'testAuth') {
    if (typeof record.profileId !== 'string' || record.profileId.length === 0) {
      return undefined;
    }
    return {
      type: 'testAuth',
      profileId: record.profileId,
      ...(typeof record.testUrl === 'string' ? { testUrl: record.testUrl } : {}),
    };
  }
  if (record.type === 'saveLoginConfig') {
    const login = parseLoginConfig(record.login);
    if (
      typeof record.profileId !== 'string' ||
      record.profileId.length === 0 ||
      login === undefined
    ) {
      return undefined;
    }
    return { type: 'saveLoginConfig', profileId: record.profileId, login };
  }
  if (record.type === 'runLogin') {
    if (typeof record.profileId !== 'string' || record.profileId.length === 0) {
      return undefined;
    }
    const login =
      record.login === undefined ? undefined : parseLoginConfig(record.login);
    if (record.login !== undefined && login === undefined) {
      return undefined;
    }
    return {
      type: 'runLogin',
      profileId: record.profileId,
      ...(login !== undefined ? { login } : {}),
      ...(typeof record.username === 'string' ? { username: record.username } : {}),
      ...(typeof record.password === 'string' ? { password: record.password } : {}),
    };
  }
  if (record.type === 'applyLoginTokens') {
    if (
      typeof record.profileId !== 'string' ||
      typeof record.accessTokenPath !== 'string' ||
      record.profileId.length === 0 ||
      record.accessTokenPath.length === 0 ||
      typeof record.confirmOverwrite !== 'boolean'
    ) {
      return undefined;
    }
    return {
      type: 'applyLoginTokens',
      profileId: record.profileId,
      accessTokenPath: record.accessTokenPath,
      ...(typeof record.refreshTokenPath === 'string'
        ? { refreshTokenPath: record.refreshTokenPath }
        : {}),
      confirmOverwrite: record.confirmOverwrite,
    };
  }
  if (record.type === 'cancelLoginWizard') {
    if (typeof record.profileId !== 'string' || record.profileId.length === 0) {
      return undefined;
    }
    return { type: 'cancelLoginWizard', profileId: record.profileId };
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
  const base = slugifyProfileId(name) || 'authentication';
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

/** Builds the Manage Authentication document. */
export function renderAuthManagerHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Manage Authentication</title>
<style nonce="${safeNonce}">${MANAGER_CSS}</style>
</head>
<body>
<div id="app">
  <aside aria-label="Authentication navigation">
    <div class="aside-header">
      <h1>Authentication</h1>
      <button type="button" id="addProfile" class="primary" title="New Authentication" aria-label="New Authentication">+ New Authentication</button>
    </div>
    <label class="search-field">
      <span class="sr-only">Search Authentication</span>
      <input id="profileSearch" type="search" placeholder="Search" autocomplete="off" />
    </label>
    <ul id="profileList" class="profile-list" role="listbox" aria-label="Authentication list"></ul>
  </aside>
  <main>
    <div id="emptyState" class="empty-state" hidden role="status">
      <strong>No Authentication yet</strong>
      <span>Create one — or paste a Bearer token in a Request and save later.</span>
    </div>
    <section id="editor" class="editor" hidden>
      <header class="main-header">
        <div class="title-row">
          <input id="profileLabel" type="text" autocomplete="off" placeholder="Name" aria-label="Authentication name" />
          <button type="button" id="setDefault" class="secondary">Set Default</button>
          <button type="button" id="duplicateProfile" class="secondary">Duplicate</button>
          <button type="button" id="deleteProfile" class="danger">Delete</button>
        </div>
        <div class="chip-row" aria-live="polite">
          <span id="methodChip" class="stat-chip"><span>Method</span><strong id="methodChipValue">—</strong></span>
          <span id="healthChip" class="stat-chip"><span>Health</span><strong id="healthChipValue">—</strong></span>
          <span id="defaultBadge" class="badge" hidden>Session default</span>
        </div>
        <p id="healthDetail" class="hint" hidden></p>
      </header>

      <section class="detail-section">
        <h2>Name &amp; Method</h2>
        <label class="field">
          <span>Id (for @auth)</span>
          <input id="profileId" type="text" autocomplete="off" spellcheck="false" aria-label="Authentication id" />
        </label>
        <label class="field">
          <span>Method</span>
          <select id="providerId" aria-label="Authentication method">
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
      </section>

      <section class="detail-section">
        <div class="section-header">
          <h2>Credentials</h2>
        </div>
        <p class="hint">Secrets stay in VS Code Secret Storage. Cleartext exists only while editing; Save stores and clears the field.</p>
        <div id="secretList" class="secret-list"></div>
        <p id="noSecrets" class="empty" hidden>This method does not require credential fields.</p>
      </section>

      <section class="detail-section">
        <div class="section-header">
          <h2>Session</h2>
        </div>
        <div id="sessionSummary" class="session-box hint">No session yet.</div>
      </section>

      <section class="detail-section">
        <div class="section-header">
          <h2>Health</h2>
        </div>
        <div id="healthPanel" class="session-box hint">Never tested.</div>
        <div id="testResultPanel" class="test-result" hidden></div>
      </section>

      <section class="detail-section preview">
        <div class="section-header">
          <h2>Preview</h2>
          <button type="button" id="copyHeaderName" class="ghost" hidden>Copy header name</button>
        </div>
        <pre id="authPreview" class="preview-box" aria-live="polite">Select Authentication to preview.</pre>
        <p id="validationHint" class="hint" hidden></p>
      </section>

      <section class="detail-section">
        <div class="section-header">
          <h2>Actions</h2>
        </div>
        <div class="table-toolbar auth-actions">
          <button type="button" id="testAuth" class="secondary">Test</button>
          <button type="button" id="runLogin" class="secondary">Run Login</button>
          <button type="button" id="save" class="primary">Save</button>
          <button type="button" id="deleteProfileFooter" class="danger">Delete</button>
        </div>
        <label class="field" id="testUrlField">
          <span>Test URL (optional)</span>
          <input id="testUrl" type="text" autocomplete="off" placeholder="https://api.example.com/me" />
        </label>
      </section>
    </section>
    <p id="error" class="error" hidden></p>
    <footer>
      <span id="dirtyHint" class="hint" hidden>Unsaved changes</span>
      <button type="button" id="saveFooter" class="primary">Save</button>
    </footer>
  </main>
</div>

<dialog id="templateDialog" class="ah-dialog">
  <form method="dialog" id="templateForm">
    <h2>New Authentication</h2>
    <p class="hint">Choose a template. OAuth is not available yet.</p>
    <div class="template-grid" role="listbox" aria-label="Templates">
      <button type="submit" class="template-card" value="bearer" data-template="bearer"><strong>Bearer Token</strong><span>Authorization: Bearer</span></button>
      <button type="submit" class="template-card" value="apiKeyHeader" data-template="apiKeyHeader"><strong>API Key Header</strong><span>Custom header</span></button>
      <button type="submit" class="template-card" value="apiKeyQuery" data-template="apiKeyQuery"><strong>API Key Query</strong><span>Query parameter</span></button>
      <button type="submit" class="template-card" value="basic" data-template="basic"><strong>Basic Auth</strong><span>Username + password</span></button>
      <button type="submit" class="template-card" value="jwtLogin" data-template="jwtLogin"><strong>JWT Login</strong><span>Login API → Bearer session</span></button>
      <button type="button" class="template-card disabled" disabled title="Coming soon"><strong>OAuth</strong><span>Coming soon</span></button>
      <button type="submit" class="template-card" value="custom" data-template="custom"><strong>Custom</strong><span>Pick method manually</span></button>
    </div>
    <div class="dialog-actions">
      <button type="submit" value="cancel" class="ghost">Cancel</button>
    </div>
  </form>
</dialog>

<dialog id="loginWizard" class="ah-dialog wide">
  <div class="wizard">
    <h2>Login API</h2>
    <p id="wizardStepLabel" class="hint">Step 1 of 7 — Login Request</p>
    <div id="wizardStep1" class="wizard-step">
      <label class="field"><span>Method</span>
        <select id="loginMethod"><option>POST</option><option>PUT</option><option>PATCH</option><option>GET</option></select>
      </label>
      <label class="field"><span>URL</span>
        <input id="loginUrl" type="text" placeholder="https://api.example.com/auth/login" autocomplete="off" />
      </label>
      <label class="field"><span>Body template</span>
        <textarea id="loginBody" rows="4" spellcheck="false">{"username":"{{loginUsername}}","password":"{{loginPassword}}"}</textarea>
      </label>
    </div>
    <div id="wizardStep2" class="wizard-step" hidden>
      <label class="field"><span>Username</span>
        <input id="loginUsername" type="text" autocomplete="off" />
      </label>
      <label class="field"><span>Password</span>
        <input id="loginPassword" type="password" autocomplete="off" />
      </label>
      <p class="hint">Posted to Secret Storage when you Run Login — never kept in webview state after the run.</p>
    </div>
    <div id="wizardStep3" class="wizard-step" hidden>
      <p class="hint">Ready to call the Login API via the Request Engine.</p>
      <button type="button" id="wizardRunLogin" class="primary">Run Login</button>
      <p id="wizardRunStatus" class="hint" aria-live="polite"></p>
    </div>
    <div id="wizardStep4" class="wizard-step" hidden>
      <pre id="wizardResponseSummary" class="preview-box">—</pre>
    </div>
    <div id="wizardStep5" class="wizard-step" hidden>
      <p class="hint">Choose which token fields to apply to the Session.</p>
      <div id="wizardTokenList" class="token-list"></div>
    </div>
    <div id="wizardStep6" class="wizard-step" hidden>
      <p id="wizardOverwriteWarn" class="cta" hidden>A Session already exists for this Authentication. Creating a new Session will replace stored access/refresh tokens.</p>
      <label id="wizardOverwriteConfirmRow" class="field" hidden>
        <span><input type="checkbox" id="wizardOverwriteConfirm" /> I understand — overwrite the existing Session</span>
      </label>
      <button type="button" id="wizardCreateSession" class="primary">Create Session</button>
    </div>
    <div id="wizardStep7" class="wizard-step" hidden>
      <p id="wizardDone" class="hint">Done.</p>
    </div>
    <div class="dialog-actions">
      <button type="button" id="wizardBack" class="ghost">Back</button>
      <button type="button" id="wizardNext" class="primary">Next</button>
      <button type="button" id="wizardClose" class="secondary">Close</button>
    </div>
  </div>
</dialog>

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
    ...(typeof record.focusSecretField === 'string'
      ? { focusSecretField: record.focusSecretField }
      : {}),
    ...(record.openLoginWizard === true ? { openLoginWizard: true } : {}),
  };
}

function parseLoginConfig(value: unknown): AuthManagerLoginConfig | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  if (
    typeof value.method !== 'string' ||
    typeof value.url !== 'string' ||
    value.url.trim().length === 0 ||
    (value.sendAs !== 'bearer' && value.sendAs !== 'apiKey')
  ) {
    return undefined;
  }
  return {
    method: value.method,
    url: value.url,
    sendAs: value.sendAs,
    ...(typeof value.bodyTemplate === 'string'
      ? { bodyTemplate: value.bodyTemplate }
      : {}),
    ...(typeof value.contentType === 'string'
      ? { contentType: value.contentType }
      : {}),
    ...(typeof value.tokenPath === 'string' ? { tokenPath: value.tokenPath } : {}),
    ...(typeof value.refreshTokenPath === 'string'
      ? { refreshTokenPath: value.refreshTokenPath }
      : {}),
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
    const credentialSources = parseCredentialSources(record.credentialSources);
    if (credentialSources === undefined) {
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
    const login =
      record.login === undefined ? undefined : parseLoginConfig(record.login);
    if (record.login !== undefined && login === undefined) {
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
      ...(credentialSources.length > 0 ? { credentialSources } : {}),
      ...(typeof record.healthLabel === 'string'
        ? { healthLabel: record.healthLabel }
        : {}),
      ...(typeof record.healthDetail === 'string'
        ? { healthDetail: record.healthDetail }
        : {}),
      ...(typeof record.healthStatus === 'string'
        ? { healthStatus: record.healthStatus }
        : {}),
      ...(record.sessionAccessTokenPresent === true
        ? { sessionAccessTokenPresent: true }
        : {}),
      ...(record.sessionRefreshTokenPresent === true
        ? { sessionRefreshTokenPresent: true }
        : {}),
      ...(typeof record.sessionExpiresAt === 'string'
        ? { sessionExpiresAt: record.sessionExpiresAt }
        : {}),
      ...(typeof record.lastTestSummary === 'string'
        ? { lastTestSummary: record.lastTestSummary }
        : {}),
      ...(login !== undefined ? { login } : {}),
      ...(record.loginUsernameStatus === 'set' ||
      record.loginUsernameStatus === 'missing'
        ? { loginUsernameStatus: record.loginUsernameStatus }
        : {}),
      ...(record.loginPasswordStatus === 'set' ||
      record.loginPasswordStatus === 'missing'
        ? { loginPasswordStatus: record.loginPasswordStatus }
        : {}),
    });
  }
  return profiles;
}

function parseCredentialSources(
  value: unknown,
): readonly AuthManagerCredentialSource[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources: AuthManagerCredentialSource[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.field !== 'string' ||
      typeof record.label !== 'string' ||
      typeof record.detail !== 'string' ||
      (record.kind !== 'variable' && record.kind !== 'literal')
    ) {
      return undefined;
    }
    sources.push({
      field: record.field,
      label: record.label,
      kind: record.kind,
      detail: record.detail,
    });
  }
  return sources;
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
${WEBVIEW_SHARED_CSS}
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
  grid-template-columns: minmax(220px, 280px) 1fr;
  min-height: 100vh;
}
aside {
  border-right: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  padding: var(--ah-space-3);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.aside-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
h1 { margin: 0; font-size: 13px; font-weight: 600; }
h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; }
.profile-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 2px; flex: 1; overflow: auto;
}
.profile-item {
  display: block; width: 100%; text-align: left; border: none; border-radius: var(--ah-radius);
  padding: 8px 10px; color: var(--vscode-foreground); background: transparent;
  cursor: pointer; font: inherit;
}
.profile-item:hover { background: var(--vscode-list-hoverBackground); }
.profile-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.profile-item .name { display: block; font-weight: 600; }
.profile-item .meta {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; align-items: center;
}
.profile-item .chip {
  font-size: 10px; padding: 1px 6px; border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-panel-border); background: var(--vscode-input-background);
}
.profile-item .chip.warn {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-panel-border));
}
.profile-item .chip.ok {
  border-color: var(--vscode-focusBorder);
}
main {
  padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 14px; min-width: 0;
}
.main-header { display: flex; flex-direction: column; gap: 8px; }
.title-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#profileLabel { flex: 1 1 220px; min-width: 160px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.detail-section {
  padding: 12px 0; border-top: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
}
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.field span { color: var(--vscode-descriptionForeground); font-size: .9em; }
input[type="text"], input[type="password"], input[type="search"], select, textarea {
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 6px 8px; border-radius: var(--ah-radius); font: inherit;
}
textarea { font-family: var(--vscode-editor-font-family); resize: vertical; }
input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}
.api-key-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.badge {
  align-self: flex-start; margin: 0; padding: 2px 8px; border-radius: var(--ah-radius);
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: .85em;
}
.hint { margin: 0; color: var(--vscode-descriptionForeground); }
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.secret-list, .token-list { display: flex; flex-direction: column; gap: 8px; }
.secret-row {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 8px 10px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  border-radius: var(--ah-radius);
}
.secret-row .label { font-weight: 600; min-width: 100px; }
.secret-row .status { flex: 1; color: var(--vscode-descriptionForeground); }
.secret-row .status.missing {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground)); font-weight: 600;
}
.secret-row input.secret-edit { flex: 1 1 160px; min-width: 140px; }
.session-box, .test-result {
  padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius);
  background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
  white-space: pre-wrap; word-break: break-word;
}
.test-result.fail {
  border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
}
.cta {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 8px 0;
  padding: 10px 12px; border-radius: var(--ah-radius);
  background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
}
.empty { margin: 8px 0 0; color: var(--vscode-descriptionForeground); }
.error { margin: 0; color: var(--vscode-errorForeground, var(--vscode-editorError-foreground)); }
footer {
  display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: auto;
  padding-top: 8px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
}
.search-field input { width: 100%; }
.preview-box {
  margin: 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border);
  border-radius: var(--ah-radius);
  background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
  font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
  white-space: pre-wrap; word-break: break-word;
}
.ah-dialog {
  border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  color: var(--vscode-foreground); padding: 16px; max-width: 520px; width: calc(100% - 32px);
}
.ah-dialog.wide { max-width: 640px; }
.ah-dialog::backdrop { background: rgba(0,0,0,.35); }
.template-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;
}
.template-card {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left;
  padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius);
  background: var(--vscode-input-background); color: inherit; cursor: pointer; font: inherit;
}
.template-card:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.template-card.disabled, .template-card:disabled { opacity: .55; cursor: not-allowed; }
.template-card span { color: var(--vscode-descriptionForeground); font-size: 11px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.wizard-step { margin: 12px 0; }
@media (max-width: 720px) {
  #app { grid-template-columns: 1fr; }
  aside { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); }
  .api-key-fields, .template-grid { grid-template-columns: 1fr; }
}
`;

const AUTH_MANAGER_SECRET_META = {
  none: coreSecretFieldsForProvider('none'),
  bearer: coreSecretFieldsForProvider('bearer'),
  basic: coreSecretFieldsForProvider('basic'),
  apiKey: coreSecretFieldsForProvider('apiKey'),
} as const;

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
const SECRET_MASK = ${JSON.stringify(AUTHENTICATION_SECRET_FIELD_MASK)};
const SECRET_META = ${JSON.stringify(AUTH_MANAGER_SECRET_META)};
const PREVIEW_COPY = ${JSON.stringify(AUTH_MANAGER_PREVIEW_COPY)};

let state = { profiles: [], defaultProfileId: undefined, selectedId: undefined };
let dirty = false;
let profileFilter = '';
let originalSelectedId;
/** @type {Record<string, string>} ephemeral edit buffers — cleared after save */
const secretEditBuffers = Object.create(null);
/** @type {Record<string, boolean>} */
const secretReveal = Object.create(null);
/** @type {any} */
let lastTestResult = null;
/** @type {any} */
let lastLoginResult = null;
let wizardStep = 1;
let pendingAccessPath = '';
let pendingRefreshPath = '';
let openLoginAfterCreate = false;

const el = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing #' + id);
  return node;
};

function post(message) { vscode.postMessage(message); }

function showError(message) {
  const node = el('error');
  if (!message) { node.hidden = true; node.textContent = ''; return; }
  node.hidden = false;
  node.textContent = message;
}

function setDirty(value) {
  dirty = value;
  el('dirtyHint').hidden = !value;
}

function secretMeta(providerId) { return SECRET_META[providerId] || []; }

function allocateId(name) {
  const existing = new Set(state.profiles.map((entry) => entry.id));
  const base = String(name || 'authentication').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'authentication';
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(base + '-' + suffix)) suffix += 1;
  return base + '-' + suffix;
}

function selectedProfile() {
  return state.profiles.find((entry) => entry.id === state.selectedId);
}

function bufferKey(profileId, field) { return profileId + '::' + field; }

function syncSecretFields(profile) {
  const meta = secretMeta(profile.providerId);
  const previous = new Map((profile.secretFields || []).map((entry) => [entry.field, entry.status]));
  return meta.map((entry) => ({
    field: entry.field, label: entry.label, status: previous.get(entry.field) || 'missing',
  }));
}

function methodLabel(providerId, profile) {
  if (providerId === 'apiKey') {
    return profile && profile.apiKeyLocation === 'query' ? 'API Key · Query' : 'API Key · Header';
  }
  if (providerId === 'bearer') return 'Bearer';
  if (providerId === 'basic') return 'Basic';
  if (providerId === 'none') return 'None';
  return providerId;
}

function healthChipClass(label) {
  if (!label) return '';
  if (/missing|unauthorized|expired|needs login/i.test(label)) return 'warn';
  if (/healthy|expires in/i.test(label)) return 'ok';
  return '';
}

function renderList() {
  const list = el('profileList');
  list.innerHTML = '';
  const query = profileFilter.trim().toLowerCase();
  let visibleCount = 0;
  for (const profile of state.profiles) {
    const haystack = ((profile.label || '') + ' ' + (profile.id || '') + ' ' + (profile.providerId || '')).toLowerCase();
    if (query && !haystack.includes(query)) continue;
    visibleCount += 1;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'profile-item' + (state.selectedId === profile.id ? ' active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', state.selectedId === profile.id ? 'true' : 'false');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = profile.label || profile.id;
    item.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const method = document.createElement('span');
    method.className = 'chip';
    method.textContent = methodLabel(profile.providerId, profile);
    meta.appendChild(method);
    const health = document.createElement('span');
    health.className = 'chip ' + healthChipClass(profile.healthLabel);
    health.textContent = profile.healthLabel || 'Never tested';
    meta.appendChild(health);
    if (profile.sessionExpiresAt) {
      const exp = document.createElement('span');
      exp.className = 'chip';
      exp.textContent = 'Expires ' + profile.sessionExpiresAt;
      meta.appendChild(exp);
    }
    item.appendChild(meta);
    item.addEventListener('click', () => {
      readEditorIntoState();
      state = { ...state, selectedId: profile.id };
      lastTestResult = null;
      render();
    });
    list.appendChild(item);
  }
  if (visibleCount === 0 && state.profiles.length > 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No matching Authentication.';
    list.appendChild(empty);
  }
}

function buildAuthPreview(profile) {
  const missing = (profile.secretFields || []).filter((field) => field.status === 'missing');
  if (profile.providerId === 'none') return PREVIEW_COPY.none;
  if (profile.providerId === 'bearer') {
    return missing.length > 0 ? PREVIEW_COPY.bearerMissing : PREVIEW_COPY.bearerReady;
  }
  if (profile.providerId === 'basic') {
    return {
      preview: PREVIEW_COPY.basicPreview,
      validation: missing.length > 0
        ? PREVIEW_COPY.basicMissingPrefix + missing.map((field) => field.label).join(', ') + PREVIEW_COPY.basicMissingSuffix
        : PREVIEW_COPY.basicReadyValidation,
      headerNames: ['Authorization'],
    };
  }
  if (profile.providerId === 'apiKey') {
    const name = (profile.apiKeyName || 'X-API-Key').trim() || 'X-API-Key';
    const location = profile.apiKeyLocation === 'query' ? 'query' : 'header';
    return {
      preview: location === 'query' ? 'Query: ' + name + '=' + MASK : name + ': ' + MASK,
      validation: missing.length > 0
        ? PREVIEW_COPY.apiKeySecretMissing
        : (!profile.apiKeyName || !profile.apiKeyName.trim()
          ? PREVIEW_COPY.apiKeyNameEmpty
          : PREVIEW_COPY.apiKeyReady),
      headerNames: location === 'header' ? [name] : [],
    };
  }
  return PREVIEW_COPY.unknown;
}

function renderSecrets(profile) {
  const list = el('secretList');
  list.innerHTML = '';
  const fields = profile.secretFields || [];
  const credentialSources = profile.credentialSources || [];
  el('noSecrets').hidden = fields.length > 0 || credentialSources.length > 0;
  for (const field of fields) {
    const key = bufferKey(profile.id, field.field);
    const editing = Object.prototype.hasOwnProperty.call(secretEditBuffers, key);
    const row = document.createElement('div');
    row.className = 'secret-row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = field.label;
    row.appendChild(label);
    if (editing) {
      const input = document.createElement('input');
      input.className = 'secret-edit';
      input.type = secretReveal[key] ? 'text' : 'password';
      input.autocomplete = 'off';
      input.value = secretEditBuffers[key] || '';
      input.placeholder = 'Enter ' + field.label;
      input.addEventListener('input', () => { secretEditBuffers[key] = input.value; });
      row.appendChild(input);
      const showBtn = document.createElement('button');
      showBtn.type = 'button';
      showBtn.className = 'ghost';
      showBtn.textContent = secretReveal[key] ? 'Hide' : 'Show';
      showBtn.addEventListener('click', () => {
        secretReveal[key] = !secretReveal[key];
        renderSecrets(selectedProfile());
      });
      row.appendChild(showBtn);
      const pasteBtn = document.createElement('button');
      pasteBtn.type = 'button';
      pasteBtn.className = 'secondary';
      pasteBtn.textContent = 'Paste';
      pasteBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          secretEditBuffers[key] = text || '';
          renderSecrets(selectedProfile());
        } catch (err) {
          showError('Unable to read clipboard.');
        }
      });
      row.appendChild(pasteBtn);
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'primary';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => {
        const value = secretEditBuffers[key] || '';
        post({ type: 'storeSecret', profileId: profile.id, field: field.field, value });
        delete secretEditBuffers[key];
        delete secretReveal[key];
      });
      row.appendChild(saveBtn);
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ghost';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        delete secretEditBuffers[key];
        delete secretReveal[key];
        renderSecrets(selectedProfile());
      });
      row.appendChild(cancelBtn);
    } else {
      const status = document.createElement('span');
      status.className = 'status' + (field.status === 'missing' ? ' missing' : '');
      status.textContent = field.status === 'set' ? SECRET_MASK + ' · Set' : 'Missing';
      row.appendChild(status);
      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'primary';
      replaceBtn.textContent = field.status === 'set' ? 'Replace' : 'Set';
      replaceBtn.addEventListener('click', () => {
        secretEditBuffers[key] = '';
        renderSecrets(selectedProfile());
        const input = row.parentElement && row.parentElement.querySelector('input.secret-edit');
        if (input) input.focus();
      });
      row.appendChild(replaceBtn);
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'secondary';
      clearBtn.textContent = 'Clear';
      clearBtn.disabled = field.status !== 'set';
      clearBtn.addEventListener('click', () => {
        post({ type: 'clearSecret', profileId: profile.id, field: field.field });
      });
      row.appendChild(clearBtn);
    }
    list.appendChild(row);
  }
  for (const source of credentialSources) {
    const row = document.createElement('div');
    row.className = 'secret-row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = source.label;
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = source.kind === 'variable'
      ? 'Variable: {{' + source.detail + '}}'
      : 'Literal (configured)';
    row.appendChild(label);
    row.appendChild(status);
    list.appendChild(row);
  }
}

function renderSession(profile) {
  const parts = [];
  if (profile.sessionAccessTokenPresent) parts.push('Access token: set');
  if (profile.sessionRefreshTokenPresent) parts.push('Refresh token: set');
  if (profile.sessionExpiresAt) parts.push('Expires: ' + profile.sessionExpiresAt);
  if (profile.login && profile.login.url) parts.push('Login API: ' + profile.login.method + ' ' + profile.login.url);
  if (profile.lastTestSummary) parts.push('Last test: ' + profile.lastTestSummary);
  el('sessionSummary').textContent = parts.length > 0 ? parts.join('\\n') : 'No session yet.';
}

function renderTestResult() {
  const panel = el('testResultPanel');
  if (!lastTestResult || lastTestResult.profileId !== state.selectedId) {
    panel.hidden = true;
    panel.textContent = '';
    return;
  }
  const r = lastTestResult.result;
  panel.hidden = false;
  panel.className = 'test-result' + (r.ok ? '' : ' fail');
  const lines = [];
  if (r.url) lines.push('Request URL: ' + r.url);
  if (r.statusCode !== undefined) lines.push('Response Status: ' + r.statusCode);
  if (r.identity) lines.push('Identity: ' + r.identity);
  if (r.expiresAt) lines.push('Token Expiry: ' + r.expiresAt);
  if (r.latencyMs !== undefined) lines.push('Latency: ' + r.latencyMs + 'ms');
  if (r.rateLimitRemaining) {
    lines.push(r.rateLimitLimit
      ? 'Rate Limit: ' + r.rateLimitRemaining + ' / ' + r.rateLimitLimit
      : 'Rate Limit Remaining: ' + r.rateLimitRemaining);
  }
  if (r.lastSuccessfulTestAt) lines.push('Last Successful Test: ' + r.lastSuccessfulTestAt);
  if (r.error) lines.push('Failure: ' + r.error);
  if (r.summary) lines.push(r.summary);
  panel.textContent = lines.join('\\n');
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
  state = { ...state, profiles, defaultProfileId, selectedId: next.id };
  originalSelectedId = next.id;
}

function renderEditor() {
  const profile = selectedProfile();
  const hasSelection = !!profile;
  el('editor').hidden = !hasSelection;
  el('emptyState').hidden = state.profiles.length > 0;
  el('setDefault').disabled = !hasSelection;
  el('deleteProfile').disabled = !hasSelection;
  el('deleteProfileFooter').disabled = !hasSelection;
  el('duplicateProfile').disabled = !hasSelection;
  el('profileLabel').disabled = !hasSelection;
  if (!profile) {
    el('defaultBadge').hidden = true;
    el('authPreview').textContent = 'Select Authentication to preview.';
    el('validationHint').hidden = true;
    el('copyHeaderName').hidden = true;
    el('testResultPanel').hidden = true;
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
  el('methodChipValue').textContent = methodLabel(profile.providerId, profile);
  el('healthChipValue').textContent = profile.healthLabel || 'Never tested';
  const detail = el('healthDetail');
  if (profile.healthDetail) {
    detail.hidden = false;
    detail.textContent = profile.healthDetail;
  } else {
    detail.hidden = true;
  }
  el('healthPanel').textContent = profile.healthDetail
    ? (profile.healthLabel + ' — ' + profile.healthDetail)
    : (profile.healthLabel || 'Never tested');
  el('testAuth').disabled = profile.providerId === 'none';
  el('runLogin').disabled = profile.providerId === 'none';
  if (profile.login && profile.login.url && !el('testUrl').value) {
    el('testUrl').value = profile.login.url;
  }
  renderSecrets(profile);
  renderSession(profile);
  renderTestResult();
  const preview = buildAuthPreview(profile);
  el('authPreview').textContent = preview.preview;
  const hint = el('validationHint');
  if (preview.validation) {
    hint.hidden = false;
    hint.textContent = preview.validation;
  } else {
    hint.hidden = true;
  }
  const names = preview.headerNames || [];
  const copyBtn = el('copyHeaderName');
  if (names.length > 0) {
    copyBtn.hidden = false;
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(names[0]);
        copyBtn.textContent = 'Copied name';
        setTimeout(() => { copyBtn.textContent = 'Copy header name'; }, 1200);
      } catch (err) {
        showError('Unable to copy header name.');
      }
    };
  } else {
    copyBtn.hidden = true;
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

function createFromTemplate(template) {
  readEditorIntoState();
  let providerId = 'bearer';
  let label = 'Bearer Token';
  let apiKeyName;
  let apiKeyLocation;
  let openLogin = false;
  if (template === 'apiKeyHeader') {
    providerId = 'apiKey'; label = 'API Key Header'; apiKeyName = 'X-API-Key'; apiKeyLocation = 'header';
  } else if (template === 'apiKeyQuery') {
    providerId = 'apiKey'; label = 'API Key Query'; apiKeyName = 'api_key'; apiKeyLocation = 'query';
  } else if (template === 'basic') {
    providerId = 'basic'; label = 'Basic Auth';
  } else if (template === 'jwtLogin') {
    providerId = 'bearer'; label = 'JWT Login'; openLogin = true;
  } else if (template === 'custom' || template === 'none') {
    providerId = 'none'; label = 'Custom Authentication';
  } else if (template === 'bearer') {
    providerId = 'bearer'; label = 'Bearer Token';
  }
  const id = allocateId(label);
  const profile = {
    id, label, providerId,
    secretFields: secretMeta(providerId).map((entry) => ({
      field: entry.field, label: entry.label, status: 'missing',
    })),
  };
  if (apiKeyName) profile.apiKeyName = apiKeyName;
  if (apiKeyLocation) profile.apiKeyLocation = apiKeyLocation;
  if (openLogin) {
    profile.login = {
      method: 'POST',
      url: '',
      bodyTemplate: '{"username":"{{loginUsername}}","password":"{{loginPassword}}"}',
      contentType: 'application/json',
      sendAs: 'bearer',
    };
  }
  state = { ...state, profiles: state.profiles.concat([profile]), selectedId: id };
  setDirty(true);
  openLoginAfterCreate = openLogin;
  render();
  if (openLogin) {
    openWizard();
  }
}

function openWizard() {
  const profile = selectedProfile();
  if (!profile) return;
  wizardStep = 1;
  lastLoginResult = null;
  const login = profile.login || {};
  el('loginMethod').value = login.method || 'POST';
  el('loginUrl').value = login.url || '';
  el('loginBody').value = login.bodyTemplate || '{"username":"{{loginUsername}}","password":"{{loginPassword}}"}';
  el('loginUsername').value = '';
  el('loginPassword').value = '';
  showWizardStep();
  el('loginWizard').showModal();
}

function showWizardStep() {
  for (let i = 1; i <= 7; i += 1) {
    el('wizardStep' + i).hidden = i !== wizardStep;
  }
  el('wizardStepLabel').textContent = 'Step ' + wizardStep + ' of 7';
  el('wizardBack').disabled = wizardStep <= 1;
  el('wizardNext').textContent = wizardStep >= 7 ? 'Done' : 'Next';
  if (wizardStep === 5 && lastLoginResult) {
    renderTokenList(lastLoginResult.result);
  }
  if (wizardStep === 6 && lastLoginResult) {
    const exists = !!lastLoginResult.result.sessionExists;
    el('wizardOverwriteWarn').hidden = !exists;
    el('wizardOverwriteConfirmRow').hidden = !exists;
    if (!exists) {
      el('wizardOverwriteConfirm').checked = false;
    }
  }
  if (wizardStep === 7) {
    const identity = lastLoginResult && lastLoginResult.result.identity
      ? (' Identity: ' + lastLoginResult.result.identity)
      : '';
    el('wizardDone').textContent = 'Session created.' + identity;
  }
}

function renderTokenList(result) {
  const list = el('wizardTokenList');
  list.innerHTML = '';
  const candidates = (result && result.candidates) || [];
  if (candidates.length === 0) {
    list.textContent = 'No token fields detected.';
    return;
  }
  for (const candidate of candidates) {
    const row = document.createElement('label');
    row.className = 'secret-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'accessToken';
    radio.value = candidate.path;
    if (!pendingAccessPath && (candidate.kind === 'access_token' || candidate.kind === 'generic_token' || candidate.kind === 'id_token')) {
      pendingAccessPath = candidate.path;
    }
    radio.checked = pendingAccessPath === candidate.path;
    radio.addEventListener('change', () => { pendingAccessPath = candidate.path; });
    const text = document.createElement('span');
    text.textContent = candidate.path + ' (' + candidate.kind + ')';
    row.appendChild(radio);
    row.appendChild(text);
    if (candidate.kind === 'refresh_token') {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = pendingRefreshPath === candidate.path;
      check.addEventListener('change', () => {
        pendingRefreshPath = check.checked ? candidate.path : '';
      });
      row.appendChild(check);
      const refreshLabel = document.createElement('span');
      refreshLabel.textContent = 'use as refresh';
      row.appendChild(refreshLabel);
    }
    list.appendChild(row);
  }
}

function currentLoginConfig() {
  return {
    method: el('loginMethod').value,
    url: el('loginUrl').value.trim(),
    bodyTemplate: el('loginBody').value,
    contentType: 'application/json',
    sendAs: 'bearer',
  };
}

el('addProfile').addEventListener('click', () => {
  el('templateDialog').showModal();
});

el('templateForm').addEventListener('submit', (event) => {
  const submitter = event.submitter;
  const value = submitter && submitter.value ? submitter.value : 'cancel';
  if (value && value !== 'cancel') {
    createFromTemplate(value);
  }
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
    ...source, id, label,
    secretFields: (source.secretFields || []).map((field) => ({ ...field, status: 'missing' })),
  };
  state = { ...state, profiles: state.profiles.concat([profile]), selectedId: id };
  setDirty(true);
  render();
});

function deleteSelected() {
  const profile = selectedProfile();
  if (!profile) return;
  const profiles = state.profiles.filter((entry) => entry.id !== profile.id);
  state = {
    ...state, profiles,
    defaultProfileId: state.defaultProfileId === profile.id ? undefined : state.defaultProfileId,
    selectedId: profiles[0] ? profiles[0].id : undefined,
  };
  setDirty(true);
  render();
}
el('deleteProfile').addEventListener('click', deleteSelected);
el('deleteProfileFooter').addEventListener('click', deleteSelected);

el('setDefault').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile) return;
  readEditorIntoState();
  post({ type: 'setDefault', profileId: selectedProfile().id });
});

el('testAuth').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile) return;
  const testUrl = el('testUrl').value.trim();
  post({ type: 'testAuth', profileId: profile.id, ...(testUrl ? { testUrl } : {}) });
});

el('runLogin').addEventListener('click', () => openWizard());

el('save').addEventListener('click', () => { showError(''); commitState(); });
el('saveFooter').addEventListener('click', () => { showError(''); commitState(); });

function closeLoginWizard() {
  const profile = selectedProfile();
  el('loginUsername').value = '';
  el('loginPassword').value = '';
  el('wizardOverwriteConfirm').checked = false;
  if (profile) {
    post({ type: 'cancelLoginWizard', profileId: profile.id });
  }
  el('loginWizard').close();
}

el('wizardClose').addEventListener('click', () => {
  closeLoginWizard();
});

el('wizardBack').addEventListener('click', () => {
  if (wizardStep > 1) { wizardStep -= 1; showWizardStep(); }
});

el('wizardNext').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile) return;
  if (wizardStep === 1) {
    const login = currentLoginConfig();
    if (!login.url) { showError('Login URL is required.'); return; }
    post({ type: 'saveLoginConfig', profileId: profile.id, login });
    wizardStep = 2; showWizardStep(); return;
  }
  if (wizardStep === 2) {
    wizardStep = 3; showWizardStep(); return;
  }
  if (wizardStep === 3) {
    return;
  }
  if (wizardStep === 4) { wizardStep = 5; showWizardStep(); return; }
  if (wizardStep === 5) {
    if (!pendingAccessPath) { showError('Choose an access token field.'); return; }
    wizardStep = 6; showWizardStep(); return;
  }
  if (wizardStep === 6) { return; }
  if (wizardStep >= 7) {
    el('loginUsername').value = '';
    el('loginPassword').value = '';
    el('wizardOverwriteConfirm').checked = false;
    el('loginWizard').close();
  }
});

el('wizardRunLogin').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile) return;
  const username = el('loginUsername').value;
  const password = el('loginPassword').value;
  el('wizardRunStatus').textContent = 'Running…';
  post({
    type: 'runLogin',
    profileId: profile.id,
    login: currentLoginConfig(),
    username,
    password,
  });
  el('loginUsername').value = '';
  el('loginPassword').value = '';
});

el('wizardCreateSession').addEventListener('click', () => {
  const profile = selectedProfile();
  if (!profile || !pendingAccessPath) return;
  const sessionExists = !!(lastLoginResult && lastLoginResult.result.sessionExists);
  if (sessionExists) {
    const checked = el('wizardOverwriteConfirm').checked;
    if (!checked) {
      const ok = window.confirm(
        'A Session already exists. Overwrite stored token material?',
      );
      if (!ok) {
        return;
      }
    }
  }
  post({
    type: 'applyLoginTokens',
    profileId: profile.id,
    accessTokenPath: pendingAccessPath,
    ...(pendingRefreshPath ? { refreshTokenPath: pendingRefreshPath } : {}),
    // Explicit confirm only when a session already exists; otherwise allow create.
    confirmOverwrite: true,
  });
  wizardStep = 7;
  showWizardStep();
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
          secretFields: syncSecretFields({ ...profile, providerId: el('providerId').value }),
        };
        state = {
          ...state,
          profiles: state.profiles.map((entry) => entry.id === profile.id ? next : entry),
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
    if (state.focusSecretField && state.selectedId) {
      const key = bufferKey(state.selectedId, state.focusSecretField);
      secretEditBuffers[key] = '';
      renderSecrets(selectedProfile());
    }
    if (state.openLoginWizard || openLoginAfterCreate) {
      openLoginAfterCreate = false;
      openWizard();
    }
    return;
  }
  if (message.type === 'error') {
    showError(message.message || 'Unable to save Authentication.');
    return;
  }
  if (message.type === 'testResult') {
    lastTestResult = message;
    renderTestResult();
    return;
  }
  if (message.type === 'loginResult') {
    lastLoginResult = message;
    el('wizardRunStatus').textContent = message.result.ok ? 'Login succeeded.' : (message.result.error || 'Login failed.');
    if (message.result.ok) {
      const lines = [];
      if (message.result.statusCode !== undefined) lines.push('Status: ' + message.result.statusCode);
      if (message.result.latencyMs !== undefined) lines.push('Latency: ' + message.result.latencyMs + 'ms');
      if (message.result.identity) lines.push('Identity: ' + message.result.identity);
      lines.push(message.result.summary || '');
      lines.push('(Token values masked — paths only shown next.)');
      el('wizardResponseSummary').textContent = lines.filter(Boolean).join('\\n');
      wizardStep = 4;
      showWizardStep();
    }
  }
});

post({ type: 'ready' });
`;
