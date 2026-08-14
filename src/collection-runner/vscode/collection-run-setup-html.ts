/**
 * Pure HTML/CSS/JS and helpers for the Collection Run Setup webview.
 * No `vscode` import — keeps tests free of the extension host.
 */

import {
  AUTHENTICATION_UI_CSS,
  AUTHENTICATION_UI_KIND_LABELS,
} from '../../auth';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  isWebviewMessageRecord,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';
import type {
  CollectionRunAuthenticationPreference,
  CollectionRunFailurePolicyChoice,
} from '../collection-run-setup-model';
import { FailurePolicyKind } from '../models';

export type CollectionRunSetupInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'selectEnvironment'; readonly environmentId: string }
  | {
      readonly type: 'setAuthenticationPreference';
      readonly preference: CollectionRunAuthenticationPreference;
    }
  | { readonly type: 'toggleRequest'; readonly requestId: string }
  | { readonly type: 'toggleFolder'; readonly folderId: string }
  | { readonly type: 'toggleAllRequests' }
  | {
      readonly type: 'setFailurePolicy';
      readonly failurePolicy: CollectionRunFailurePolicyChoice;
    }
  | { readonly type: 'run' }
  | { readonly type: 'cancel' }
  | { readonly type: 'focusCollections' };

const AUTH_PREFERENCES = new Set<string>(['collection-default', 'resolved']);
const FAILURE_POLICIES = new Set<string>([
  FailurePolicyKind.ContinueOnError,
  FailurePolicyKind.StopOnFirstError,
]);

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseCollectionRunSetupMessage(
  value: unknown,
): CollectionRunSetupInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  const type = record.type;
  if (typeof type !== 'string') {
    return undefined;
  }

  if (
    type === 'ready' ||
    type === 'toggleAllRequests' ||
    type === 'run' ||
    type === 'cancel' ||
    type === 'focusCollections'
  ) {
    if (Object.keys(record).length !== 1) {
      return undefined;
    }
    return { type };
  }

  if (type === 'selectEnvironment') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.environmentId !== 'string'
    ) {
      return undefined;
    }
    return { type, environmentId: record.environmentId };
  }

  if (type === 'setAuthenticationPreference') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.preference !== 'string' ||
      !AUTH_PREFERENCES.has(record.preference)
    ) {
      return undefined;
    }
    return {
      type,
      preference: record.preference as CollectionRunAuthenticationPreference,
    };
  }

  if (type === 'toggleRequest') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.requestId !== 'string' ||
      record.requestId.trim().length === 0
    ) {
      return undefined;
    }
    return { type, requestId: record.requestId };
  }

  if (type === 'toggleFolder') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.folderId !== 'string' ||
      record.folderId.trim().length === 0
    ) {
      return undefined;
    }
    return { type, folderId: record.folderId };
  }

  if (type === 'setFailurePolicy') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.failurePolicy !== 'string' ||
      !FAILURE_POLICIES.has(record.failurePolicy)
    ) {
      return undefined;
    }
    return {
      type,
      failurePolicy: record.failurePolicy as CollectionRunFailurePolicyChoice,
    };
  }

  return undefined;
}

/** Builds a self-contained Collection Run Setup document with no remote access. */
export function renderCollectionRunSetupHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce)}">
<title>Run Collection</title>
<style nonce="${safeNonce}">${SETUP_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted" id="loading">Loading run setup…</p>
</main>
<script nonce="${safeNonce}">${SETUP_SCRIPT}</script>
</body>
</html>`;
}

const SETUP_CSS = `
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
}
main {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 720px;
}
.breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: var(--ah-space-1);
  margin: var(--ah-space-3) var(--ah-space-4) 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-textLink-foreground, var(--vscode-foreground));
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.breadcrumb:hover { text-decoration: underline; }
.header {
  padding: var(--ah-space-3) var(--ah-space-4) var(--ah-space-2);
}
.header h1 {
  margin: 0;
  font-size: 1.15em;
  font-weight: 600;
}
.subtitle {
  margin: var(--ah-space-1) 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
#error {
  display: none;
  margin: 0 var(--ah-space-4) var(--ah-space-2);
  padding: var(--ah-space-2) var(--ah-space-3);
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  border-radius: var(--ah-radius);
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--vscode-errorForeground, var(--vscode-foreground));
  font-size: 12px;
}
#error.visible { display: block; }
.setup-section {
  padding: var(--ah-space-3) var(--ah-space-4);
  border-top: 1px solid var(--vscode-panel-border);
}
.setup-collection, .setup-environment, .setup-variables,
.setup-authentication, .setup-requests, .setup-options { }
.setup-section h2 {
  margin: 0 0 var(--ah-space-2);
  font-size: 12px;
  font-weight: 600;
}
.collection-name { margin: 0; font-weight: 600; }
.collection-meta {
  margin: var(--ah-space-1) 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.workspace-label { margin: var(--ah-space-1) 0 0; font-size: 12px; }
select.env-select {
  display: block;
  width: 100%;
  max-width: 28rem;
}
.env-empty {
  margin: var(--ah-space-1) 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.var-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.var-row {
  display: grid;
  grid-template-columns: minmax(6rem, 10rem) 1fr auto;
  gap: var(--ah-space-2);
  align-items: baseline;
  padding: 4px 6px;
  border-radius: var(--ah-radius);
}
.var-row:hover { background: var(--vscode-list-hoverBackground); }
.var-name { font-family: var(--vscode-editor-font-family, var(--vscode-font-family)); font-size: 12px; }
.var-value {
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.var-scope { color: var(--vscode-descriptionForeground); font-size: 11px; }
.radio-list { display: flex; flex-direction: column; gap: var(--ah-space-2); }
.auth-override-hint {
  margin: 0 0 var(--ah-space-2);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.radio-row {
  display: flex;
  align-items: flex-start;
  gap: var(--ah-space-2);
  cursor: pointer;
  font-size: 12px;
}
.radio-row .detail { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
.requests-header {
  display: flex;
  align-items: center;
  gap: var(--ah-space-2);
  margin-bottom: var(--ah-space-2);
  font-size: 12px;
}
.setup-tree { list-style: none; margin: 0; padding: 0; }
.setup-tree ul { list-style: none; margin: 0; padding: 0 0 0 var(--ah-space-4); }
.tree-row {
  display: flex;
  align-items: center;
  gap: var(--ah-space-2);
  padding: 3px 4px;
  border-radius: var(--ah-radius);
  font-size: 12px;
}
.tree-row:hover { background: var(--vscode-list-hoverBackground); }
.folder-label { font-weight: 500; }
.setup-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--ah-space-2);
  padding: var(--ah-space-3) var(--ah-space-4) var(--ah-space-4);
  border-top: 1px solid var(--vscode-panel-border);
  margin-top: auto;
}
`;

const SETUP_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const AUTH_KIND_LABELS = ${JSON.stringify(AUTHENTICATION_UI_KIND_LABELS)};

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'checked') node.checked = !!value;
        else if (key === 'disabled') node.disabled = !!value;
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== undefined && value !== null && value !== false) {
          node.setAttribute(key, String(value));
        }
      }
    }
    if (children) {
      for (const child of children) {
        if (child === undefined || child === null || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    return node;
  }

  function showError(message) {
    let banner = document.getElementById('error');
    if (!banner) {
      banner = el('p', { id: 'error', className: 'visible', role: 'alert' });
      if (root.firstChild) document.body.insertBefore(banner, root);
      else document.body.appendChild(banner);
    }
    banner.textContent = message;
    banner.classList.add('visible');
  }

  function clearError() {
    const banner = document.getElementById('error');
    if (banner) {
      banner.textContent = '';
      banner.classList.remove('visible');
    }
  }

  function radio(name, value, checked, title, detail, onChange) {
    return el('label', { className: 'radio-row' }, [
      el('input', {
        type: 'radio',
        name: name,
        value: value,
        checked: checked,
        onChange: onChange,
      }),
      el('span', {}, [
        el('span', { text: title }),
        detail ? el('span', { className: 'detail', text: detail }) : null,
      ]),
    ]);
  }

  function renderTree(nodes) {
    const list = el('ul', { className: 'setup-tree' });
    for (const node of nodes) {
      list.appendChild(renderTreeNode(node));
    }
    return list;
  }

  function renderTreeNode(node) {
    if (node.kind === 'request') {
      return el('li', {}, [
        el('label', { className: 'tree-row' }, [
          el('input', {
            type: 'checkbox',
            checked: node.selected,
            onChange: function () {
              vscode.postMessage({ type: 'toggleRequest', requestId: node.id });
            },
          }),
          el('span', { className: node.methodBadgeClass, text: node.method }),
          el('span', { text: node.label }),
        ]),
      ]);
    }
    const children = node.children && node.children.length
      ? renderTree(node.children)
      : null;
    if (children) children.className = '';
    return el('li', {}, [
      el('label', { className: 'tree-row' }, [
        el('input', {
          type: 'checkbox',
          checked: node.selected,
          onChange: function () {
            vscode.postMessage({ type: 'toggleFolder', folderId: node.id });
          },
        }),
        el('span', { className: 'folder-label', text: node.label }),
      ]),
      children,
    ]);
  }

  function render(model) {
    if (model.error) showError(model.error);
    else clearError();
    root.replaceChildren();

    const breadcrumb = el('button', {
      type: 'button',
      className: 'breadcrumb',
      text: '\\u2190 Collections',
      onClick: function () { vscode.postMessage({ type: 'focusCollections' }); },
    });

    const header = el('header', { className: 'header' }, [
      el('h1', { text: 'Run Collection' }),
      el('p', {
        className: 'subtitle',
        text: 'Configure the collection before starting the run.',
      }),
    ]);

    const collectionBits = [model.requestCountLabel];
    if (model.description) collectionBits.push(model.description);
    const collectionSection = el('section', { className: 'setup-section setup-collection' }, [
      el('h2', { text: 'Collection' }),
      el('p', { className: 'collection-name', text: model.collectionName }),
      el('p', { className: 'collection-meta', text: collectionBits.join(' \\u00b7 ') }),
      model.workspaceLabel
        ? el('p', { className: 'workspace-label muted', text: model.workspaceLabel })
        : null,
    ]);

    const envSelect = el('select', {
      className: 'env-select',
      'aria-label': 'Environment',
      onChange: function (event) {
        vscode.postMessage({
          type: 'selectEnvironment',
          environmentId: event.target.value,
        });
      },
    });
    for (const option of model.environments) {
      envSelect.appendChild(el('option', {
        value: option.id,
        text: option.label,
      }));
    }
    envSelect.value = model.selectedEnvironmentId;
    const environmentSection = el('section', { className: 'setup-section setup-environment' }, [
      el('h2', { text: 'Environment' }),
      envSelect,
      model.hasEnvironment
        ? null
        : el('p', { className: 'env-empty', text: 'No environment selected for this run.' }),
    ]);

    const variableItems = model.variables.length === 0
      ? [el('p', { className: 'empty-state compact', text: 'No variables resolve for this run.' })]
      : [el('ul', { className: 'var-list' }, model.variables.map(function (row) {
          return el('li', { className: 'var-row' }, [
            el('span', { className: 'var-name', text: row.name }),
            el('span', { className: 'var-value', text: row.displayValue }),
            el('span', { className: 'var-scope', text: row.scopeLabel }),
          ]);
        }))];
    const variablesSection = el('section', { className: 'setup-section setup-variables' }, [
      el('h2', { text: 'Variables' }),
    ].concat(variableItems));

    const auth = model.authentication;
    const ui = auth.ui || {};
    const uiFields = Array.isArray(ui.fields) ? ui.fields : [];
    const typeLabel = AUTH_KIND_LABELS[ui.selectedKind] || AUTH_KIND_LABELS.none;
    const fieldRows = uiFields.map(function (field) {
      return el('div', { className: 'auth-ui-field-row' }, [
        el('span', { className: 'auth-field-label', text: field.label }),
        el('span', { className: 'auth-field-display', text: field.display || '—' }),
      ]);
    });
    const authenticationSection = el('section', { className: 'setup-section setup-authentication' }, [
      el('h2', { text: 'Authentication' }),
      el('div', { className: 'auth-ui-summary' }, [
        el('p', { className: 'auth-effective', text: ui.effectiveLabel || auth.collectionDefaultDisplay || 'None' }),
        el('p', { className: 'auth-type', text: 'Type: ' + typeLabel }),
      ].concat(fieldRows)),
      el('p', {
        className: 'hint auth-override-hint',
        text: auth.perRequestOverrideHint || 'Per-request @auth still overrides collection and session defaults.',
      }),
      el('div', { className: 'radio-list' }, [
        radio(
          'auth',
          'collection-default',
          auth.preference === 'collection-default',
          'Collection default',
          auth.collectionDefaultDisplay,
          function () {
            vscode.postMessage({
              type: 'setAuthenticationPreference',
              preference: 'collection-default',
            });
          },
        ),
        radio(
          'auth',
          'resolved',
          auth.preference === 'resolved',
          'Environment / resolved authentication',
          auth.resolvedDisplay,
          function () {
            vscode.postMessage({
              type: 'setAuthenticationPreference',
              preference: 'resolved',
            });
          },
        ),
      ]),
    ]);

    const selectedLabel = model.selectedRequestCount === 1
      ? '1 request selected'
      : model.selectedRequestCount + ' requests selected';
    const requestsSection = el('section', { className: 'setup-section setup-requests' }, [
      el('h2', { text: 'Requests' }),
      el('div', { className: 'requests-header' }, [
        el('label', { className: 'tree-row' }, [
          el('input', {
            type: 'checkbox',
            checked: model.allRequestsSelected,
            onChange: function () {
              vscode.postMessage({ type: 'toggleAllRequests' });
            },
          }),
          el('span', { text: selectedLabel }),
        ]),
      ]),
      renderTree(model.tree),
    ]);

    const optionsSection = el('section', { className: 'setup-section setup-options' }, [
      el('h2', { text: 'Run options' }),
      el('div', { className: 'radio-list' }, [
        radio(
          'failurePolicy',
          'continue-on-error',
          model.failurePolicy === 'continue-on-error',
          'Continue on failure',
          'Keep running remaining requests after a failure.',
          function () {
            vscode.postMessage({
              type: 'setFailurePolicy',
              failurePolicy: 'continue-on-error',
            });
          },
        ),
        radio(
          'failurePolicy',
          'stop-on-first-error',
          model.failurePolicy === 'stop-on-first-error',
          'Stop on first failure',
          'Stop the run when a request fails.',
          function () {
            vscode.postMessage({
              type: 'setFailurePolicy',
              failurePolicy: 'stop-on-first-error',
            });
          },
        ),
      ]),
    ]);

    const footer = el('footer', { className: 'setup-footer' }, [
      el('button', {
        type: 'button',
        className: 'secondary',
        text: 'Cancel',
        onClick: function () { vscode.postMessage({ type: 'cancel' }); },
      }),
      el('button', {
        type: 'button',
        className: 'primary',
        text: 'Run Collection \\u2192',
        disabled: model.canRun === false,
        onClick: function () { vscode.postMessage({ type: 'run' }); },
      }),
    ]);

    root.appendChild(breadcrumb);
    root.appendChild(header);
    root.appendChild(collectionSection);
    root.appendChild(environmentSection);
    root.appendChild(variablesSection);
    root.appendChild(authenticationSection);
    root.appendChild(requestsSection);
    root.appendChild(optionsSection);
    root.appendChild(footer);
  }

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init' && message.model) {
      render(message.model);
      return;
    }
    if (message.type === 'error') {
      showError(message.message || 'Unable to configure this collection run.');
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
