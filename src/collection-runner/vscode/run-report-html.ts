/**
 * Pure HTML/CSS/JS and helpers for the Collection Run Report webview.
 * No `vscode` import — keeps tests free of the extension host.
 */

import {
  CollectionRunStatus,
  FailurePolicyKind,
  RequestRunOutcomeKind,
  type FailurePolicyKind as FailurePolicyKindType,
  type RequestRunOutcomeKind as OutcomeKind,
  type RunSummary,
} from '../models';
import { listFailurePolicies } from '../failure-policies';

/** Serializable row posted to the Collection Run Report webview. */
export interface CollectionRunReportRow {
  readonly requestId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly method: string;
  readonly url: string;
  readonly outcome: OutcomeKind;
  readonly outcomeLabel: string;
  readonly statusBadgeText: string;
  readonly statusBadgeClass: string;
  readonly durationLabel: string;
  readonly assertionsLabel: string;
  readonly statusCode?: number;
  readonly message?: string;
  readonly canOpen: boolean;
  readonly isFailure: boolean;
}

/** Serializable view model posted to the Collection Run Report webview. */
export interface CollectionRunReportModel {
  readonly runId: string;
  readonly collectionName: string;
  readonly status: (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus];
  readonly statusLabel: string;
  readonly failurePolicyLabel: string;
  readonly summaryLine: string;
  readonly durationLabel: string;
  readonly averageDurationLabel: string;
  readonly assertionsLabel: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
  readonly total: number;
  readonly rows: readonly CollectionRunReportRow[];
}

export type CollectionRunReportInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'open'; readonly requestId: string }
  | { readonly type: 'reveal'; readonly requestId: string };

export type CollectionRunReportOutboundMessage =
  | { readonly type: 'init'; readonly model: CollectionRunReportModel }
  | { readonly type: 'error'; readonly message: string };

/** Setting values for `apiRunner.collectionRunner.failurePolicy`. */
export const FailurePolicySettingValue = {
  Ask: 'ask',
  StopOnFirstError: FailurePolicyKind.StopOnFirstError,
  ContinueOnError: FailurePolicyKind.ContinueOnError,
  SkipInvalidRequests: FailurePolicyKind.SkipInvalidRequests,
} as const;

export type FailurePolicySettingValue =
  (typeof FailurePolicySettingValue)[keyof typeof FailurePolicySettingValue];

const INBOUND_TYPES = new Set(['ready', 'open', 'reveal']);

const POLICY_LABELS: Readonly<Record<FailurePolicyKindType, string>> =
  Object.freeze(
    Object.fromEntries(
      listFailurePolicies().map((policy) => [policy.kind, policy.label]),
    ) as Record<FailurePolicyKindType, string>,
  );

/** Builds the report model from a finished run summary. */
export function buildCollectionRunReportModel(
  summary: RunSummary,
): CollectionRunReportModel {
  const plannedByOrdinal = new Map(
    summary.plan.requests.map((request) => [request.ordinal, request]),
  );
  const stats = summary.statistics;
  const rows: CollectionRunReportRow[] = summary.results.map((result) => {
    const planned =
      plannedByOrdinal.get(result.ordinal) ??
      summary.plan.requests.find(
        (request) => request.requestId === result.requestId,
      );
    const statusBadge = resolveOutcomeBadge(result.outcome, result.statusCode);
    const assertionsLabel = formatAssertions(
      result.assertionsPassed,
      result.assertionsFailed,
      result.assertionsTotal,
    );
    return {
      requestId: result.requestId,
      ordinal: result.ordinal,
      label: result.label,
      method: planned?.method ?? '—',
      url: planned?.url ?? '',
      outcome: result.outcome,
      outcomeLabel: outcomeLabel(result.outcome),
      statusBadgeText: statusBadge.text,
      statusBadgeClass: statusBadge.className,
      durationLabel: formatDuration(result.durationMs),
      assertionsLabel,
      ...(result.statusCode === undefined
        ? {}
        : { statusCode: result.statusCode }),
      ...(result.message === undefined ? {} : { message: result.message }),
      canOpen: result.requestId.trim().length > 0,
      isFailure: result.outcome === RequestRunOutcomeKind.Failed,
    };
  });

  const assertionsLabel = formatAssertions(
    stats.assertionsPassed,
    stats.assertionsFailed,
    stats.assertionsTotal,
  );

  return {
    runId: summary.runId,
    collectionName: summary.plan.collectionName,
    status: summary.status,
    statusLabel: statusLabel(summary.status),
    failurePolicyLabel:
      POLICY_LABELS[summary.plan.failurePolicy] ?? summary.plan.failurePolicy,
    summaryLine: formatSummaryLine(summary),
    durationLabel: formatDuration(stats.durationMs),
    averageDurationLabel: formatDuration(stats.averageResponseTimeMs),
    assertionsLabel,
    passed: stats.passed,
    failed: stats.failed,
    skipped: stats.skipped,
    cancelled: stats.cancelled,
    total: stats.total,
    rows,
  };
}

/**
 * Normalizes a configuration value for the failure-policy setting.
 * Unknown / missing values default to {@link FailurePolicySettingValue.Ask}.
 */
export function normalizeFailurePolicySetting(
  value: unknown,
): FailurePolicySettingValue {
  if (value === FailurePolicySettingValue.Ask) {
    return FailurePolicySettingValue.Ask;
  }
  if (
    value === FailurePolicyKind.StopOnFirstError ||
    value === FailurePolicyKind.ContinueOnError ||
    value === FailurePolicyKind.SkipInvalidRequests
  ) {
    return value;
  }
  return FailurePolicySettingValue.Ask;
}

/**
 * Resolves the failure policy for a run from the setting value.
 * Returns `undefined` when the caller should cancel (user dismissed QuickPick).
 * When the setting is `ask`, `prompt` is invoked.
 */
export async function resolveFailurePolicyForRun(
  setting: FailurePolicySettingValue,
  prompt: () => Promise<FailurePolicyKindType | undefined>,
): Promise<FailurePolicyKindType | undefined> {
  if (setting === FailurePolicySettingValue.Ask) {
    return prompt();
  }
  return setting;
}

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseCollectionRunReportMessage(
  value: unknown,
): CollectionRunReportInboundMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || !INBOUND_TYPES.has(record.type)) {
    return undefined;
  }
  if (record.type === 'ready') {
    if (Object.keys(record).length !== 1) {
      return undefined;
    }
    return { type: 'ready' };
  }
  if (record.type === 'open' || record.type === 'reveal') {
    const keys = Object.keys(record);
    if (
      keys.length !== 2 ||
      typeof record.requestId !== 'string' ||
      record.requestId.trim().length === 0
    ) {
      return undefined;
    }
    return { type: record.type, requestId: record.requestId };
  }
  return undefined;
}

/** Builds a self-contained Collection Run Report document with CSP nonce. */
export function renderCollectionRunReportHtml(nonce: string): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Collection Run Report</title>
<style nonce="${safeNonce}">${REPORT_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted" id="loading">Loading collection run report…</p>
</main>
<script nonce="${safeNonce}">${REPORT_SCRIPT}</script>
</body>
</html>`;
}

export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
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

function formatAssertions(
  passed: number | undefined,
  failed: number | undefined,
  total: number | undefined,
): string {
  if (total === undefined || total <= 0) {
    return '—';
  }
  const pass = passed ?? 0;
  const fail = failed ?? 0;
  if (fail > 0) {
    return `${pass}/${total} (${fail} failed)`;
  }
  return `${pass}/${total}`;
}

function formatSummaryLine(summary: RunSummary): string {
  const { statistics: stats, status } = summary;
  const verb = statusLabel(status).toLowerCase();
  return (
    `${stats.passed} passed, ${stats.failed} failed, ` +
    `${stats.skipped} skipped, ${stats.cancelled} cancelled · ${verb}`
  );
}

function outcomeLabel(outcome: OutcomeKind): string {
  switch (outcome) {
    case RequestRunOutcomeKind.Passed:
      return 'Passed';
    case RequestRunOutcomeKind.Failed:
      return 'Failed';
    case RequestRunOutcomeKind.Skipped:
      return 'Skipped';
    case RequestRunOutcomeKind.Cancelled:
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

function statusLabel(
  status: (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus],
): string {
  switch (status) {
    case CollectionRunStatus.Completed:
      return 'Completed';
    case CollectionRunStatus.Cancelled:
      return 'Cancelled';
    case CollectionRunStatus.Stopped:
      return 'Stopped';
    default:
      return 'Finished';
  }
}

function resolveOutcomeBadge(
  outcome: OutcomeKind,
  statusCode: number | undefined,
): { readonly text: string; readonly className: string } {
  switch (outcome) {
    case RequestRunOutcomeKind.Passed:
      return {
        text: statusCode === undefined ? 'Pass' : String(statusCode),
        className: 'status-success',
      };
    case RequestRunOutcomeKind.Failed:
      return {
        text: statusCode === undefined ? 'Fail' : String(statusCode),
        className: 'status-error',
      };
    case RequestRunOutcomeKind.Skipped:
      return { text: 'Skipped', className: 'status-neutral' };
    case RequestRunOutcomeKind.Cancelled:
      return { text: 'Cancelled', className: 'status-cancelled' };
    default:
      return { text: '—', className: 'status-neutral' };
  }
}

const REPORT_CSS = `
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
.toolbar label {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer; user-select: none;
}
.header {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.header h1 {
  margin: 0 0 6px; font-size: 1.1em; font-weight: 600;
}
.summary { color: var(--vscode-descriptionForeground); margin: 0 0 10px; }
.stats-summary { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.stat-chip {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 3px 8px; border-radius: 2px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}
.stat-chip span {
  color: var(--vscode-descriptionForeground);
  font-size: .8em; text-transform: uppercase; letter-spacing: .02em;
}
.stat-chip strong { font-weight: 600; }
.status-badge {
  display: inline-flex; align-items: center;
  border-radius: 2px; padding: 2px 8px; font-weight: 600; font-size: .85em;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.status-success { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.status-error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
.status-cancelled { background: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); color: var(--vscode-editor-background); }
.status-neutral { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.table-wrap { overflow: auto; padding: 0 0 16px; }
table {
  width: 100%; border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
th, td {
  text-align: left; padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  vertical-align: top;
}
th {
  position: sticky; top: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-descriptionForeground);
  font-weight: 600; font-size: .85em;
  text-transform: uppercase; letter-spacing: .02em;
  z-index: 1;
}
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--vscode-list-hoverBackground); }
tbody tr:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}
tbody tr.hidden { display: none; }
.request-cell { min-width: 12rem; }
.request-cell .label { font-weight: 600; overflow-wrap: anywhere; }
.request-cell .meta {
  color: var(--vscode-descriptionForeground);
  font-size: .9em; overflow-wrap: anywhere; margin-top: 2px;
}
.request-cell .method { color: var(--vscode-textLink-foreground); font-weight: 600; }
.message {
  color: var(--vscode-descriptionForeground);
  font-size: .9em; overflow-wrap: anywhere; margin-top: 4px;
}
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; white-space: nowrap; }
.muted { color: var(--vscode-descriptionForeground); padding: 16px; }
.empty { color: var(--vscode-descriptionForeground); padding: 16px; }
button {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: 1px solid var(--vscode-contrastBorder, transparent);
  border-radius: 2px; padding: 3px 8px; cursor: pointer; font: inherit;
}
button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
input[type="checkbox"] { accent-color: var(--vscode-focusBorder); }
`;

const REPORT_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let model = null;
  let filterFailed = false;

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
    return '<div class="stat-chip"><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(value) + '</strong></div>';
  }

  function visibleRows() {
    if (!model) {
      return [];
    }
    return filterFailed ? model.rows.filter(function (row) { return row.isFailure; }) : model.rows;
  }

  function render() {
    if (!model) {
      return;
    }
    const chips = [
      statChip('Status', model.statusLabel),
      statChip('Passed', String(model.passed)),
      statChip('Failed', String(model.failed)),
      statChip('Skipped', String(model.skipped)),
      statChip('Cancelled', String(model.cancelled)),
      statChip('Duration', model.durationLabel),
      statChip('Avg', model.averageDurationLabel),
      statChip('Assertions', model.assertionsLabel),
      statChip('Policy', model.failurePolicyLabel),
    ].join('');

    const rows = visibleRows();
    const body = rows.length === 0
      ? '<p class="empty" id="empty">' +
        (filterFailed ? 'No failed requests in this run.' : 'No requests in this run.') +
        '</p>'
      : '<div class="table-wrap"><table aria-label="Collection run results">' +
        '<thead><tr>' +
        '<th scope="col">#</th>' +
        '<th scope="col">Status</th>' +
        '<th scope="col">Request</th>' +
        '<th scope="col">Duration</th>' +
        '<th scope="col">Assertions</th>' +
        '<th scope="col">Actions</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (row) {
          const meta = row.method && row.method !== '—'
            ? '<div class="meta"><span class="method">' + escapeHtml(row.method) +
              '</span> ' + escapeHtml(row.url) + '</div>'
            : '';
          const message = row.message
            ? '<div class="message">' + escapeHtml(row.message) + '</div>'
            : '';
          return '<tr data-request-id="' + escapeAttribute(row.requestId) + '" tabindex="0">' +
            '<td>' + escapeHtml(String(row.ordinal + 1)) + '</td>' +
            '<td><span class="status-badge ' + escapeAttribute(row.statusBadgeClass) + '">' +
              escapeHtml(row.statusBadgeText) + '</span></td>' +
            '<td class="request-cell"><div class="label">' + escapeHtml(row.label) + '</div>' +
              meta + message + '</td>' +
            '<td>' + escapeHtml(row.durationLabel) + '</td>' +
            '<td>' + escapeHtml(row.assertionsLabel) + '</td>' +
            '<td class="row-actions">' +
              '<button type="button" class="primary open-btn"' +
                (row.canOpen ? '' : ' disabled') + '>Open</button>' +
              '<button type="button" class="reveal-btn"' +
                (row.canOpen ? '' : ' disabled') + '>Reveal</button>' +
            '</td></tr>';
        }).join('') +
        '</tbody></table></div>';

    root.innerHTML =
      '<div class="toolbar" role="toolbar" aria-label="Report filters">' +
        '<label><input type="checkbox" id="filterFailed"' +
          (filterFailed ? ' checked' : '') + '> Failed only</label>' +
      '</div>' +
      '<header class="header">' +
        '<h1>' + escapeHtml(model.collectionName) + '</h1>' +
        '<p class="summary">' + escapeHtml(model.summaryLine) + '</p>' +
        '<div class="stats-summary" aria-label="Run statistics">' + chips + '</div>' +
      '</header>' +
      body;

    const checkbox = document.getElementById('filterFailed');
    if (checkbox) {
      checkbox.addEventListener('change', function () {
        filterFailed = checkbox.checked;
        render();
      });
    }

    root.querySelectorAll('tbody tr').forEach(function (tr) {
      const requestId = tr.getAttribute('data-request-id');
      if (!requestId) {
        return;
      }
      tr.addEventListener('click', function (event) {
        if (event.target.closest('button')) {
          return;
        }
        vscode.postMessage({ type: 'open', requestId: requestId });
      });
      tr.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          vscode.postMessage({ type: 'open', requestId: requestId });
        }
      });
      const openBtn = tr.querySelector('.open-btn');
      const revealBtn = tr.querySelector('.reveal-btn');
      if (openBtn) {
        openBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          vscode.postMessage({ type: 'open', requestId: requestId });
        });
      }
      if (revealBtn) {
        revealBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          vscode.postMessage({ type: 'reveal', requestId: requestId });
        });
      }
    });
  }

  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.type === 'init' && data.model) {
      model = data.model;
      filterFailed = false;
      render();
      return;
    }
    if (data.type === 'error' && typeof data.message === 'string') {
      root.innerHTML = '<p class="muted" role="alert">' + escapeHtml(data.message) + '</p>';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
