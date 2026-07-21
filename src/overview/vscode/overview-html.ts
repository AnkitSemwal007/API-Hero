/**
 * Pure HTML/CSS/JS and helpers for the Overview command panel webview.
 * No `vscode` import — keeps tests free of the extension host.
 */

import type { WorkspaceCollections } from '../../collections/models';
import {
  HistoryExecutionStatus,
  type HistoryEntry,
  type HistoryExecutionStatus as HistoryStatus,
} from '../../history/models';
import {
  escapeAttribute,
  escapeHtml,
  formatDuration,
} from '../../history/vscode/history-detail-html';

const RECENT_HISTORY_LIMIT = 8;
const RECENT_COLLECTION_LIMIT = 8;

/** Quick-action identifiers posted from the Overview webview. */
export const OverviewQuickAction = {
  CreateRequest: 'createRequest',
  CreateCollection: 'createCollection',
  ImportOpenApi: 'importOpenApi',
  ManageEnvironments: 'manageEnvironments',
  ManageAuthProfiles: 'manageAuthProfiles',
  FocusCollections: 'focusCollections',
} as const;

export type OverviewQuickAction =
  (typeof OverviewQuickAction)[keyof typeof OverviewQuickAction];

const QUICK_ACTION_IDS = new Set<string>(Object.values(OverviewQuickAction));

/** One recent history row for the Overview panel. */
export interface OverviewHistoryItem {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly title: string;
  readonly outcome: HistoryStatus;
  readonly statusBadgeText: string;
  readonly statusBadgeClass: string;
  readonly durationLabel: string;
  readonly timestampLabel: string;
}

/** One recent collection row for the Overview panel. */
export interface OverviewCollectionItem {
  readonly id: string;
  readonly label: string;
  readonly kind: 'native' | 'legacy';
  readonly kindLabel: string;
  readonly requestCount: number;
  readonly requestCountLabel: string;
  readonly description?: string;
}

/** Serializable view model posted to the Overview webview. */
export interface OverviewModel {
  readonly history: readonly OverviewHistoryItem[];
  readonly collections: readonly OverviewCollectionItem[];
  readonly historyEmpty: boolean;
  readonly collectionsEmpty: boolean;
  readonly hasWorkspace: boolean;
}

export type OverviewInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | { readonly type: 'runAction'; readonly action: OverviewQuickAction }
  | { readonly type: 'openHistory'; readonly id: string }
  | { readonly type: 'focusCollections' };

export type OverviewOutboundMessage =
  | { readonly type: 'init'; readonly model: OverviewModel }
  | { readonly type: 'error'; readonly message: string };

/** Builds the Overview model from history + discovery snapshots. */
export function buildOverviewModel(
  historyEntries: readonly HistoryEntry[],
  collections: WorkspaceCollections | undefined,
  options: {
    readonly historyLimit?: number;
    readonly collectionLimit?: number;
  } = {},
): OverviewModel {
  const historyLimit = options.historyLimit ?? RECENT_HISTORY_LIMIT;
  const collectionLimit = options.collectionLimit ?? RECENT_COLLECTION_LIMIT;

  const history = historyEntries
    .slice(0, Math.max(0, historyLimit))
    .map(toHistoryItem);

  const collectionItems = listRecentCollections(collections, collectionLimit);
  const hasWorkspace =
    collections !== undefined && collections.workspaceRoots.length > 0;

  return {
    history,
    collections: collectionItems,
    historyEmpty: history.length === 0,
    collectionsEmpty: collectionItems.length === 0,
    hasWorkspace,
  };
}

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseOverviewMessage(
  value: unknown,
): OverviewInboundMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string') {
    return undefined;
  }

  if (type === 'ready' || type === 'refresh' || type === 'focusCollections') {
    if (Object.keys(record).length !== 1) {
      return undefined;
    }
    return { type };
  }

  if (type === 'runAction') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.action !== 'string' ||
      !QUICK_ACTION_IDS.has(record.action)
    ) {
      return undefined;
    }
    return {
      type: 'runAction',
      action: record.action as OverviewQuickAction,
    };
  }

  if (type === 'openHistory') {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.id !== 'string' ||
      record.id.trim().length === 0
    ) {
      return undefined;
    }
    return { type: 'openHistory', id: record.id };
  }

  return undefined;
}

/** Builds a self-contained Overview document with no remote resource access. */
export function renderOverviewHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>API Hero Overview</title>
<style nonce="${safeNonce}">${OVERVIEW_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted" id="loading">Loading overview…</p>
</main>
<script nonce="${safeNonce}">${OVERVIEW_SCRIPT}</script>
</body>
</html>`;
}

export { escapeAttribute, escapeHtml, formatDuration };

function toHistoryItem(entry: HistoryEntry): OverviewHistoryItem {
  const { summary, metadata } = entry;
  const badge = resolveStatusBadge(summary);
  const name = metadata.requestName?.trim();
  const title =
    name !== undefined && name.length > 0
      ? name
      : `${summary.method} ${shortUrl(summary.url)}`;
  return {
    id: entry.id,
    method: summary.method,
    url: summary.url,
    title,
    outcome: summary.status,
    statusBadgeText: badge.text,
    statusBadgeClass: badge.className,
    durationLabel: formatDuration(summary.durationMs),
    timestampLabel: formatTimestamp(summary.timestamp),
  };
}

function listRecentCollections(
  collections: WorkspaceCollections | undefined,
  limit: number,
): OverviewCollectionItem[] {
  if (collections === undefined || limit <= 0) {
    return [];
  }
  const items = Object.values(collections.collections).map((collection) => {
    const description = collection.metadata.description?.trim();
    return {
      id: collection.id,
      label: collection.display.label,
      kind: collection.kind,
      kindLabel: collection.kind === 'legacy' ? 'Legacy' : 'Collection',
      requestCount: collection.metadata.requestCount,
      requestCountLabel:
        collection.metadata.requestCount === 1
          ? '1 request'
          : `${collection.metadata.requestCount} requests`,
      ...(description !== undefined && description.length > 0
        ? { description }
        : {}),
      lastModified: collection.metadata.lastModified ?? 0,
    };
  });
  items.sort((a, b) => {
    if (b.lastModified !== a.lastModified) {
      return b.lastModified - a.lastModified;
    }
    return a.label.localeCompare(b.label);
  });
  return items.slice(0, limit).map(({ lastModified: _ignored, ...item }) => item);
}

function resolveStatusBadge(summary: HistoryEntry['summary']): {
  readonly text: string;
  readonly className: string;
} {
  if (summary.status === HistoryExecutionStatus.Cancelled) {
    return { text: 'Cancelled', className: 'status-cancelled' };
  }
  if (summary.status === HistoryExecutionStatus.Failure) {
    if (summary.statusCode !== undefined) {
      return {
        text: String(summary.statusCode),
        className: statusClass(summary.statusCode),
      };
    }
    return { text: 'Failed', className: 'status-error' };
  }
  if (summary.statusCode !== undefined) {
    return {
      text: String(summary.statusCode),
      className: statusClass(summary.statusCode),
    };
  }
  return { text: 'OK', className: 'status-success' };
}

function statusClass(code: number): string {
  if (code >= 200 && code < 300) {
    return 'status-success';
  }
  if (code >= 300 && code < 400) {
    return 'status-redirect';
  }
  if (code >= 400) {
    return 'status-error';
  }
  return 'status-neutral';
}

function formatTimestamp(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) {
    return timestamp;
  }
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function shortUrl(url: string): string {
  return url.length > 56 ? `${url.slice(0, 53)}…` : url;
}

const OVERVIEW_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
main { display: flex; flex-direction: column; min-height: 100vh; }
.toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.toolbar h1 {
  margin: 0; flex: 1 1 auto;
  font-size: 1.05em; font-weight: 600;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 0;
  flex: 1;
}
@media (max-width: 720px) {
  .layout { grid-template-columns: 1fr; }
}
.panel {
  padding: 14px 16px 20px;
  border-right: 1px solid var(--vscode-panel-border);
  min-width: 0;
}
.panel:last-child { border-right: none; }
.panel h2 {
  margin: 0 0 10px;
  font-size: .95em;
  font-weight: 600;
}
.muted { color: var(--vscode-descriptionForeground); }
.empty {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--vscode-panel-border);
  border-radius: 2px;
  color: var(--vscode-descriptionForeground);
}
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex; flex-direction: column; gap: 4px;
  width: 100%; text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 2px;
  background: var(--vscode-sideBar-background);
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.row:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}
.row-title {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-weight: 600;
}
.row-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
}
.method {
  color: var(--vscode-textLink-foreground);
  font-weight: 600;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.url { overflow-wrap: anywhere; }
.status-badge {
  display: inline-flex; align-items: center;
  border-radius: 2px; padding: 1px 6px; font-weight: 600; font-size: .85em;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.status-success { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.status-redirect { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
.status-error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
.status-cancelled { background: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); color: var(--vscode-editor-background); }
.status-neutral { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.actions {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-top: 4px;
}
button.action, button.secondary {
  appearance: none;
  border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
  border-radius: 2px;
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button.action:hover, button.secondary:hover {
  background: var(--vscode-button-hoverBackground);
}
button.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}
.banner {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 2px;
  border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
  background: var(--vscode-inputValidation-warningBackground, transparent);
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
}
#error {
  display: none;
  margin: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--vscode-errorForeground, var(--vscode-foreground));
}
#error.visible { display: block; }
`;

const OVERVIEW_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
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
      banner = el('p', { id: 'error', className: 'visible' });
      document.body.insertBefore(banner, root);
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

  function render(model) {
    clearError();
    root.replaceChildren();

    const toolbar = el('div', { className: 'toolbar' }, [
      el('h1', { text: 'Overview' }),
      el('button', {
        type: 'button',
        className: 'secondary',
        text: 'Refresh',
        onClick: function () { vscode.postMessage({ type: 'refresh' }); },
      }),
    ]);

    const historySection = el('section', { className: 'panel' }, [
      el('h2', { text: 'Recent runs' }),
      model.historyEmpty
        ? el('p', {
            className: 'empty',
            text: 'No recent runs yet. Run a request from Collections or the editor to start building history.',
          })
        : el(
            'ul',
            { className: 'list' },
            model.history.map(function (item) {
              return el('li', {}, [
                el('button', {
                  type: 'button',
                  className: 'row',
                  onClick: function () {
                    vscode.postMessage({ type: 'openHistory', id: item.id });
                  },
                }, [
                  el('div', { className: 'row-title' }, [
                    el('span', { className: 'method', text: item.method }),
                    el('span', { text: item.title }),
                    el('span', {
                      className: 'status-badge ' + item.statusBadgeClass,
                      text: item.statusBadgeText,
                    }),
                  ]),
                  el('div', { className: 'row-meta' }, [
                    el('span', { className: 'url', text: item.url }),
                    el('span', { text: item.durationLabel }),
                    el('span', { text: item.timestampLabel }),
                  ]),
                ]),
              ]);
            }),
          ),
    ]);

    const collectionSection = el('section', { className: 'panel' }, [
      el('h2', { text: 'Recent collections' }),
      !model.hasWorkspace
        ? el('p', {
            className: 'banner',
            text: 'Open a workspace folder to discover collections.',
          })
        : null,
      model.collectionsEmpty
        ? el('p', {
            className: 'empty',
            text: model.hasWorkspace
              ? 'No collections yet. Create one or import an OpenAPI specification.'
              : 'Collections appear here after a workspace is open.',
          })
        : el(
            'ul',
            { className: 'list' },
            model.collections.map(function (item) {
              return el('li', {}, [
                el('button', {
                  type: 'button',
                  className: 'row',
                  onClick: function () {
                    vscode.postMessage({ type: 'focusCollections' });
                  },
                }, [
                  el('div', { className: 'row-title' }, [
                    el('span', { text: item.label }),
                    el('span', { className: 'status-badge status-neutral', text: item.kindLabel }),
                  ]),
                  el('div', { className: 'row-meta' }, [
                    el('span', { text: item.requestCountLabel }),
                    item.description
                      ? el('span', { text: item.description })
                      : null,
                  ]),
                ]),
              ]);
            }),
          ),
      el('h2', { text: 'Quick actions', style: 'margin-top:16px' }),
      el('div', { className: 'actions' }, [
        actionButton('Create Request', 'createRequest'),
        actionButton('Create Collection', 'createCollection'),
        actionButton('Import OpenAPI', 'importOpenApi'),
        actionButton('Manage Environments', 'manageEnvironments'),
        actionButton('Manage Auth Profiles', 'manageAuthProfiles'),
        actionButton('Focus Collections', 'focusCollections'),
      ]),
    ]);

    root.appendChild(toolbar);
    root.appendChild(el('div', { className: 'layout' }, [historySection, collectionSection]));
  }

  function actionButton(label, action) {
    return el('button', {
      type: 'button',
      className: 'action',
      text: label,
      onClick: function () {
        vscode.postMessage({ type: 'runAction', action: action });
      },
    });
  }

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init') {
      render(message.model);
      return;
    }
    if (message.type === 'error') {
      showError(message.message || 'Unable to load overview.');
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
