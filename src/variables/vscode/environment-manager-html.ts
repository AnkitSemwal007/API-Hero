/**
 * Pure HTML/CSS/JS and message helpers for the Environment Manager webview.
 * No `vscode` import — keeps core/tests free of the extension host.
 */

import { MASKED_VARIABLE_VALUE } from '../variable-resolver';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
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
  | {
      readonly type: 'commit';
      readonly state: EnvironmentManagerState;
    };

export type EnvironmentManagerOutboundMessage =
  | { readonly type: 'init'; readonly state: EnvironmentManagerState }
  | { readonly type: 'error'; readonly message: string };

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

  if (
    state.activeEnvironmentId !== undefined &&
    !ids.has(state.activeEnvironmentId)
  ) {
    return `Unknown active environment "${state.activeEnvironmentId}".`;
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
  return {
    ...incoming,
    environments: incoming.environments.map((environment) => ({
      ...environment,
      variables: restoreVariables(
        environment.variables,
        baselineByEnv.get(environment.id) ?? [],
      ),
    })),
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
  <aside>
    <div class="aside-header">
      <h1>Environments</h1>
      <button type="button" id="addEnv" class="primary" title="Add environment">Add</button>
    </div>
    <ul id="envList" class="env-list" role="listbox" aria-label="Environments"></ul>
    <div class="scope-list">
      <button type="button" class="scope-item" data-scope="global" id="scopeGlobal">Global variables</button>
      <button type="button" class="scope-item" data-scope="workspace" id="scopeWorkspace">Workspace variables</button>
    </div>
  </aside>
  <main>
    <header class="main-header">
      <div class="title-row">
        <input id="envName" type="text" autocomplete="off" placeholder="Environment name" aria-label="Environment name" />
        <button type="button" id="setActive" class="secondary">Set Active</button>
        <button type="button" id="deleteEnv" class="danger">Delete</button>
      </div>
      <p id="scopeHint" class="hint" hidden></p>
      <p id="activeBadge" class="badge" hidden>Active</p>
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
  const activeEnvironmentId =
    record.activeEnvironmentId === undefined ||
    record.activeEnvironmentId === null
      ? undefined
      : typeof record.activeEnvironmentId === 'string'
        ? record.activeEnvironmentId
        : undefined;
  if (
    record.activeEnvironmentId !== undefined &&
    record.activeEnvironmentId !== null &&
    typeof record.activeEnvironmentId !== 'string'
  ) {
    return undefined;
  }
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
  const baselineSensitive = new Map(
    baseline
      .filter((variable) => variable.sensitive)
      .map((variable) => [variable.name, variable.value] as const),
  );
  return incoming.map((variable) => {
    if (!variable.sensitive) {
      return {
        name: variable.name.trim(),
        value: variable.value,
        sensitive: false,
      };
    }
    const original = baselineSensitive.get(variable.name);
    if (
      original !== undefined &&
      (variable.value === MASKED_VARIABLE_VALUE || variable.value === original)
    ) {
      return {
        name: variable.name.trim(),
        value: original,
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
.env-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow: auto;
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
.env-item .meta {
  display: block;
  font-size: .85em;
  color: var(--vscode-descriptionForeground);
}
.env-item.active .meta { color: inherit; opacity: .85; }
.scope-list { display: flex; flex-direction: column; gap: 2px; }
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
@media (max-width: 720px) {
  #app { grid-template-columns: 1fr; }
  aside { border-right: none; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder)); }
}
`;

const MANAGER_SCRIPT = `
const vscode = acquireVsCodeApi();
const MASK = ${JSON.stringify(MASKED_VARIABLE_VALUE)};

/** @type {any} */
let state = {
  environments: [],
  globalVariables: [],
  workspaceVariables: [],
  activeEnvironmentId: undefined,
  selectedId: 'global',
};
let dirty = false;

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

function allocateId(name) {
  const existing = new Set(state.environments.map((entry) => entry.id));
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
  for (const environment of state.environments) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'env-item' + (state.selectedId === environment.id ? ' active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', state.selectedId === environment.id ? 'true' : 'false');
    const label = document.createElement('span');
    label.textContent = environment.name || environment.id;
    item.appendChild(label);
    if (environment.id === state.activeEnvironmentId) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = 'Active';
      item.appendChild(meta);
    }
    item.addEventListener('click', () => {
      state = { ...state, selectedId: environment.id };
      render();
    });
    list.appendChild(item);
  }

  el('scopeGlobal').classList.toggle('active', state.selectedId === 'global');
  el('scopeWorkspace').classList.toggle('active', state.selectedId === 'workspace');
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

function renderMain() {
  const scope = selectedScope();
  const nameInput = el('envName');
  const setActive = el('setActive');
  const deleteEnv = el('deleteEnv');
  const hint = el('scopeHint');
  const badge = el('activeBadge');

  if (scope === 'global' || scope === 'workspace') {
    nameInput.disabled = true;
    nameInput.value = scope === 'global' ? 'Global variables' : 'Workspace variables';
    setActive.disabled = true;
    deleteEnv.disabled = true;
    hint.hidden = false;
    hint.textContent = scope === 'global'
      ? 'Shared across all workspaces (user settings).'
      : 'Shared for this workspace.';
    badge.hidden = true;
  } else {
    const environment = state.environments.find((entry) => entry.id === state.selectedId);
    nameInput.disabled = !environment;
    nameInput.value = environment ? environment.name : '';
    setActive.disabled = !environment;
    deleteEnv.disabled = !environment;
    hint.hidden = true;
    const isActive = environment && environment.id === state.activeEnvironmentId;
    badge.hidden = !isActive;
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
el('envName').addEventListener('input', () => {
  if (selectedScope() !== 'environment') return;
  const name = el('envName').value;
  state = {
    ...state,
    environments: state.environments.map((entry) =>
      entry.id === state.selectedId ? { ...entry, name } : entry),
  };
  setDirty(true);
  renderList();
});
el('setActive').addEventListener('click', () => {
  if (selectedScope() !== 'environment' || !state.selectedId) return;
  state = { ...state, activeEnvironmentId: state.selectedId };
  setDirty(true);
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
  if (message.type === 'error') {
    showError(message.message || 'Unable to save environments.');
  }
});

post({ type: 'ready' });
`;
