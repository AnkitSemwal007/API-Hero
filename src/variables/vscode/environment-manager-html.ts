/**
 * Pure HTML/CSS/JS and message helpers for the Environment Manager webview.
 * No `vscode` import — keeps core/tests free of the extension host.
 */

import { normalizeOptionalEnvironmentId } from '../environment-manager';
import { MASKED_VARIABLE_VALUE } from '../variable-resolver';
import {
  VARIABLE_PRECEDENCE_LEGEND,
  VARIABLE_SCOPE_UI,
} from '../variable-scope-ui';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export { escapeAttribute };

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

/** Editable variable row for the Environment Manager UI. */
export interface EnvironmentManagerVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
}

/** Editable environment row for the Environment Manager UI. */
export interface EnvironmentManagerEnvironment {
  readonly id: string;
  readonly name: string;
  readonly variables: readonly EnvironmentManagerVariable[];
}

/** Full editable snapshot posted between host and webview. */
export interface EnvironmentManagerState {
  readonly environments: readonly EnvironmentManagerEnvironment[];
  readonly globalVariables: readonly EnvironmentManagerVariable[];
  readonly workspaceVariables: readonly EnvironmentManagerVariable[];
  readonly activeEnvironmentId?: string;
  readonly selectedId?: string;
}

export type EnvironmentManagerInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'dirty'; readonly dirty: boolean }
  | {
      readonly type: 'setActiveEnvironment';
      readonly id: string | undefined;
    }
  | {
      readonly type: 'commit';
      readonly state: EnvironmentManagerState;
    };

export type EnvironmentManagerOutboundMessage =
  | { readonly type: 'init'; readonly state: EnvironmentManagerState }
  | { readonly type: 'error'; readonly message: string }
  | {
      readonly type: 'activeEnvironmentSet';
      readonly id: string | undefined;
    }
  | {
      readonly type: 'activeEnvironmentError';
      readonly message: string;
    };

/** Validates webview → extension messages. */
export function parseEnvironmentManagerMessage(
  value: unknown,
): EnvironmentManagerInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  if (record.type === 'ready') {
    return { type: 'ready' };
  }
  if (record.type === 'dirty' && typeof record.dirty === 'boolean') {
    return { type: 'dirty', dirty: record.dirty };
  }
  if (record.type === 'setActiveEnvironment') {
    if (record.id === undefined || record.id === null) {
      return { type: 'setActiveEnvironment', id: undefined };
    }
    if (typeof record.id !== 'string') {
      return undefined;
    }
    return {
      type: 'setActiveEnvironment',
      id: normalizeOptionalEnvironmentId(record.id),
    };
  }
  if (record.type !== 'commit') {
    return undefined;
  }
  const state = parseState(record.state);
  if (state === undefined) {
    return undefined;
  }
  return { type: 'commit', state };
}

/** Returns an error string when the committed state is invalid. */
export function validateEnvironmentManagerState(
  state: EnvironmentManagerState,
): string | undefined {
  const ids = new Set<string>();
  for (const environment of state.environments) {
    if (environment.id.trim().length === 0) {
      return 'Environment id is required.';
    }
    if (ids.has(environment.id)) {
      return `Duplicate environment id "${environment.id}".`;
    }
    ids.add(environment.id);
    if (environment.name.trim().length === 0) {
      return 'Environment name is required.';
    }
    const variableError = validateVariableList(
      environment.variables,
      `Environment "${environment.name}"`,
    );
    if (variableError !== undefined) {
      return variableError;
    }
  }

  const activeEnvironmentId = normalizeOptionalEnvironmentId(
    state.activeEnvironmentId,
  );
  if (
    activeEnvironmentId !== undefined &&
    !ids.has(activeEnvironmentId)
  ) {
    return (
      `Active environment "${activeEnvironmentId}" is not in the list. ` +
      'Choose an existing environment or clear the active selection before saving.'
    );
  }

  const globalError = validateVariableList(state.globalVariables, 'Global');
  if (globalError !== undefined) {
    return globalError;
  }
  return validateVariableList(state.workspaceVariables, 'Workspace');
}

/** True when a variable name matches the settings schema pattern. */
export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME_PATTERN.test(name);
}

/**
 * Allocates a stable, unique environment id from a display name.
 */
export function allocateEnvironmentId(
  name: string,
  existingIds: ReadonlySet<string>,
): string {
  const base = slugifyEnvironmentId(name) || 'environment';
  if (!existingIds.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * Renames the selected environment and reallocates its id from the new name.
 * No-ops when the selection is a scope (`global` / `workspace`) or unknown.
 */
export function renameSelectedEnvironment(
  state: EnvironmentManagerState,
  name: string,
): EnvironmentManagerState {
  const selectedId = state.selectedId;
  if (
    selectedId === undefined ||
    selectedId === 'global' ||
    selectedId === 'workspace'
  ) {
    return state;
  }
  const selected = state.environments.find(
    (environment) => environment.id === selectedId,
  );
  if (selected === undefined) {
    return state;
  }
  const collisionSet = new Set(
    state.environments
      .map((environment) => environment.id)
      .filter((id) => id !== selectedId),
  );
  const newId = allocateEnvironmentId(name, collisionSet);
  return {
    ...state,
    environments: state.environments.map((environment) =>
      environment.id === selectedId
        ? { ...environment, id: newId, name }
        : environment,
    ),
    selectedId: newId,
    activeEnvironmentId:
      state.activeEnvironmentId === selectedId
        ? newId
        : state.activeEnvironmentId,
  };
}

/** Masks sensitive values before posting state to the webview. */
export function maskEnvironmentManagerState(
  state: EnvironmentManagerState,
): EnvironmentManagerState {
  return {
    ...state,
    environments: state.environments.map((environment) => ({
      ...environment,
      variables: maskVariables(environment.variables),
    })),
    globalVariables: maskVariables(state.globalVariables),
    workspaceVariables: maskVariables(state.workspaceVariables),
  };
}

/**
 * Restores masked sensitive values from the last cleartext baseline so a
 * round-trip does not wipe secrets the user did not edit.
 *
 * Orphan pairing (e.g. after rename changed the id) is unambiguous 1:1 only:
 * exactly one orphaned baseline and exactly one incoming env that needs
 * unmask. Otherwise never pair orphans — prefer losing masked secrets over
 * wrong pairing. No FIFO and no multi-orphan matching.
 */
export function restoreEnvironmentManagerState(
  incoming: EnvironmentManagerState,
  baseline: EnvironmentManagerState,
): EnvironmentManagerState {
  const baselineByEnv = new Map(
    baseline.environments.map((environment) => [
      environment.id,
      environment.variables,
    ]),
  );
  const incomingIds = new Set(
    incoming.environments.map((environment) => environment.id),
  );
  const orphanedBaselines = baseline.environments
    .filter((environment) => !incomingIds.has(environment.id))
    .map((environment) => environment.variables);
  const needsOrphanRestore = incoming.environments.filter(
    (environment) =>
      baselineByEnv.get(environment.id) === undefined &&
      environment.variables.some(
        (variable) => variable.value === MASKED_VARIABLE_VALUE,
      ),
  );
  const orphanRestoreByIncomingId =
    orphanedBaselines.length === 1 && needsOrphanRestore.length === 1
      ? new Map([
          [needsOrphanRestore[0]!.id, orphanedBaselines[0]!],
        ])
      : undefined;

  return {
    ...incoming,
    environments: incoming.environments.map((environment) => {
      let baselineVariables = baselineByEnv.get(environment.id);
      if (baselineVariables === undefined) {
        baselineVariables =
          orphanRestoreByIncomingId?.get(environment.id) ?? [];
      }
      return {
        ...environment,
        variables: restoreVariables(environment.variables, baselineVariables),
      };
    }),
    globalVariables: restoreVariables(
      incoming.globalVariables,
      baseline.globalVariables,
    ),
    workspaceVariables: restoreVariables(
      incoming.workspaceVariables,
      baseline.workspaceVariables,
    ),
  };
}

/** Builds the Environment Manager document. */
export function renderEnvironmentManagerHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  const workspaceLabel = escapeAttribute(
    `${VARIABLE_SCOPE_UI.workspace.icon} ${VARIABLE_SCOPE_UI.workspace.sourceLabel}`,
  );
  const globalLabel = escapeAttribute(
    `${VARIABLE_SCOPE_UI.global.icon} ${VARIABLE_SCOPE_UI.global.sourceLabel}`,
  );
  const precedenceLegend = escapeAttribute(VARIABLE_PRECEDENCE_LEGEND);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Environment Manager</title>
<style nonce="${safeNonce}">${MANAGER_CSS}</style>
</head>
<body>
<div id="app">
  <aside aria-label="Environment Manager navigation">
    <div class="aside-header">
      <h1>Environment Manager</h1>
    </div>
    <section class="nav-section" aria-labelledby="environmentsHeading">
      <div class="nav-section-header">
        <h2 id="environmentsHeading" class="nav-section-label">Environments</h2>
        <button type="button" id="addEnv" class="primary" title="Add environment">Add</button>
      </div>
      <label class="search-field">
        <span class="sr-only">Search environments</span>
        <input id="envSearch" type="search" placeholder="Search environments" autocomplete="off" />
      </label>
      <ul id="envList" class="env-list" role="listbox" aria-label="Environments"></ul>
      <p id="envEmpty" class="nav-empty" hidden>No environments yet — optional for a first run; click Add when you need variables.</p>
    </section>
    <section class="nav-section nav-section-scopes" aria-labelledby="scopesHeading">
      <h2 id="scopesHeading" class="nav-section-label">Scopes</h2>
      <ul class="scope-list" role="listbox" aria-label="Variable scopes">
        <li role="presentation">
          <button type="button" class="scope-item" data-scope="workspace" id="scopeWorkspace" role="option" aria-selected="false">${workspaceLabel} Variables</button>
        </li>
        <li role="presentation">
          <button type="button" class="scope-item" data-scope="global" id="scopeGlobal" role="option" aria-selected="false">${globalLabel} Variables</button>
        </li>
      </ul>
      <p id="precedenceLegend" class="precedence-legend">${precedenceLegend}</p>
      <p class="nav-empty scope-request-note">Request variables live in the .api file / Request Editor (highest precedence).</p>
    </section>
  </aside>
  <main>
    <p id="activeEnvStrip" class="active-env-strip" aria-live="polite">Active environment: None</p>
    <header class="main-header">
      <div class="title-row">
        <input id="envName" type="text" autocomplete="off" placeholder="Environment name" aria-label="Environment name" />
        <button type="button" id="setActive" class="secondary">Set Active</button>
        <button type="button" id="duplicateEnv" class="secondary">Duplicate</button>
        <button type="button" id="deleteEnv" class="danger">Delete</button>
      </div>
      <p id="scopeHint" class="hint" hidden></p>
      <p id="activeBadge" class="badge" hidden>Active environment</p>
    </header>
    <section class="variables">
      <div class="section-header">
        <h2>Variables</h2>
        <button type="button" id="addVar" class="secondary">Add variable</button>
      </div>
      <div class="table-wrap">
        <table class="kv" aria-label="Variables">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
              <th scope="col">Sensitive</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody id="varBody"></tbody>
        </table>
      </div>
      <p id="emptyVars" class="empty" hidden>No variables yet.</p>
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

function parseState(value: unknown): EnvironmentManagerState | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  const environments = parseEnvironments(record.environments);
  const globalVariables = parseVariables(record.globalVariables);
  const workspaceVariables = parseVariables(record.workspaceVariables);
  if (
    environments === undefined ||
    globalVariables === undefined ||
    workspaceVariables === undefined
  ) {
    return undefined;
  }
  if (
    record.activeEnvironmentId !== undefined &&
    record.activeEnvironmentId !== null &&
    typeof record.activeEnvironmentId !== 'string'
  ) {
    return undefined;
  }
  const activeEnvironmentId = normalizeOptionalEnvironmentId(
    record.activeEnvironmentId === undefined ||
      record.activeEnvironmentId === null
      ? undefined
      : record.activeEnvironmentId,
  );
  const selectedId =
    record.selectedId === undefined
      ? undefined
      : typeof record.selectedId === 'string'
        ? record.selectedId
        : undefined;
  if (record.selectedId !== undefined && typeof record.selectedId !== 'string') {
    return undefined;
  }
  return {
    environments,
    globalVariables,
    workspaceVariables,
    ...(activeEnvironmentId === undefined ? {} : { activeEnvironmentId }),
    ...(selectedId === undefined ? {} : { selectedId }),
  };
}

function parseEnvironments(
  value: unknown,
): readonly EnvironmentManagerEnvironment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const environments: EnvironmentManagerEnvironment[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') {
      return undefined;
    }
    const variables = parseVariables(record.variables);
    if (variables === undefined) {
      return undefined;
    }
    environments.push({
      id: record.id,
      name: record.name,
      variables,
    });
  }
  return environments;
}

function parseVariables(
  value: unknown,
): readonly EnvironmentManagerVariable[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const variables: EnvironmentManagerVariable[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.name !== 'string' ||
      typeof record.value !== 'string' ||
      typeof record.sensitive !== 'boolean'
    ) {
      return undefined;
    }
    variables.push({
      name: record.name,
      value: record.value,
      sensitive: record.sensitive,
    });
  }
  return variables;
}

function validateVariableList(
  variables: readonly EnvironmentManagerVariable[],
  label: string,
): string | undefined {
  const names = new Set<string>();
  for (const variable of variables) {
    const name = variable.name.trim();
    if (name.length === 0) {
      return `${label}: variable name is required.`;
    }
    if (!isValidVariableName(name)) {
      return `${label}: invalid variable name "${name}".`;
    }
    if (names.has(name)) {
      return `${label}: duplicate variable "${name}".`;
    }
    names.add(name);
  }
  return undefined;
}

function maskVariables(
  variables: readonly EnvironmentManagerVariable[],
): readonly EnvironmentManagerVariable[] {
  return variables.map((variable) =>
    variable.sensitive
      ? { ...variable, value: MASKED_VARIABLE_VALUE }
      : variable,
  );
}

function restoreVariables(
  incoming: readonly EnvironmentManagerVariable[],
  baseline: readonly EnvironmentManagerVariable[],
): readonly EnvironmentManagerVariable[] {
  const baselineSensitiveByName = new Map(
    baseline
      .filter((variable) => variable.sensitive)
      .map((variable) => [variable.name, variable.value] as const),
  );
  const baselineSensitiveOrdered = baseline.filter(
    (variable) => variable.sensitive,
  );
  let sensitiveIndex = 0;
  return incoming.map((variable) => {
    if (!variable.sensitive) {
      return {
        name: variable.name.trim(),
        value: variable.value,
        sensitive: false,
      };
    }
    const index = sensitiveIndex;
    sensitiveIndex += 1;
    const byName = baselineSensitiveByName.get(variable.name);
    if (
      byName !== undefined &&
      (variable.value === MASKED_VARIABLE_VALUE || variable.value === byName)
    ) {
      return {
        name: variable.name.trim(),
        value: byName,
        sensitive: true,
      };
    }
    if (variable.value === MASKED_VARIABLE_VALUE) {
      const byIndex = baselineSensitiveOrdered[index];
      if (byIndex !== undefined) {
        return {
          name: variable.name.trim(),
          value: byIndex.value,
          sensitive: true,
        };
      }
      // Never persist the mask glyph — drop unmatched masked values.
      return {
        name: variable.name.trim(),
        value: '',
        sensitive: true,
      };
    }
    return {
      name: variable.name.trim(),
      value: variable.value,
      sensitive: true,
    };
  });
}

function slugifyEnvironmentId(name: string): string {
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
.nav-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.nav-section:first-of-type { flex: 1; }
.nav-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.nav-section-label {
  margin: 0;
  color: var(--vscode-descriptionForeground);
  font-size: .75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.nav-section-scopes {
  padding-top: 8px;
  border-top: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
}
.nav-empty {
  margin: 0;
  padding: 4px 10px;
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
}
.env-list, .scope-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.env-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.env-item, .scope-item {
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
.env-item:hover, .scope-item:hover {
  background: var(--vscode-list-hoverBackground);
}
.env-item.active, .scope-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.env-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.env-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.env-item.is-active-env .env-item-name { font-weight: 600; }
.env-item .env-active-badge {
  flex: 0 0 auto;
  margin: 0;
  padding: 1px 6px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: .75em;
  font-weight: 600;
  line-height: 1.4;
}
.env-item.active .env-active-badge {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  opacity: .95;
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
#envName {
  flex: 1 1 220px;
  min-width: 160px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 6px 8px;
  border-radius: 2px;
  font: inherit;
}
#envName:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
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
.active-env-strip {
  margin: 0;
  padding: 6px 10px;
  border-radius: 2px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
}
.active-env-strip.has-active {
  color: var(--vscode-foreground);
  font-weight: 600;
}
.precedence-legend {
  margin: 6px 0 0;
  padding: 0 2px;
  color: var(--vscode-descriptionForeground);
  font-size: .78em;
  line-height: 1.35;
}
.scope-request-note {
  margin-top: 4px;
  padding-left: 2px;
  font-size: .78em;
  line-height: 1.35;
}
.hint { margin: 0; color: var(--vscode-descriptionForeground); }
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  border-radius: 2px;
}
table.kv {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th, td {
  text-align: left;
  padding: 6px 8px;
  border-top: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  vertical-align: middle;
}
th {
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border-top: none;
}
table.kv tbody tr:hover {
  background: var(--vscode-list-hoverBackground);
}
table.kv input[type="text"] {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 4px 6px;
  border-radius: 2px;
  font: inherit;
}
table.kv input[type="checkbox"] { margin: 0; }
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
.search-field input {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  padding: 4px 8px;
  font: inherit;
}
@media (max-width: 720px) {
  #app { grid-template-columns: 1fr; }
  aside { border-right: none; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); }
}
`;

const MANAGER_SCRIPT = `
const vscode = acquireVsCodeApi();
const MASK = ${JSON.stringify(MASKED_VARIABLE_VALUE)};
const SCOPE_UI = ${JSON.stringify({
  global: VARIABLE_SCOPE_UI.global,
  workspace: VARIABLE_SCOPE_UI.workspace,
})};

/** @type {any} */
let state = {
  environments: [],
  globalVariables: [],
  workspaceVariables: [],
  activeEnvironmentId: undefined,
  selectedId: 'global',
};
let dirty = false;
let envFilter = '';
/** @type {string | undefined} */
let previousActiveEnvironmentId = undefined;
/** @type {string | undefined | null} null = not waiting on setActive */
let pendingActiveEnvironmentId = null;

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
  post({ type: 'dirty', dirty: value });
}

function selectedScope() {
  const id = state.selectedId;
  if (id === 'global' || id === 'workspace') return id;
  return 'environment';
}

function currentVariables() {
  const scope = selectedScope();
  if (scope === 'global') return state.globalVariables;
  if (scope === 'workspace') return state.workspaceVariables;
  const environment = state.environments.find((entry) => entry.id === state.selectedId);
  return environment ? environment.variables : [];
}

function setCurrentVariables(variables) {
  const scope = selectedScope();
  if (scope === 'global') {
    state = { ...state, globalVariables: variables };
    return;
  }
  if (scope === 'workspace') {
    state = { ...state, workspaceVariables: variables };
    return;
  }
  state = {
    ...state,
    environments: state.environments.map((entry) =>
      entry.id === state.selectedId ? { ...entry, variables } : entry),
  };
}

function allocateId(name, existingIds) {
  const existing = existingIds || new Set(state.environments.map((entry) => entry.id));
  const base = String(name || 'environment')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'environment';
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(base + '-' + suffix)) suffix += 1;
  return base + '-' + suffix;
}

function renderList() {
  const list = el('envList');
  list.innerHTML = '';
  const query = envFilter.trim().toLowerCase();
  let visibleCount = 0;
  for (const environment of state.environments) {
    const haystack = ((environment.name || '') + ' ' + (environment.id || '')).toLowerCase();
    if (query && !haystack.includes(query) && environment.id !== state.selectedId) continue;
    visibleCount += 1;
    const isSelected = state.selectedId === environment.id;
    const isActiveEnv = environment.id === state.activeEnvironmentId;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'env-item'
      + (isSelected ? ' active' : '')
      + (isActiveEnv ? ' is-active-env' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    if (isActiveEnv) {
      item.setAttribute('aria-current', 'true');
      item.title = (environment.name || environment.id) + ' (Active)';
    }
    const row = document.createElement('span');
    row.className = 'env-item-row';
    const label = document.createElement('span');
    label.className = 'env-item-name';
    label.textContent = environment.name || environment.id;
    row.appendChild(label);
    if (isActiveEnv) {
      const badge = document.createElement('span');
      badge.className = 'env-active-badge';
      badge.textContent = 'Active';
      row.appendChild(badge);
    }
    item.appendChild(row);
    item.addEventListener('click', () => {
      state = { ...state, selectedId: environment.id };
      render();
    });
    const wrap = document.createElement('li');
    wrap.setAttribute('role', 'presentation');
    wrap.appendChild(item);
    list.appendChild(wrap);
  }

  const empty = el('envEmpty');
  if (state.environments.length === 0) {
    empty.hidden = false;
    empty.textContent =
      'No environments yet — optional for a first run; click Add when you need variables.';
  } else if (visibleCount === 0) {
    empty.hidden = false;
    empty.textContent = 'No matching environments.';
  } else {
    empty.hidden = true;
  }

  const scopeGlobal = el('scopeGlobal');
  const scopeWorkspace = el('scopeWorkspace');
  const globalSelected = state.selectedId === 'global';
  const workspaceSelected = state.selectedId === 'workspace';
  scopeGlobal.classList.toggle('active', globalSelected);
  scopeWorkspace.classList.toggle('active', workspaceSelected);
  scopeGlobal.setAttribute('aria-selected', globalSelected ? 'true' : 'false');
  scopeWorkspace.setAttribute('aria-selected', workspaceSelected ? 'true' : 'false');
}

function renderVariables() {
  const body = el('varBody');
  body.innerHTML = '';
  const variables = currentVariables();
  el('emptyVars').hidden = variables.length > 0;
  variables.forEach((variable, index) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = variable.name;
    nameInput.placeholder = 'name';
    nameInput.autocomplete = 'off';
    nameInput.addEventListener('input', () => {
      const next = currentVariables().slice();
      next[index] = { ...next[index], name: nameInput.value };
      setCurrentVariables(next);
      setDirty(true);
    });
    nameCell.appendChild(nameInput);

    const valueCell = document.createElement('td');
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.value = variable.value;
    valueInput.placeholder = variable.sensitive ? '••••••••' : 'value';
    valueInput.autocomplete = 'off';
    if (variable.sensitive && variable.value === MASK) {
      valueInput.type = 'password';
    }
    valueInput.addEventListener('input', () => {
      const next = currentVariables().slice();
      next[index] = { ...next[index], value: valueInput.value };
      setCurrentVariables(next);
      setDirty(true);
    });
    valueCell.appendChild(valueInput);

    const sensitiveCell = document.createElement('td');
    const sensitiveInput = document.createElement('input');
    sensitiveInput.type = 'checkbox';
    sensitiveInput.checked = variable.sensitive === true;
    sensitiveInput.title = 'Mark sensitive';
    sensitiveInput.addEventListener('change', () => {
      const next = currentVariables().slice();
      next[index] = { ...next[index], sensitive: sensitiveInput.checked };
      setCurrentVariables(next);
      setDirty(true);
      renderVariables();
    });
    sensitiveCell.appendChild(sensitiveInput);

    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      const next = currentVariables().filter((_, i) => i !== index);
      setCurrentVariables(next);
      setDirty(true);
      render();
    });
    actionCell.appendChild(remove);

    row.appendChild(nameCell);
    row.appendChild(valueCell);
    row.appendChild(sensitiveCell);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

function activeEnvironmentName() {
  if (!state.activeEnvironmentId) return undefined;
  const active = state.environments.find((entry) => entry.id === state.activeEnvironmentId);
  return active ? (active.name || active.id) : undefined;
}

function renderActiveEnvStrip() {
  const strip = el('activeEnvStrip');
  const name = activeEnvironmentName();
  if (name) {
    strip.textContent = 'Active environment: ' + name;
    strip.classList.add('has-active');
  } else {
    strip.textContent = 'Active environment: None';
    strip.classList.remove('has-active');
  }
}

function renderMain() {
  const scope = selectedScope();
  const nameInput = el('envName');
  const setActive = el('setActive');
  const deleteEnv = el('deleteEnv');
  const duplicateEnv = el('duplicateEnv');
  const hint = el('scopeHint');
  const badge = el('activeBadge');
  renderActiveEnvStrip();

  if (scope === 'global' || scope === 'workspace') {
    nameInput.disabled = true;
    const scopeUi = scope === 'global' ? SCOPE_UI.global : SCOPE_UI.workspace;
    nameInput.value = scopeUi.icon + ' ' + scopeUi.sourceLabel + ' Variables';
    setActive.disabled = true;
    setActive.textContent = 'Set Active';
    deleteEnv.disabled = true;
    duplicateEnv.disabled = true;
    hint.hidden = false;
    hint.textContent = scope === 'global'
      ? 'Global scope (user settings). Overridden by Request, Environment, and Workspace when names collide.'
      : 'Workspace scope. Overridden by Request and Environment when names collide.';
    badge.hidden = true;
  } else {
    const environment = state.environments.find((entry) => entry.id === state.selectedId);
    nameInput.disabled = !environment;
    nameInput.value = environment ? environment.name : '';
    deleteEnv.disabled = !environment;
    duplicateEnv.disabled = !environment;
    const isActive = Boolean(
      environment && environment.id === state.activeEnvironmentId,
    );
    badge.hidden = !isActive;
    setActive.textContent = isActive ? 'Active' : 'Set Active';
    setActive.disabled = !environment || isActive;
    hint.hidden = false;
    hint.textContent = isActive
      ? 'This environment is active. Its variables override Workspace and Global; Request still wins.'
      : 'Environment variables apply only when this environment is active. Request still overrides them.';
  }
  renderVariables();
}

function render() {
  renderList();
  renderMain();
}

el('scopeGlobal').addEventListener('click', () => {
  state = { ...state, selectedId: 'global' };
  render();
});
el('scopeWorkspace').addEventListener('click', () => {
  state = { ...state, selectedId: 'workspace' };
  render();
});
el('addEnv').addEventListener('click', () => {
  const name = 'New Environment';
  const id = allocateId(name);
  state = {
    ...state,
    environments: [...state.environments, { id, name, variables: [] }],
    selectedId: id,
  };
  setDirty(true);
  render();
});
el('envSearch').addEventListener('input', () => {
  envFilter = el('envSearch').value;
  renderList();
});
el('duplicateEnv').addEventListener('click', () => {
  if (selectedScope() !== 'environment' || !state.selectedId) return;
  const source = state.environments.find((entry) => entry.id === state.selectedId);
  if (!source) return;
  const name = (source.name || source.id) + ' Copy';
  const id = allocateId(name);
  state = {
    ...state,
    environments: [
      ...state.environments,
      {
        id,
        name,
        variables: source.variables.map((variable) => ({ ...variable })),
      },
    ],
    selectedId: id,
  };
  setDirty(true);
  render();
});
el('envName').addEventListener('input', () => {
  if (selectedScope() !== 'environment') return;
  const oldId = state.selectedId;
  if (!oldId) return;
  const name = el('envName').value;
  const collisionSet = new Set(
    state.environments.map((entry) => entry.id).filter((id) => id !== oldId),
  );
  const newId = allocateId(name, collisionSet);
  state = {
    ...state,
    environments: state.environments.map((entry) =>
      entry.id === oldId ? { ...entry, id: newId, name } : entry),
    selectedId: newId,
    activeEnvironmentId:
      state.activeEnvironmentId === oldId ? newId : state.activeEnvironmentId,
  };
  setDirty(true);
  // Preserve caret — renderMain rewrites #envName from state.
  const nameInput = el('envName');
  const selStart = nameInput.selectionStart;
  const selEnd = nameInput.selectionEnd;
  render();
  if (typeof selStart === 'number' && typeof selEnd === 'number') {
    nameInput.setSelectionRange(selStart, selEnd);
  }
});
el('setActive').addEventListener('click', () => {
  if (selectedScope() !== 'environment' || !state.selectedId) return;
  previousActiveEnvironmentId = state.activeEnvironmentId;
  pendingActiveEnvironmentId = state.selectedId;
  state = { ...state, activeEnvironmentId: state.selectedId };
  // Persist active id immediately so runtime matches without a full Save.
  post({ type: 'setActiveEnvironment', id: state.selectedId });
  render();
});
el('deleteEnv').addEventListener('click', () => {
  if (selectedScope() !== 'environment' || !state.selectedId) return;
  const removedId = state.selectedId;
  const environments = state.environments.filter((entry) => entry.id !== removedId);
  const activeEnvironmentId =
    state.activeEnvironmentId === removedId ? undefined : state.activeEnvironmentId;
  const selectedId = environments[0]?.id ?? 'global';
  state = { ...state, environments, activeEnvironmentId, selectedId };
  setDirty(true);
  render();
});
el('addVar').addEventListener('click', () => {
  setCurrentVariables([...currentVariables(), { name: '', value: '', sensitive: false }]);
  setDirty(true);
  render();
});
el('save').addEventListener('click', () => {
  showError('');
  post({ type: 'commit', state });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'init' && message.state) {
    pendingActiveEnvironmentId = null;
    previousActiveEnvironmentId = undefined;
    state = {
      environments: message.state.environments || [],
      globalVariables: message.state.globalVariables || [],
      workspaceVariables: message.state.workspaceVariables || [],
      activeEnvironmentId: message.state.activeEnvironmentId,
      selectedId: message.state.selectedId
        || message.state.activeEnvironmentId
        || message.state.environments?.[0]?.id
        || 'global',
    };
    setDirty(false);
    showError('');
    render();
    return;
  }
  if (message.type === 'activeEnvironmentSet') {
    pendingActiveEnvironmentId = null;
    previousActiveEnvironmentId = undefined;
    state = { ...state, activeEnvironmentId: message.id };
    render();
    return;
  }
  // Distinct from save 'error' so a commit failure cannot roll back a pending
  // setActive (or misattribute the message) when both round-trips overlap.
  if (message.type === 'activeEnvironmentError') {
    if (pendingActiveEnvironmentId !== null) {
      state = { ...state, activeEnvironmentId: previousActiveEnvironmentId };
      pendingActiveEnvironmentId = null;
      previousActiveEnvironmentId = undefined;
      showError(message.message || 'Unable to set active environment.');
      render();
    }
    return;
  }
  if (message.type === 'error') {
    showError(message.message || 'Unable to save environments.');
  }
});

post({ type: 'ready' });
`;
