/**
 * Secret-free Authentication UI view model shared by Request Editor,
 * Collection Auth, and Collection Run Setup.
 * Presentation only — does not change resolver precedence or providers.
 * No `vscode` import.
 */

import type {
  AuthenticationProfile,
  AuthenticationValueSource,
} from '../../models';
import { escapeHtml } from '../../ui/webview';
import {
  AUTHENTICATION_PRESENTATION_MASK,
  buildAuthenticationPresentationPreview,
  type AuthenticationPresentationPreview,
  type AuthenticationPresentationSecretField,
} from '../authentication-presentation-preview';
import { secretFieldsForProvider } from '../authentication-profile-validation';
import {
  explainAuthenticationResolution,
  type ExplainAuthenticationResolutionResult,
} from '../explain-authentication-resolution';

/** Implemented live Authentication kinds shown in Type dropdowns. */
export const AUTHENTICATION_UI_KINDS = [
  'none',
  'bearer',
  'basic',
  'apiKey',
] as const;

export type AuthenticationUiKind = (typeof AUTHENTICATION_UI_KINDS)[number];

/** User-facing Type labels. OAuth is intentionally absent. */
export const AUTHENTICATION_UI_KIND_LABELS: Record<AuthenticationUiKind, string> =
  {
    none: 'No Auth',
    bearer: 'Bearer Token',
    basic: 'Basic Auth',
    apiKey: 'API Key',
  };

export type AuthenticationUiSurface = 'request' | 'collection' | 'run-setup';

export type AuthenticationUiFieldSourceKind =
  | 'variable'
  | 'secret'
  | 'literal'
  | 'empty'
  | 'metadata';

/** One credential/metadata row shown in the Auth section (never plaintext secrets). */
export interface AuthenticationUiField {
  readonly name: string;
  readonly label: string;
  readonly display: string;
  readonly sourceKind: AuthenticationUiFieldSourceKind;
}

/** Secret-free profile row for Saved Authentication dropdowns. */
export interface AuthenticationUiProfileSummary {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: 'header' | 'query';
  readonly fields: readonly AuthenticationUiField[];
}

export type AuthenticationUiAddToId =
  | 'authorization-header'
  | 'header'
  | 'query';

export interface AuthenticationUiAddToOption {
  readonly id: AuthenticationUiAddToId;
  readonly label: string;
  readonly readOnly: boolean;
}

/** Secret-free view model for all Authentication UI surfaces. */
export interface AuthenticationUiState {
  readonly surface: AuthenticationUiSurface;
  readonly selectedKind: AuthenticationUiKind;
  readonly availableKinds: readonly AuthenticationUiKind[];
  readonly inheriting: boolean;
  readonly canInherit: boolean;
  readonly override: boolean;
  readonly inheritLabel?: string;
  readonly selectedProfileId?: string;
  readonly profiles: readonly AuthenticationUiProfileSummary[];
  readonly fields: readonly AuthenticationUiField[];
  readonly addTo: readonly AuthenticationUiAddToOption[];
  readonly selectedAddToId?: AuthenticationUiAddToId;
  readonly preview: AuthenticationPresentationPreview;
  readonly effectiveLabel: string;
  readonly resolution: ExplainAuthenticationResolutionResult;
}

export interface BuildAuthenticationUiStateInput {
  readonly surface: AuthenticationUiSurface;
  readonly profiles: readonly AuthenticationProfile[] | readonly AuthenticationUiProfileSummary[];
  readonly requestOverrideId?: string;
  readonly collectionDefaultId?: string;
  readonly workspaceDefaultId?: string;
  /** Request surface: user enabled Override (or request already has `@auth`). */
  readonly override?: boolean;
  /** User-selected Type; omitted → derived from the resolved profile. */
  readonly selectedKind?: AuthenticationUiKind;
  /** User-selected saved profile; omitted → derived from resolution. */
  readonly selectedProfileId?: string;
  /** Run Setup radios: `resolved` skips the collection default. */
  readonly authenticationPreference?: 'collection-default' | 'resolved';
  /**
   * REST / GraphQL / WebSocket share the same kinds.
   * Accepted for callers; never hides a live provider.
   */
  readonly protocol?: string;
}

const INHERIT_FROM_COLLECTION = 'Inherited from Collection';
const INHERIT_FROM_SESSION = 'Inherited from Session';
const EFFECTIVE_COLLECTION_DEFAULT = 'Collection default';
const EFFECTIVE_NONE = 'None';
const PER_REQUEST_OVERRIDE_HINT =
  'Per-request @auth still overrides collection and session defaults.';

/** Hint shown on Run Setup that request `@auth` still wins. */
export const AUTHENTICATION_UI_PER_REQUEST_OVERRIDE_HINT =
  PER_REQUEST_OVERRIDE_HINT;

/** True when value is one of the four implemented UI kinds. */
export function isAuthenticationUiKind(
  value: unknown,
): value is AuthenticationUiKind {
  return (
    typeof value === 'string' &&
    (AUTHENTICATION_UI_KINDS as readonly string[]).includes(value)
  );
}

/** Maps a provider id onto a Type dropdown kind (`none` for unknown). */
export function authenticationUiKindFromProviderId(
  providerId: string | undefined,
): AuthenticationUiKind {
  return isAuthenticationUiKind(providerId) ? providerId : 'none';
}

export function authenticationUiKindLabel(kind: AuthenticationUiKind): string {
  return AUTHENTICATION_UI_KIND_LABELS[kind];
}

/**
 * Displays a credential source without ever returning a secret or literal value.
 * Variables render as `{{name}}`; secrets and literals use the presentation mask.
 */
export function displayAuthenticationValueSource(
  source: AuthenticationValueSource | { readonly kind: 'literal' } | undefined,
): Pick<AuthenticationUiField, 'display' | 'sourceKind'> {
  if (source === undefined) {
    return { display: '', sourceKind: 'empty' };
  }
  if (source.kind === 'variable') {
    const name = source.name.trim();
    return {
      display: name.length > 0 ? `{{${name}}}` : '',
      sourceKind: 'variable',
    };
  }
  if (source.kind === 'secret') {
    return {
      display: AUTHENTICATION_PRESENTATION_MASK,
      sourceKind: 'secret',
    };
  }
  return {
    display: AUTHENTICATION_PRESENTATION_MASK,
    sourceKind: 'literal',
  };
}

/**
 * Secret-free profile summary. Literal credential values are dropped.
 * Sync — does not read Secret Storage.
 */
export function summarizeAuthenticationProfileForUi(
  profile: AuthenticationProfile | AuthenticationUiProfileSummary,
): AuthenticationUiProfileSummary {
  if (isProfileSummary(profile)) {
    return sanitizeProfileSummary(profile);
  }
  const providerId =
    typeof profile.providerId === 'string' ? profile.providerId : 'none';
  const data = profile as Readonly<Record<string, unknown>>;
  const fields = fieldsForProvider(providerId, data);
  const apiKeyName =
    providerId === 'apiKey' && typeof data.name === 'string'
      ? data.name
      : undefined;
  const apiKeyLocation =
    providerId === 'apiKey' &&
    (data.location === 'header' || data.location === 'query')
      ? data.location
      : undefined;
  const label = profile.label?.trim();
  return {
    id: profile.id,
    label: label !== undefined && label.length > 0 ? label : profile.id,
    providerId,
    ...(apiKeyName !== undefined && apiKeyName.length > 0
      ? { apiKeyName }
      : {}),
    ...(apiKeyLocation !== undefined ? { apiKeyLocation } : {}),
    fields,
  };
}

/** Builds the secret-free Auth section view model for a surface. */
export function buildAuthenticationUiState(
  input: BuildAuthenticationUiStateInput,
): AuthenticationUiState {
  void input.protocol;
  const profiles = input.profiles.map(summarizeAuthenticationProfileForUi);
  const resolutionInput = resolutionInputForSurface(input);
  const resolution = explainAuthenticationResolution(resolutionInput);

  const collectionId = normalizeId(input.collectionDefaultId);
  const workspaceId = normalizeId(input.workspaceDefaultId);
  const requestId = normalizeId(input.requestOverrideId);
  const canInherit =
    input.surface === 'request' &&
    (collectionId !== undefined || workspaceId !== undefined);
  const overrideRequested = input.override === true || requestId !== undefined;
  const inheriting = canInherit && !overrideRequested && requestId === undefined;
  const inheritLabel = inheriting
    ? collectionId !== undefined
      ? INHERIT_FROM_COLLECTION
      : INHERIT_FROM_SESSION
    : undefined;

  const resolvedProfileId = resolution.selectedId;
  const selectedProfileId = resolveSelectedProfileId(
    input,
    profiles,
    resolvedProfileId,
    inheriting,
  );
  const selectedProfile =
    selectedProfileId === undefined
      ? undefined
      : profiles.find((profile) => profile.id === selectedProfileId);

  const selectedKind = resolveSelectedKind(
    input,
    selectedProfile,
    inheriting,
  );
  const fields = fieldsForKind(selectedKind, selectedProfile);
  const addTo = addToOptionsForKind(selectedKind, selectedProfile);
  const selectedAddToId = selectedAddTo(addTo, selectedProfile);
  const preview = previewForKind(selectedKind, selectedProfile, fields);
  const effectiveLabel = effectiveLabelForState({
    surface: input.surface,
    preference: input.authenticationPreference,
    selectedKind,
    selectedProfile,
    inheriting,
    inheritLabel,
  });

  return {
    surface: input.surface,
    selectedKind,
    availableKinds: AUTHENTICATION_UI_KINDS,
    inheriting,
    canInherit,
    override: overrideRequested && !inheriting,
    ...(inheritLabel === undefined ? {} : { inheritLabel }),
    ...(selectedProfileId === undefined ? {} : { selectedProfileId }),
    profiles,
    fields,
    addTo,
    ...(selectedAddToId === undefined ? {} : { selectedAddToId }),
    preview,
    effectiveLabel,
    resolution,
  };
}

/** Type `<option>` markup for the four implemented kinds (never OAuth). */
export function renderAuthenticationUiKindOptionsHtml(): string {
  return AUTHENTICATION_UI_KINDS.map(
    (kind) =>
      `<option value="${kind}">${escapeHtml(AUTHENTICATION_UI_KIND_LABELS[kind])}</option>`,
  ).join('');
}

/**
 * Shared Type / Saved Authentication / fields / Add to markup.
 * Request includes one-shot inputs; collection fields are read-only.
 */
export function renderAuthenticationUiControlsHtml(
  surface: 'request' | 'collection',
): string {
  const kindOptions = renderAuthenticationUiKindOptionsHtml();
  const oneshot = surface === 'request';
  const inheritBanner =
    surface === 'request'
      ? `<p id="authInheritBanner" class="auth-inherit-banner" hidden></p>
    <label class="field auth-override-row" id="authOverrideRow" hidden>
      <input id="authOverride" type="checkbox" />
      <span>Override</span>
    </label>`
      : '';
  const oneshotToken = oneshot
    ? `<input id="oneshotToken" type="password" autocomplete="off" placeholder="Paste token — not saved to .api" hidden />`
    : '';
  const oneshotUsername = oneshot
    ? `<input id="oneshotUsername" type="text" autocomplete="off" placeholder="Username — not saved to .api" hidden />`
    : '';
  const oneshotPassword = oneshot
    ? `<input id="oneshotPassword" type="password" autocomplete="off" placeholder="Password — not saved to .api" hidden />`
    : '';
  const oneshotApiKeyName = oneshot
    ? `<input id="oneshotApiKeyName" type="text" autocomplete="off" placeholder="Header or query name" hidden />`
    : '';
  const oneshotApiKeyValue = oneshot
    ? `<input id="oneshotApiKeyValue" type="password" autocomplete="off" placeholder="API key — not saved to .api" hidden />`
    : '';

  return `${inheritBanner}
    <label class="field">
      <span>Type</span>
      <select id="authKind" aria-label="Authentication type">${kindOptions}</select>
    </label>
    <div id="authSavedBlock">
      <label class="field">
        <span>Saved Authentication</span>
        <select id="authProfile" aria-label="Saved Authentication">
          <option value="">none</option>
        </select>
      </label>
      ${
        surface === 'request'
          ? '<p class="hint">Writes <code>@auth &lt;id&gt;</code>. Secrets stay in Secret Storage — never in the webview.</p>'
          : '<p class="hint">Writes the collection default. Secrets stay in Secret Storage — never on the collection marker.</p>'
      }
    </div>
    <div id="authFieldsBlock" class="auth-ui-fields">
      <label class="field" id="authTokenField" hidden>
        <span>Token</span>
        <input id="authTokenDisplay" type="text" readonly autocomplete="off" />
        ${oneshotToken}
      </label>
      <label class="field" id="authUsernameField" hidden>
        <span>Username</span>
        <input id="authUsernameDisplay" type="text" readonly autocomplete="off" />
        ${oneshotUsername}
      </label>
      <label class="field" id="authPasswordField" hidden>
        <span>Password</span>
        <input id="authPasswordDisplay" type="text" readonly autocomplete="off" />
        ${oneshotPassword}
      </label>
      <label class="field" id="authApiKeyNameField" hidden>
        <span>Key</span>
        <input id="authApiKeyNameDisplay" type="text" readonly autocomplete="off" />
        ${oneshotApiKeyName}
      </label>
      <label class="field" id="authApiKeyValueField" hidden>
        <span>Value</span>
        <input id="authApiKeyValueDisplay" type="text" readonly autocomplete="off" />
        ${oneshotApiKeyValue}
      </label>
    </div>
    <label class="field" id="authAddToField" hidden>
      <span>Add to</span>
      <select id="authAddTo" aria-label="Add authentication to">
        <option value="authorization-header">Authorization Header</option>
      </select>
    </label>`;
}

/** Compact CSS for inherit banner, override row, and read-only fields. */
export const AUTHENTICATION_UI_CSS = `
.auth-inherit-banner {
  margin: 0 0 var(--ah-space-2);
  padding: var(--ah-space-2) var(--ah-space-3);
  border-radius: var(--ah-radius);
  background: var(--vscode-editorWidget-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
  color: var(--vscode-foreground);
  font-size: 12px;
  font-weight: 600;
}
.auth-override-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--ah-space-2);
}
.auth-override-row span { color: var(--vscode-foreground); }
.auth-override-row input[type="checkbox"] {
  width: auto;
  min-height: 0;
  margin: 0;
}
.auth-ui-fields { display: grid; gap: var(--ah-space-2); }
.auth-ui-summary { display: grid; gap: var(--ah-space-1); margin: 0 0 var(--ah-space-3); }
.auth-ui-summary .auth-type,
.auth-ui-summary .auth-effective {
  margin: 0;
  font-size: 12px;
}
.auth-ui-field-row {
  display: grid;
  grid-template-columns: minmax(5rem, 8rem) 1fr;
  gap: var(--ah-space-2);
  font-size: 12px;
}
.auth-ui-field-row .auth-field-label {
  color: var(--vscode-descriptionForeground);
}
.auth-ui-field-row .auth-field-display {
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
`;

function isProfileSummary(
  profile: AuthenticationProfile | AuthenticationUiProfileSummary,
): profile is AuthenticationUiProfileSummary {
  return Array.isArray((profile as AuthenticationUiProfileSummary).fields);
}

function sanitizeProfileSummary(
  profile: AuthenticationUiProfileSummary,
): AuthenticationUiProfileSummary {
  return {
    id: profile.id,
    label: profile.label,
    providerId: profile.providerId,
    ...(profile.apiKeyName !== undefined ? { apiKeyName: profile.apiKeyName } : {}),
    ...(profile.apiKeyLocation !== undefined
      ? { apiKeyLocation: profile.apiKeyLocation }
      : {}),
    fields: profile.fields.map((field) => ({
      name: field.name,
      label: field.label,
      display: sanitizeFieldDisplay(field),
      sourceKind: field.sourceKind,
    })),
  };
}

function sanitizeFieldDisplay(field: AuthenticationUiField): string {
  if (field.sourceKind === 'variable') {
    return field.display;
  }
  if (field.sourceKind === 'metadata') {
    return field.display;
  }
  if (field.sourceKind === 'empty') {
    return '';
  }
  return AUTHENTICATION_PRESENTATION_MASK;
}

function fieldsForProvider(
  providerId: string,
  data: Readonly<Record<string, unknown>>,
): readonly AuthenticationUiField[] {
  const kind = authenticationUiKindFromProviderId(providerId);
  if (kind === 'apiKey') {
    const name =
      typeof data.name === 'string' && data.name.trim().length > 0
        ? data.name.trim()
        : '';
    const value = displayAuthenticationValueSource(
      parseValueSource(data.value),
    );
    return [
      {
        name: 'name',
        label: 'Key',
        display: name,
        sourceKind: 'metadata',
      },
      {
        name: 'value',
        label: 'Value',
        display: value.display,
        sourceKind: value.sourceKind,
      },
    ];
  }
  return secretFieldsForProvider(providerId).map((meta) => {
    const shown = displayAuthenticationValueSource(
      parseValueSource(data[meta.field]),
    );
    return {
      name: meta.field,
      label: fieldLabelForUi(meta.field, meta.label),
      display: shown.display,
      sourceKind: shown.sourceKind,
    };
  });
}

function fieldLabelForUi(field: string, fallback: string): string {
  if (field === 'token') {
    return 'Token';
  }
  if (field === 'username') {
    return 'Username';
  }
  if (field === 'password') {
    return 'Password';
  }
  if (field === 'value') {
    return 'Value';
  }
  return fallback;
}

function parseValueSource(
  value: unknown,
): AuthenticationValueSource | { readonly kind: 'literal' } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as {
    readonly kind?: unknown;
    readonly name?: unknown;
  };
  if (record.kind === 'secret') {
    return { kind: 'secret' };
  }
  if (record.kind === 'variable' && typeof record.name === 'string') {
    return { kind: 'variable', name: record.name };
  }
  if (record.kind === 'literal') {
    return { kind: 'literal' };
  }
  return undefined;
}

function resolutionInputForSurface(
  input: BuildAuthenticationUiStateInput,
): {
  readonly requestOverrideId?: string;
  readonly collectionDefaultId?: string;
  readonly workspaceDefaultId?: string;
} {
  if (input.surface === 'run-setup') {
    if (input.authenticationPreference === 'resolved') {
      return {
        ...(normalizeId(input.workspaceDefaultId) === undefined
          ? {}
          : { workspaceDefaultId: input.workspaceDefaultId }),
      };
    }
    return {
      ...(normalizeId(input.collectionDefaultId) === undefined
        ? {}
        : { collectionDefaultId: input.collectionDefaultId }),
      ...(normalizeId(input.workspaceDefaultId) === undefined
        ? {}
        : { workspaceDefaultId: input.workspaceDefaultId }),
    };
  }
  if (input.surface === 'collection') {
    return {
      ...(normalizeId(input.collectionDefaultId) === undefined
        ? {}
        : { collectionDefaultId: input.collectionDefaultId }),
    };
  }
  return {
    ...(normalizeId(input.requestOverrideId) === undefined
      ? {}
      : { requestOverrideId: input.requestOverrideId }),
    ...(normalizeId(input.collectionDefaultId) === undefined
      ? {}
      : { collectionDefaultId: input.collectionDefaultId }),
    ...(normalizeId(input.workspaceDefaultId) === undefined
      ? {}
      : { workspaceDefaultId: input.workspaceDefaultId }),
  };
}

function resolveSelectedProfileId(
  input: BuildAuthenticationUiStateInput,
  profiles: readonly AuthenticationUiProfileSummary[],
  resolvedProfileId: string | undefined,
  inheriting: boolean,
): string | undefined {
  const explicit = normalizeId(input.selectedProfileId);
  if (explicit !== undefined && profiles.some((profile) => profile.id === explicit)) {
    if (input.selectedKind !== undefined && input.selectedKind !== 'none') {
      const match = profiles.find((profile) => profile.id === explicit);
      if (
        match !== undefined &&
        authenticationUiKindFromProviderId(match.providerId) !== input.selectedKind
      ) {
        return undefined;
      }
    }
    return explicit;
  }
  if (inheriting || input.selectedKind === undefined) {
    return resolvedProfileId;
  }
  if (resolvedProfileId !== undefined) {
    const resolved = profiles.find((profile) => profile.id === resolvedProfileId);
    if (
      resolved !== undefined &&
      (input.selectedKind === 'none' ||
        authenticationUiKindFromProviderId(resolved.providerId) ===
          input.selectedKind)
    ) {
      return resolvedProfileId;
    }
  }
  return undefined;
}

function resolveSelectedKind(
  input: BuildAuthenticationUiStateInput,
  selectedProfile: AuthenticationUiProfileSummary | undefined,
  inheriting: boolean,
): AuthenticationUiKind {
  if (!inheriting && input.selectedKind !== undefined) {
    return input.selectedKind;
  }
  if (selectedProfile !== undefined) {
    return authenticationUiKindFromProviderId(selectedProfile.providerId);
  }
  return 'none';
}

function fieldsForKind(
  kind: AuthenticationUiKind,
  profile: AuthenticationUiProfileSummary | undefined,
): readonly AuthenticationUiField[] {
  if (kind === 'none') {
    return [];
  }
  if (
    profile !== undefined &&
    authenticationUiKindFromProviderId(profile.providerId) === kind
  ) {
    return profile.fields;
  }
  return emptyFieldsForKind(kind);
}

function emptyFieldsForKind(kind: AuthenticationUiKind): readonly AuthenticationUiField[] {
  if (kind === 'bearer') {
    return [
      { name: 'token', label: 'Token', display: '', sourceKind: 'empty' },
    ];
  }
  if (kind === 'basic') {
    return [
      { name: 'username', label: 'Username', display: '', sourceKind: 'empty' },
      { name: 'password', label: 'Password', display: '', sourceKind: 'empty' },
    ];
  }
  if (kind === 'apiKey') {
    return [
      { name: 'name', label: 'Key', display: '', sourceKind: 'metadata' },
      { name: 'value', label: 'Value', display: '', sourceKind: 'empty' },
    ];
  }
  return [];
}

function addToOptionsForKind(
  kind: AuthenticationUiKind,
  profile: AuthenticationUiProfileSummary | undefined,
): readonly AuthenticationUiAddToOption[] {
  if (kind === 'none') {
    return [];
  }
  if (kind === 'apiKey') {
    const location = profile?.apiKeyLocation === 'query' ? 'query' : 'header';
    return [
      {
        id: 'header',
        label: 'Header',
        readOnly: location === 'header' && profile !== undefined,
      },
      {
        id: 'query',
        label: 'Query',
        readOnly: location === 'query' && profile !== undefined,
      },
    ];
  }
  return [
    {
      id: 'authorization-header',
      label: 'Authorization Header',
      readOnly: true,
    },
  ];
}

function selectedAddTo(
  options: readonly AuthenticationUiAddToOption[],
  profile: AuthenticationUiProfileSummary | undefined,
): AuthenticationUiAddToId | undefined {
  if (options.length === 0) {
    return undefined;
  }
  if (profile?.apiKeyLocation === 'query') {
    return 'query';
  }
  if (options.some((option) => option.id === 'header')) {
    return 'header';
  }
  return options[0]?.id;
}

function previewForKind(
  kind: AuthenticationUiKind,
  profile: AuthenticationUiProfileSummary | undefined,
  fields: readonly AuthenticationUiField[],
): AuthenticationPresentationPreview {
  const secretFields: AuthenticationPresentationSecretField[] = fields
    .filter((field) => field.sourceKind !== 'metadata')
    .map((field) => ({
      field: field.name,
      label: field.label,
      status: field.sourceKind === 'empty' ? 'missing' : 'set',
    }));
  return buildAuthenticationPresentationPreview({
    providerId: kind,
    secretFields,
    ...(kind === 'apiKey'
      ? {
          apiKeyName: profile?.apiKeyName,
          apiKeyLocation: profile?.apiKeyLocation,
        }
      : {}),
  });
}

function effectiveLabelForState(input: {
  readonly surface: AuthenticationUiSurface;
  readonly preference?: 'collection-default' | 'resolved';
  readonly selectedKind: AuthenticationUiKind;
  readonly selectedProfile: AuthenticationUiProfileSummary | undefined;
  readonly inheriting: boolean;
  readonly inheritLabel?: string;
}): string {
  if (input.surface === 'run-setup') {
    if (input.selectedProfile === undefined || input.selectedKind === 'none') {
      return EFFECTIVE_NONE;
    }
    if (input.preference === 'collection-default') {
      return EFFECTIVE_COLLECTION_DEFAULT;
    }
    return input.selectedProfile.label;
  }
  if (input.inheriting && input.inheritLabel !== undefined) {
    return input.inheritLabel;
  }
  if (input.selectedProfile !== undefined && input.selectedKind !== 'none') {
    return input.selectedProfile.label;
  }
  return AUTHENTICATION_UI_KIND_LABELS.none;
}

function normalizeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
