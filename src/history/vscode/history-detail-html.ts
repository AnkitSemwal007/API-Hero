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

/** Serializable view model posted to the History Detail webview. */
export interface HistoryDetailModel {
  readonly id: string;
  readonly method: string;
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>History Detail</title>
<style nonce="${safeNonce}">${DETAIL_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted" id="loading">Loading history entry…</p>
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
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
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
main { display: flex; flex-direction: column; gap: 0; min-height: 100vh; }
.toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.status-card {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.status-row, .request-line, .stats-summary {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.status-row { margin-bottom: 8px; }
.request-line { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; margin-bottom: 10px; }
.request-line strong { color: var(--vscode-textLink-foreground); font-weight: 600; }
.summary { color: var(--vscode-descriptionForeground); }
.status-badge {
  display: inline-flex; align-items: center;
  border-radius: 2px; padding: 2px 8px; font-weight: 600; font-size: .9em;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.status-success { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.status-redirect { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
.status-error, .status-badge.status-error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
.status-cancelled { background: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); color: var(--vscode-editor-background); }
.status-neutral { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.stats-summary { gap: 6px; }
.stat-chip {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 3px 8px; border-radius: 2px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  max-width: 100%;
}
.stat-chip span { color: var(--vscode-descriptionForeground); font-size: .8em; text-transform: uppercase; letter-spacing: .02em; }
.stat-chip strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 18rem; }
.meta-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px; padding: 12px 16px 16px;
}
.stat {
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: 2px; padding: 8px 10px; min-width: 0;
}
.stat span { display: block; color: var(--vscode-descriptionForeground); font-size: .85em; }
.stat strong { display: block; margin-top: 2px; overflow-wrap: anywhere; }
.error-callout {
  margin: 0 16px 16px; padding: 12px 14px; border-radius: 2px;
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
  background: var(--vscode-inputValidation-errorBackground, transparent);
}
.error-callout h2 {
  margin: 0 0 6px; font-size: 1em;
  color: var(--vscode-editorError-foreground);
}
.error-callout p { margin: 0; overflow-wrap: anywhere; }
.error-callout code {
  font-family: var(--vscode-editor-font-family);
}
.muted { color: var(--vscode-descriptionForeground); padding: 16px; }
.notice {
  padding: 8px 10px; margin: 0 16px 12px;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: 2px; overflow-wrap: anywhere;
}
button {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: 1px solid var(--vscode-contrastBorder, transparent);
  border-radius: 2px; padding: 4px 10px; cursor: pointer; font: inherit;
}
button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.danger {
  color: var(--vscode-button-foreground);
  background: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
}
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
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
      statChip('Outcome', model.outcomeLabel),
      model.contentType ? statChip('Type', model.contentType) : '',
      model.responseSizeLabel ? statChip('Size', model.responseSizeLabel) : '',
    ].join('');

    const meta = [
      model.requestName ? stat('Name', model.requestName) : '',
      model.environmentName ? stat('Environment', model.environmentName) : '',
      model.collectionName ? stat('Collection', model.collectionName) : '',
      model.httpStatusLabel ? stat('HTTP', model.httpStatusLabel) : '',
      stat('Completed', model.timestampLabel),
      model.sourceUri ? stat('Source', model.sourceUri) : '',
    ].join('');

    const error = model.errorCode || model.errorMessage
      ? '<section class="error-callout" role="alert">' +
        '<h2 id="failure-title">Error</h2>' +
        (model.errorCode ? '<p><code>' + escapeHtml(model.errorCode) + '</code></p>' : '') +
        (model.errorMessage ? '<p>' + escapeHtml(model.errorMessage) + '</p>' : '') +
        '</section>'
      : '';

    const notice = '<aside class="notice">Metadata only — response bodies are not stored in history.</aside>';

    root.innerHTML =
      '<div class="toolbar" role="toolbar" aria-label="History actions">' +
        '<button type="button" id="rerun" class="primary"' + (model.canRerun ? '' : ' disabled') + '>Re-run</button>' +
        '<button type="button" id="reveal"' + (model.canReveal ? '' : ' disabled') + '>Reveal original</button>' +
        '<button type="button" id="copySummary">Copy summary</button>' +
        '<button type="button" id="delete" class="danger">Delete</button>' +
      '</div>' +
      '<header class="status-card">' +
        '<div class="status-row">' +
          '<span class="status-badge ' + escapeAttribute(model.statusBadgeClass) + '">' +
            escapeHtml(model.statusBadgeText) +
          '</span>' +
          '<span class="summary">' + escapeHtml(model.outcomeLabel) + '</span>' +
        '</div>' +
        '<div class="request-line"><strong>' + escapeHtml(model.method) + '</strong> <span>' +
          escapeHtml(model.url) + '</span></div>' +
        '<div class="stats-summary" aria-label="Run statistics">' + chips + '</div>' +
      '</header>' +
      notice +
      error +
      '<aside class="meta-grid" aria-label="History metadata">' + meta + '</aside>';

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
      root.innerHTML = '<p class="muted" role="alert">' + escapeHtml(data.message) + '</p>';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
