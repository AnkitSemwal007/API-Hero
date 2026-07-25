/**
 * Pure HTML/CSS/JS and helpers for the History Detail webview.
 * No `vscode` import — keeps tests free of the extension host.
 * Metadata only: never includes response bodies.
 */

import {
  HistoryExecutionStatus,
  type HistoryEntry,
  type HistoryExecutionStatus as HistoryStatus,
} from '../models';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
  isWebviewMessageRecord,
  methodBadgeClass,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export { escapeAttribute, escapeHtml };

/** Serializable view model posted to the History Detail webview. */
export interface HistoryDetailModel {
  readonly id: string;
  readonly method: string;
  readonly methodBadgeClass: string;
  readonly url: string;
  readonly outcome: HistoryStatus;
  readonly outcomeLabel: string;
  readonly statusBadgeText: string;
  readonly statusBadgeClass: string;
  readonly durationLabel: string;
  readonly timestamp: string;
  readonly timestampLabel: string;
  readonly requestName?: string;
  readonly environmentName?: string;
  readonly collectionName?: string;
  readonly contentType?: string;
  readonly responseSizeLabel?: string;
  readonly httpStatusLabel?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly sourceUri?: string;
  readonly canRerun: boolean;
  readonly canReveal: boolean;
  /** Plain-text summary for clipboard copy. */
  readonly summaryText: string;
}

export type HistoryDetailInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'rerun' }
  | { readonly type: 'reveal' }
  | { readonly type: 'copySummary' }
  | { readonly type: 'delete' };

export type HistoryDetailOutboundMessage =
  | { readonly type: 'init'; readonly model: HistoryDetailModel }
  | { readonly type: 'error'; readonly message: string };

const ACTION_TYPES = new Set([
  'ready',
  'rerun',
  'reveal',
  'copySummary',
  'delete',
]);

/** Builds the metadata-only detail model from a history entry. */
export function buildHistoryDetailModel(entry: HistoryEntry): HistoryDetailModel {
  const { summary, metadata } = entry;
  const hasSource =
    typeof metadata.source?.uri === 'string' &&
    metadata.source.uri.trim().length > 0;
  const statusBadge = resolveStatusBadge(summary);
  const durationLabel = formatDuration(summary.durationMs);
  const timestampLabel = formatTimestamp(summary.timestamp);
  const httpStatusLabel =
    summary.statusCode === undefined
      ? undefined
      : `${summary.statusCode}${
          summary.statusText === undefined || summary.statusText.length === 0
            ? ''
            : ` ${summary.statusText}`
        }`;
  const responseSizeLabel =
    metadata.responseSizeBytes === undefined
      ? undefined
      : formatBytes(metadata.responseSizeBytes);

  const model: HistoryDetailModel = {
    id: entry.id,
    method: summary.method,
    methodBadgeClass: methodBadgeClass(summary.method),
    url: summary.url,
    outcome: summary.status,
    outcomeLabel: outcomeLabel(summary.status),
    statusBadgeText: statusBadge.text,
    statusBadgeClass: statusBadge.className,
    durationLabel,
    timestamp: summary.timestamp,
    timestampLabel,
    ...(metadata.requestName === undefined
      ? {}
      : { requestName: metadata.requestName }),
    ...(metadata.environmentName === undefined
      ? {}
      : { environmentName: metadata.environmentName }),
    ...(metadata.collectionName === undefined
      ? {}
      : { collectionName: metadata.collectionName }),
    ...(metadata.contentType === undefined
      ? {}
      : { contentType: metadata.contentType }),
    ...(responseSizeLabel === undefined ? {} : { responseSizeLabel }),
    ...(httpStatusLabel === undefined ? {} : { httpStatusLabel }),
    ...(metadata.errorCode === undefined ? {} : { errorCode: metadata.errorCode }),
    ...(metadata.errorMessage === undefined
      ? {}
      : { errorMessage: metadata.errorMessage }),
    ...(hasSource ? { sourceUri: metadata.source!.uri } : {}),
    canRerun: hasSource,
    canReveal: hasSource,
    summaryText: formatHistorySummaryText(entry),
  };
  return model;
}

/** Plain-text multi-line summary suitable for the clipboard. */
export function formatHistorySummaryText(entry: HistoryEntry): string {
  const lines = [
    `${entry.summary.method} ${entry.summary.url}`,
    `Outcome: ${outcomeLabel(entry.summary.status)}`,
    entry.summary.statusCode === undefined
      ? undefined
      : `HTTP: ${entry.summary.statusCode}${
          entry.summary.statusText === undefined ||
          entry.summary.statusText.length === 0
            ? ''
            : ` ${entry.summary.statusText}`
        }`,
    `Duration: ${formatDuration(entry.summary.durationMs)}`,
    `Completed: ${entry.summary.timestamp}`,
    entry.metadata.requestName === undefined
      ? undefined
      : `Name: ${entry.metadata.requestName}`,
    entry.metadata.environmentName === undefined
      ? undefined
      : `Environment: ${entry.metadata.environmentName}`,
    entry.metadata.collectionName === undefined
      ? undefined
      : `Collection: ${entry.metadata.collectionName}`,
    entry.metadata.contentType === undefined
      ? undefined
      : `Content-Type: ${entry.metadata.contentType}`,
    entry.metadata.responseSizeBytes === undefined
      ? undefined
      : `Response size: ${formatBytes(entry.metadata.responseSizeBytes)}`,
    entry.metadata.errorCode === undefined
      ? undefined
      : `Error: ${entry.metadata.errorCode}${
          entry.metadata.errorMessage === undefined
            ? ''
            : ` — ${entry.metadata.errorMessage}`
        }`,
    entry.metadata.source?.uri === undefined
      ? undefined
      : `Source: ${entry.metadata.source.uri}`,
  ].filter((line): line is string => line !== undefined);
  return lines.join('\n');
}

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseHistoryDetailMessage(
  value: unknown,
): HistoryDetailInboundMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  const keys = Object.keys(record);
  if (keys.length !== 1 || typeof record.type !== 'string') {
    return undefined;
  }
  if (!ACTION_TYPES.has(record.type)) {
    return undefined;
  }
  return { type: record.type as HistoryDetailInboundMessage['type'] };
}

/** Builds a self-contained History Detail document with no remote resource access. */
export function renderHistoryDetailHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce, { allowDataImages: true })}">
<title>History Detail</title>
<style nonce="${safeNonce}">${DETAIL_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted loading" id="loading">Loading history entry…</p>
</main>
<script nonce="${safeNonce}">${DETAIL_SCRIPT}</script>
</body>
</html>`;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function outcomeLabel(status: HistoryStatus): string {
  switch (status) {
    case HistoryExecutionStatus.Success:
      return 'Success';
    case HistoryExecutionStatus.Cancelled:
      return 'Cancelled';
    case HistoryExecutionStatus.Failure:
    default:
      return 'Failure';
  }
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
      text: `${summary.statusCode}${
        summary.statusText === undefined || summary.statusText.length === 0
          ? ''
          : ` ${summary.statusText}`
      }`,
      className: statusClass(summary.statusCode),
    };
  }
  return { text: 'Success', className: 'status-success' };
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
    timeStyle: 'medium',
  });
}

const DETAIL_CSS = `
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
main { display: flex; flex-direction: column; gap: 0; min-height: 100vh; }
.loading { padding: var(--ah-space-4); }
.toolbar {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
  padding: var(--ah-space-2) var(--ah-space-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.toolbar .spacer { flex: 1 1 auto; min-width: var(--ah-space-2); }
.status-card {
  padding: var(--ah-space-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.status-row, .request-line, .stats-summary {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
}
.status-row { margin-bottom: var(--ah-space-2); }
.request-line {
  color: var(--vscode-descriptionForeground);
  overflow-wrap: anywhere;
  margin-bottom: var(--ah-space-3);
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.request-line strong { color: var(--vscode-textLink-foreground); font-weight: 600; }
.meta-sections { padding: var(--ah-space-3) var(--ah-space-4) var(--ah-space-4); display: flex; flex-direction: column; gap: var(--ah-space-3); }
.meta-group h2 {
  margin: 0 0 var(--ah-space-2);
  font-size: .75em; font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
  color: var(--vscode-descriptionForeground);
}
.meta-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: var(--ah-space-2);
}
.stat {
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: var(--ah-radius); padding: var(--ah-space-2) 10px; min-width: 0;
}
.stat span { display: block; color: var(--vscode-descriptionForeground); font-size: .8em; }
.stat strong { display: block; margin-top: 2px; overflow-wrap: anywhere; font-weight: 600; }
.error-callout {
  margin: 0; padding: var(--ah-space-3) var(--ah-space-4);
  border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
  background: var(--vscode-inputValidation-errorBackground, transparent);
}
.error-callout h2 {
  margin: 0 0 var(--ah-space-1); font-size: .95em;
  color: var(--vscode-editorError-foreground);
  text-transform: none; letter-spacing: 0;
}
.error-callout p { margin: 0; overflow-wrap: anywhere; }
.error-callout code {
  font-family: var(--vscode-editor-font-family);
}
.notice {
  padding: var(--ah-space-2) 10px;
  color: var(--vscode-descriptionForeground);
  font-size: .88em;
  border-left: 2px solid var(--vscode-panel-border);
  overflow-wrap: anywhere;
}
`;

const DETAIL_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('\`', '&#96;');
  }

  function statChip(label, value) {
    return '<div class="stat-chip"><span>' + escapeHtml(label) + '</span><strong title="' +
      escapeAttribute(value) + '">' + escapeHtml(value) + '</strong></div>';
  }

  function stat(label, value) {
    return '<div class="stat"><span>' + escapeHtml(label) + '</span><strong title="' +
      escapeAttribute(value) + '">' + escapeHtml(value) + '</strong></div>';
  }

  function render(model) {
    const chips = [
      statChip('Duration', model.durationLabel),
      model.responseSizeLabel ? statChip('Size', model.responseSizeLabel) : '',
      model.contentType ? statChip('Type', model.contentType) : '',
    ].join('');

    const contextMeta = [
      model.requestName ? stat('Name', model.requestName) : '',
      model.environmentName ? stat('Environment', model.environmentName) : '',
      model.collectionName ? stat('Collection', model.collectionName) : '',
      stat('Completed', model.timestampLabel),
    ].join('');

    const responseMeta = [
      model.httpStatusLabel ? stat('HTTP', model.httpStatusLabel) : '',
      model.sourceUri ? stat('Source', model.sourceUri) : '',
    ].join('');

    const error = model.errorCode || model.errorMessage
      ? '<section class="error-callout" role="alert">' +
        '<h2 id="failure-title">Error</h2>' +
        (model.errorCode ? '<p><code>' + escapeHtml(model.errorCode) + '</code></p>' : '') +
        (model.errorMessage ? '<p>' + escapeHtml(model.errorMessage) + '</p>' : '') +
        '</section>'
      : '';

    root.innerHTML =
      '<div class="toolbar sticky-toolbar" role="toolbar" aria-label="History actions">' +
        '<button type="button" id="rerun" class="primary"' + (model.canRerun ? '' : ' disabled') + '>Re-run</button>' +
        '<button type="button" id="reveal"' + (model.canReveal ? '' : ' disabled') + '>Reveal</button>' +
        '<button type="button" id="copySummary">Copy summary</button>' +
        '<span class="spacer" aria-hidden="true"></span>' +
        '<button type="button" id="delete" class="danger">Delete</button>' +
      '</div>' +
      '<header class="status-card">' +
        '<div class="status-row">' +
          '<span class="status-badge ' + escapeAttribute(model.statusBadgeClass) + '">' +
            escapeHtml(model.statusBadgeText) +
          '</span>' +
          '<div class="stats-summary" aria-label="Run statistics">' + chips + '</div>' +
        '</div>' +
        '<div class="request-line"><span class="' + escapeAttribute(model.methodBadgeClass) + '">' +
          escapeHtml(model.method) + '</span> <span>' +
          escapeHtml(model.url) + '</span></div>' +
      '</header>' +
      '<div class="meta-sections">' +
        error +
        '<section class="meta-group">' +
          '<h2>Context</h2>' +
          '<aside class="meta-grid" aria-label="Request context">' + contextMeta + '</aside>' +
        '</section>' +
        (responseMeta
          ? '<section class="meta-group"><h2>Response</h2>' +
            '<aside class="meta-grid" aria-label="Response metadata">' + responseMeta + '</aside></section>'
          : '') +
        '<aside class="notice muted">Metadata only — response bodies are not stored in history.</aside>' +
      '</div>';

    document.getElementById('rerun').addEventListener('click', function () {
      vscode.postMessage({ type: 'rerun' });
    });
    document.getElementById('reveal').addEventListener('click', function () {
      vscode.postMessage({ type: 'reveal' });
    });
    document.getElementById('copySummary').addEventListener('click', function () {
      vscode.postMessage({ type: 'copySummary' });
    });
    document.getElementById('delete').addEventListener('click', function () {
      vscode.postMessage({ type: 'delete' });
    });
  }

  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.type === 'init' && data.model) {
      render(data.model);
      return;
    }
    if (data.type === 'error' && typeof data.message === 'string') {
      root.innerHTML = '<div class="empty-state" role="alert"><strong>Unable to load entry</strong>' +
        escapeHtml(data.message) + '</div>';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
