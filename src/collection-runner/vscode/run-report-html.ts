/**
 * Pure HTML/CSS/JS and helpers for the Collection Run Report webview.
 * No `vscode` import — keeps tests free of the extension host.
 */

import {
  CollectionRunStatus,
  FailurePolicyKind,
  RequestRunOutcomeKind,
  type DependencyEdge,
  type FailurePolicyKind as FailurePolicyKindType,
  type RequestRunOutcomeKind as OutcomeKind,
  type RunSummary,
} from '../models';
import { listFailurePolicies } from '../failure-policies';
import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
  isWebviewMessageRecord,
  methodBadgeClass,
  WEBVIEW_SHARED_CSS,
} from '../../ui/webview';

export { escapeAttribute, escapeHtml };

/** Serializable row posted to the Collection Run Report webview. */
export interface CollectionRunReportRow {
  readonly requestId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly method: string;
  readonly methodBadgeClass: string;
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
  /** `+accessToken, +userId` — extracted variable names only, never values (§10.1). */
  readonly producedVariablesLabel?: string;
  readonly consumedVariablesLabel?: string;
  /** Secret-free reason a dependent request was skipped (§10.1, §6.7). */
  readonly skipReason?: string;
}

/** One `producer → consumer` dependency edge rendered as text (§10.1). */
export interface CollectionRunReportEdge {
  readonly label: string;
}

/** One unresolved-consume entry rendered as `variable — request` text (§10.1). */
export interface CollectionRunReportUnresolvedConsume {
  readonly variable: string;
  readonly requestLabel: string;
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
  /** True when the dependency-aware execution order differs from plan membership order (§6.6, §10.1). */
  readonly reordered: boolean;
  /** Text-only dependency edges, e.g. `Login → Products (accessToken)` (§10.1). No graph rendering. */
  readonly dependencyEdges: readonly CollectionRunReportEdge[];
  /** Variables consumed with no in-plan producer at enrich time (§6.7, §10.1). */
  readonly unresolvedConsumes: readonly CollectionRunReportUnresolvedConsume[];
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
  const labelByRequestId = new Map(
    summary.plan.requests.map((request) => [request.requestId, request.label]),
  );
  const dependencies = summary.plan.extensions?.dependencies;
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
      methodBadgeClass: methodBadgeClass(planned?.method ?? ''),
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
      ...((): Partial<CollectionRunReportRow> => {
        const producedVariablesLabel = formatProducedVariablesLabel(
          result.producedVariables,
        );
        const consumedVariablesLabel = formatConsumedVariablesLabel(
          result.consumedVariables,
        );
        return {
          ...(producedVariablesLabel === undefined
            ? {}
            : { producedVariablesLabel }),
          ...(consumedVariablesLabel === undefined
            ? {}
            : { consumedVariablesLabel }),
        };
      })(),
      ...(result.skipReason === undefined
        ? {}
        : { skipReason: result.skipReason }),
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
    reordered: dependencies?.reordered ?? false,
    dependencyEdges: (dependencies?.edges ?? []).map((edge) => ({
      label: formatDependencyEdgeLabel(edge, labelByRequestId),
    })),
    unresolvedConsumes: (dependencies?.unresolvedConsumes ?? []).map(
      (entry) => ({
        variable: entry.variable,
        requestLabel: labelByRequestId.get(entry.requestId) ?? entry.requestId,
      }),
    ),
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
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
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
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce, { allowDataImages: true })}">
<title>Collection Run Report</title>
<style nonce="${safeNonce}">${REPORT_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted loading" id="loading">Loading run report…</p>
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

/** Formats produced variable names for a row as `+varA, +varB` — names only, never values (§10.1, §13). */
function formatProducedVariablesLabel(
  producedVariables: readonly string[] | undefined,
): string | undefined {
  if (producedVariables === undefined || producedVariables.length === 0) {
    return undefined;
  }
  return producedVariables.map((name) => `+${name}`).join(', ');
}

function formatConsumedVariablesLabel(
  consumedVariables: readonly string[] | undefined,
): string | undefined {
  if (consumedVariables === undefined || consumedVariables.length === 0) {
    return undefined;
  }
  return consumedVariables.map((name) => `-${name}`).join(', ');
}

/** Formats one dependency edge as text, e.g. `Login → Products (accessToken)` (§10.1). */
function formatDependencyEdgeLabel(
  edge: DependencyEdge,
  labelByRequestId: ReadonlyMap<string, string>,
): string {
  const from = labelByRequestId.get(edge.fromRequestId) ?? edge.fromRequestId;
  const to = labelByRequestId.get(edge.toRequestId) ?? edge.toRequestId;
  return edge.variable === undefined
    ? `${from} → ${to}`
    : `${from} → ${to} (${edge.variable})`;
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
main { display: flex; flex-direction: column; min-height: 100vh; }
.loading { padding: var(--ah-space-4); }
.toolbar {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
  padding: var(--ah-space-2) var(--ah-space-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.toolbar label {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer; user-select: none; font-size: .92em;
}
.header {
  padding: var(--ah-space-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.header h1 {
  margin: 0 0 var(--ah-space-1); font-size: 1.05em; font-weight: 600;
}
.meta-line {
  margin: 0 0 var(--ah-space-3);
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
}
.stats-summary {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
}
.stats-summary .stat-chip.primary-metric strong { font-size: 1.05em; }
.section-label {
  margin: var(--ah-space-3) var(--ah-space-4) var(--ah-space-2);
  color: var(--vscode-descriptionForeground);
  font-size: .75em; font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
}
.header .section-label { margin: var(--ah-space-3) 0 var(--ah-space-2); }
.header .status-badge { text-transform: none; letter-spacing: normal; }
.table-wrap { overflow: auto; padding: 0 0 var(--ah-space-4); }
table {
  width: 100%; border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
th, td {
  text-align: left; padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  vertical-align: top;
}
th {
  position: sticky; top: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-descriptionForeground);
  font-weight: 600; font-size: .75em;
  text-transform: uppercase; letter-spacing: .03em;
  z-index: 1;
}
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--vscode-list-hoverBackground); }
tbody tr:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}
td.assertions-fail { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground)); font-weight: 600; }
.request-cell { min-width: 12rem; }
.request-cell .label { font-weight: 600; overflow-wrap: anywhere; }
.request-cell .meta {
  color: var(--vscode-descriptionForeground);
  font-size: .88em; overflow-wrap: anywhere; margin-top: 2px;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.message {
  color: var(--vscode-descriptionForeground);
  font-size: .88em; overflow-wrap: anywhere; margin-top: var(--ah-space-1);
}
.message.skip-reason { color: var(--vscode-editorWarning-foreground); }
.vars-produced {
  color: var(--vscode-charts-green, var(--vscode-terminal-ansiGreen, #89d185));
  font-size: .85em; overflow-wrap: anywhere; margin-top: 2px;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.vars-consumed {
  color: var(--vscode-descriptionForeground);
  font-size: .85em; overflow-wrap: anywhere; margin-top: 2px;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.row-actions { display: flex; gap: var(--ah-space-1); flex-wrap: wrap; white-space: nowrap; }
.row-actions button { padding: 2px 8px; font-size: .9em; }
input[type="checkbox"] { accent-color: var(--vscode-focusBorder); }
.dependency-list, .unresolved-list {
  margin: 0 0 var(--ah-space-2); padding: 0; list-style: none;
  color: var(--vscode-descriptionForeground); font-size: .88em;
}
.dependency-list li, .unresolved-list li {
  padding: 2px 0; overflow-wrap: anywhere;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.unresolved-list li { color: var(--vscode-editorWarning-foreground); }
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

  function statChip(label, value, emphasis) {
    return '<div class="stat-chip' + (emphasis ? ' primary-metric emphasis' : '') +
      '"><span>' + escapeHtml(label) + '</span><strong>' +
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
      statChip('Passed', String(model.passed), model.failed === 0),
      statChip('Failed', String(model.failed), model.failed > 0),
      statChip('Skipped', String(model.skipped), false),
      statChip('Duration', model.durationLabel, false),
      statChip('Average', model.averageDurationLabel, false),
      statChip('Assertions', model.assertionsLabel, false),
    ].join('');

    const rows = visibleRows();
    const orderBadge = model.reordered
      ? ' <span class="status-badge status-neutral">Reordered</span>'
      : '';
    const body = rows.length === 0
      ? '<div class="empty-state" id="empty" role="status">' +
        '<strong>' + (filterFailed ? 'No failures' : 'No requests') + '</strong>' +
        (filterFailed
          ? 'This run has no failed requests. Clear “Failed only” to see the full results.'
          : 'This collection run did not include any requests.') +
        '</div>'
      : '<p class="section-label">Execution order' + orderBadge + '</p>' +
        '<div class="table-wrap"><table aria-label="Collection run execution order">' +
        '<thead><tr>' +
        '<th scope="col">#</th>' +
        '<th scope="col">Status</th>' +
        '<th scope="col">Request</th>' +
        '<th scope="col">Duration</th>' +
        '<th scope="col">Assertions</th>' +
        '<th scope="col"><span class="sr-only">Actions</span></th>' +
        '</tr></thead><tbody>' +
        rows.map(function (row) {
          const meta = row.method && row.method !== '—'
            ? '<div class="meta"><span class="' + escapeAttribute(row.methodBadgeClass) + '">' +
              escapeHtml(row.method) + '</span> ' + escapeHtml(row.url) + '</div>'
            : '';
          const message = row.skipReason
            ? '<div class="message skip-reason">' + escapeHtml(row.skipReason) + '</div>'
            : row.message
              ? '<div class="message">' + escapeHtml(row.message) + '</div>'
              : '';
          const producedVariables = row.producedVariablesLabel
            ? '<div class="vars-produced">' + escapeHtml(row.producedVariablesLabel) + '</div>'
            : '';
          const consumedVariables = row.consumedVariablesLabel
            ? '<div class="vars-consumed">' + escapeHtml(row.consumedVariablesLabel) + '</div>'
            : '';
          return '<tr data-request-id="' + escapeAttribute(row.requestId) + '" tabindex="0"' +
            (row.isFailure ? ' class="row-fail"' : '') + '>' +
            '<td>' + escapeHtml(String(row.ordinal + 1)) + '</td>' +
            '<td><span class="status-badge ' + escapeAttribute(row.statusBadgeClass) + '">' +
              escapeHtml(row.statusBadgeText) + '</span></td>' +
            '<td class="request-cell"><div class="label">' + escapeHtml(row.label) + '</div>' +
              meta + producedVariables + consumedVariables + message + '</td>' +
            '<td>' + escapeHtml(row.durationLabel) + '</td>' +
            '<td class="' + (row.isFailure && row.assertionsLabel && /fail/i.test(row.assertionsLabel) ? 'assertions-fail' : '') + '">' + escapeHtml(row.assertionsLabel) + '</td>' +
            '<td class="row-actions">' +
              '<button type="button" class="primary open-btn"' +
                (row.canOpen ? '' : ' disabled') + ' aria-label="Open request">Open</button>' +
              '<button type="button" class="reveal-btn"' +
                (row.canOpen ? '' : ' disabled') + ' aria-label="Reveal in Collections">Reveal</button>' +
            '</td></tr>';
        }).join('') +
        '</tbody></table></div>';

    const dependenciesSection = model.dependencyEdges.length === 0
      ? ''
      : '<p class="section-label">Dependencies</p>' +
        '<ul class="dependency-list" aria-label="Dependency edges">' +
        model.dependencyEdges.map(function (edge) {
          return '<li>' + escapeHtml(edge.label) + '</li>';
        }).join('') +
        '</ul>';

    const unresolvedSection = model.unresolvedConsumes.length === 0
      ? ''
      : '<p class="section-label">Unresolved</p>' +
        '<ul class="unresolved-list" aria-label="Unresolved variables">' +
        model.unresolvedConsumes.map(function (entry) {
          return '<li>' + escapeHtml(entry.variable) + ' — ' + escapeHtml(entry.requestLabel) + '</li>';
        }).join('') +
        '</ul>';

    root.innerHTML =
      '<div class="toolbar" role="toolbar" aria-label="Report filters">' +
        '<label><input type="checkbox" id="filterFailed"' +
          (filterFailed ? ' checked' : '') + '> Failed only</label>' +
      '</div>' +
      '<header class="header">' +
        '<h1>' + escapeHtml(model.collectionName) + '</h1>' +
        '<p class="meta-line">' + escapeHtml(model.statusLabel) +
          ' · ' + escapeHtml(model.failurePolicyLabel) +
          (model.cancelled > 0 ? ' · ' + model.cancelled + ' cancelled' : '') +
        '</p>' +
        '<div class="stats-summary" aria-label="Run statistics">' + chips + '</div>' +
        dependenciesSection +
        unresolvedSection +
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
      root.innerHTML = '<div class="empty-state" role="alert"><strong>Unable to load report</strong>' +
        escapeHtml(data.message) + '</div>';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
