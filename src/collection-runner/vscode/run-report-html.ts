/**
 * Pure HTML/CSS/JS and helpers for the Collection Run Report webview.
 * No `vscode` import — keeps tests free of the extension host.
 */

import {
  CollectionRunStatus,
  FailurePolicyKind,
  RequestFailureCategory,
  RequestRunOutcomeKind,
  describeFailureCategory,
  type DependencyEdge,
  type FailurePolicyKind as FailurePolicyKindType,
  type PlannedRequest,
  type RequestRunOutcomeKind as OutcomeKind,
  type RequestRunResult,
  type RunSummary,
} from '../models';
import { listFailurePolicies } from '../failure-policies';
import type { CollectionRunSessionSnapshot } from '../run-session-models';
import type { ResponsePresentation } from '../../response/presentation';
import type { ResolvedVariableSnapshot } from '../../variables';
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
  /** Terminal outcomes plus live Running / Pending placeholders. */
  readonly outcome: OutcomeKind | 'running' | 'pending';
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
  /**
   * Expandable debugger payload. Presentation-only — never RuntimeResponse.
   * Absent for skipped / never-executed rows.
   */
  readonly details?: CollectionRunReportRequestDetails;
}

/**
 * Per-request debugger sections for the Collection Run Report.
 * All response formatting is {@link ResponsePresentation} (shared pipeline).
 */
export interface CollectionRunReportRequestDetails {
  readonly presentation?: ResponsePresentation;
  readonly resolvedVariables?: readonly ResolvedVariableSnapshot[];
  /** Text labels for edges involving this request. */
  readonly dependencyLabels?: readonly string[];
  readonly timeline?: CollectionRunReportTimeline;
  /** Projection of `RequestRunResult.failureDiagnostics` when present. */
  readonly failure?: CollectionRunReportFailure;
  /** Plan-derived request identity for rows that never reached the network. */
  readonly requestInfo?: CollectionRunReportRequestInfo;
}

/**
 * Failure facts for the Details panel. Every field is recorded data — no
 * synthesized stage history and no invented timings.
 */
export interface CollectionRunReportFailure {
  /** Category label, e.g. `Validation Failed`. */
  readonly statusLabel: string;
  readonly reason: string;
  /** Human label for the single recorded stage, when one exists. */
  readonly stageLabel?: string;
  readonly httpRequestSent: boolean;
  /** Factual checklist lines derived only from recorded data. */
  readonly facts: readonly string[];
}

/** Plan-derived request identity shown when no presentation exists. */
export interface CollectionRunReportRequestInfo {
  readonly label: string;
  readonly method?: string;
  readonly url?: string;
}

/**
 * Timeline V1 — Start / End / Duration from presentation.statistics.
 * Network Time is omitted until a distinct transport metric exists (do not
 * alias durationMs under a second label).
 */
export interface CollectionRunReportTimeline {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationLabel: string;
}

/** Report-level variable produce/consume trace (secret-free names + labels). */
export interface CollectionRunReportVariableTrace {
  readonly variable: string;
  readonly producedBy: readonly string[];
  readonly consumedBy: readonly string[];
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
  readonly status:
    | (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus]
    | 'running'
    | 'failed';
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
  /**
   * Categorized failure breakdown (additive to {@link failed} / {@link skipped}).
   * Chips render only for non-zero counts.
   */
  readonly preconditionFailures: number;
  readonly transportFailures: number;
  readonly assertionFailures: number;
  readonly extractionFailures: number;
  readonly rows: readonly CollectionRunReportRow[];
  /** True when the dependency-aware execution order differs from plan membership order (§6.6, §10.1). */
  readonly reordered: boolean;
  /** Text-only dependency edges, e.g. `Login → Products (accessToken)` (§10.1). No graph rendering. */
  readonly dependencyEdges: readonly CollectionRunReportEdge[];
  /** Variables consumed with no in-plan producer at enrich time (§6.7, §10.1). */
  readonly unresolvedConsumes: readonly CollectionRunReportUnresolvedConsume[];
  /** Variable Trace V1 — produced by / consumed by from edges + result names. */
  readonly variableTrace: readonly CollectionRunReportVariableTrace[];
  /** True while the run is still in progress (panel remains open for live updates). */
  readonly live?: boolean;
}

export type CollectionRunReportInboundMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'open'; readonly requestId: string }
  | { readonly type: 'reveal'; readonly requestId: string };

/**
 * Host → webview messages.
 * Prefer `live` for progress refreshes; `update` is accepted as a legacy alias.
 */
export type CollectionRunReportOutboundMessage =
  | { readonly type: 'init'; readonly model: CollectionRunReportModel }
  | { readonly type: 'live'; readonly model: CollectionRunReportModel }
  | { readonly type: 'update'; readonly model: CollectionRunReportModel }
  | { readonly type: 'error'; readonly message: string };

/** Setting values for `apiHero.collectionRunner.failurePolicy`. */
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
  const edges = dependencies?.edges ?? [];
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
    const details = buildRequestDetails(result, planned, edges, labelByRequestId);
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
      ...(details === undefined ? {} : { details }),
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
    preconditionFailures: stats.preconditionFailures,
    transportFailures: stats.transportFailures,
    assertionFailures: stats.assertionFailures,
    extractionFailures: stats.extractionFailures,
    rows,
    reordered: dependencies?.reordered ?? false,
    dependencyEdges: edges.map((edge) => ({
      label: formatDependencyEdgeLabel(edge, labelByRequestId),
    })),
    unresolvedConsumes: (dependencies?.unresolvedConsumes ?? []).map(
      (entry) => ({
        variable: entry.variable,
        requestLabel: labelByRequestId.get(entry.requestId) ?? entry.requestId,
      }),
    ),
    variableTrace: buildVariableTrace(summary.results, edges, labelByRequestId),
  };
}

/**
 * Builds a report model from a live (or just-failed) session snapshot.
 * Finished sessions with a summary reuse {@link buildCollectionRunReportModel}.
 */
export function buildLiveCollectionRunReportModel(
  session: CollectionRunSessionSnapshot,
): CollectionRunReportModel {
  if (session.summary !== undefined) {
    return {
      ...buildCollectionRunReportModel(session.summary),
      live: false,
    };
  }

  const { plan } = session;
  const labelByRequestId = new Map(
    plan.requests.map((request) => [request.requestId, request.label]),
  );
  const dependencies = plan.extensions?.dependencies;
  const edges = dependencies?.edges ?? [];
  const resultsByOrdinal = new Map(
    session.results.map((result) => [result.ordinal, result]),
  );
  const currentOrdinal = session.current?.ordinal;
  const rows: CollectionRunReportRow[] = plan.requests.map((planned) => {
    const finished = resultsByOrdinal.get(planned.ordinal);
    if (finished !== undefined) {
      return mapResultRow(finished, planned, edges, labelByRequestId);
    }
    if (
      session.status === 'running' &&
      currentOrdinal !== undefined &&
      planned.ordinal === currentOrdinal
    ) {
      return mapPlaceholderRow(planned, 'running');
    }
    return mapPlaceholderRow(planned, 'pending');
  });

  const passed = session.results.filter(
    (result) => result.outcome === RequestRunOutcomeKind.Passed,
  ).length;
  const failed = session.results.filter(
    (result) => result.outcome === RequestRunOutcomeKind.Failed,
  ).length;
  const skipped = session.results.filter(
    (result) => result.outcome === RequestRunOutcomeKind.Skipped,
  ).length;
  const cancelled = session.results.filter(
    (result) => result.outcome === RequestRunOutcomeKind.Cancelled,
  ).length;
  const failureCategories = countFailureCategories(session.results);

  const live = session.status === 'running';
  const status =
    session.status === 'running'
      ? ('running' as const)
      : session.status === 'failed'
        ? ('failed' as const)
        : session.status === 'cancelled'
          ? CollectionRunStatus.Cancelled
          : session.status === 'stopped'
            ? CollectionRunStatus.Stopped
            : CollectionRunStatus.Completed;

  return {
    runId: session.runId,
    collectionName: session.collectionName,
    status,
    statusLabel: liveStatusLabel(status),
    failurePolicyLabel:
      POLICY_LABELS[session.failurePolicy] ?? session.failurePolicy,
    summaryLine: live
      ? `${session.completed}/${session.total} completed · running`
      : `${passed} passed, ${failed} failed, ${skipped} skipped, ${cancelled} cancelled`,
    durationLabel: formatDuration(session.elapsedMs),
    averageDurationLabel: '—',
    assertionsLabel: '—',
    passed,
    failed,
    skipped,
    cancelled,
    total: plan.requests.length,
    ...failureCategories,
    rows,
    reordered: dependencies?.reordered ?? false,
    dependencyEdges: edges.map((edge) => ({
      label: formatDependencyEdgeLabel(edge, labelByRequestId),
    })),
    unresolvedConsumes: (dependencies?.unresolvedConsumes ?? []).map(
      (entry) => ({
        variable: entry.variable,
        requestLabel: labelByRequestId.get(entry.requestId) ?? entry.requestId,
      }),
    ),
    variableTrace: buildVariableTrace(session.results, edges, labelByRequestId),
    live,
  };
}

/** Categorized failure counts for live sessions (no summary statistics yet). */
function countFailureCategories(
  results: readonly RequestRunResult[],
): Pick<
  CollectionRunReportModel,
  | 'preconditionFailures'
  | 'transportFailures'
  | 'assertionFailures'
  | 'extractionFailures'
> {
  const count = (category: RequestFailureCategory): number =>
    results.filter((result) => result.failureDiagnostics?.category === category)
      .length;
  return {
    preconditionFailures: count(RequestFailureCategory.Precondition),
    transportFailures: count(RequestFailureCategory.Transport),
    assertionFailures: count(RequestFailureCategory.Assertion),
    extractionFailures: count(RequestFailureCategory.Extraction),
  };
}

function mapResultRow(
  result: RequestRunResult,
  planned: PlannedRequest | undefined,
  edges: readonly DependencyEdge[],
  labelByRequestId: ReadonlyMap<string, string>,
): CollectionRunReportRow {
  const statusBadge = resolveOutcomeBadge(result.outcome, result.statusCode);
  const assertionsLabel = formatAssertions(
    result.assertionsPassed,
    result.assertionsFailed,
    result.assertionsTotal,
  );
  const details = buildRequestDetails(result, planned, edges, labelByRequestId);
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
    ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
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
    ...(result.skipReason === undefined ? {} : { skipReason: result.skipReason }),
    ...(details === undefined ? {} : { details }),
  };
}

function mapPlaceholderRow(
  planned: PlannedRequest,
  phase: 'running' | 'pending',
): CollectionRunReportRow {
  return {
    requestId: planned.requestId,
    ordinal: planned.ordinal,
    label: planned.label,
    method: planned.method,
    methodBadgeClass: methodBadgeClass(planned.method),
    url: planned.url,
    outcome: phase,
    outcomeLabel: phase === 'running' ? 'Running' : 'Pending',
    statusBadgeText: phase === 'running' ? 'Running' : 'Pending',
    statusBadgeClass: phase === 'running' ? 'status-running' : 'status-pending',
    durationLabel: '—',
    assertionsLabel: '—',
    ...(phase === 'running' ? { message: 'Executing request...' } : {}),
    canOpen: planned.requestId.trim().length > 0,
    isFailure: false,
  };
}

function liveStatusLabel(
  status: CollectionRunReportModel['status'],
): string {
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  return statusLabel(status);
}

/**
 * Builds presentation-based debugger details for one request row.
 * Never attaches RuntimeResponse — only ResponsePresentation fields.
 */
function buildRequestDetails(
  result: RequestRunResult,
  planned: PlannedRequest | undefined,
  edges: readonly DependencyEdge[],
  labelByRequestId: ReadonlyMap<string, string>,
): CollectionRunReportRequestDetails | undefined {
  const presentation = result.presentation;
  const resolvedVariables = result.resolvedVariables;
  const dependencyLabels = edges
    .filter(
      (edge) =>
        edge.fromRequestId === result.requestId ||
        edge.toRequestId === result.requestId,
    )
    .map((edge) => formatDependencyEdgeLabel(edge, labelByRequestId));
  const hasPresentation = presentation !== undefined;
  const hasResolved =
    resolvedVariables !== undefined && resolvedVariables.length > 0;
  const hasDeps = dependencyLabels.length > 0;
  const failure = buildFailureDetails(result);
  if (!hasPresentation && !hasResolved && !hasDeps && failure === undefined) {
    return undefined;
  }
  const timeline =
    presentation === undefined
      ? undefined
      : {
          startedAt: presentation.statistics.startedAt,
          completedAt: presentation.statistics.completedAt,
          durationLabel: formatDuration(presentation.statistics.durationMs),
        };
  // Rows that never reached the network have no presentation to identify the
  // request, so fall back to the plan entry (method / original URL).
  const requestInfo =
    hasPresentation || planned === undefined
      ? undefined
      : {
          label: planned.label,
          ...(planned.method.length === 0 ? {} : { method: planned.method }),
          ...(planned.url.length === 0 ? {} : { url: planned.url }),
        };
  return {
    ...(presentation === undefined ? {} : { presentation }),
    ...(hasResolved ? { resolvedVariables } : {}),
    ...(hasDeps ? { dependencyLabels } : {}),
    ...(timeline === undefined ? {} : { timeline }),
    ...(failure === undefined ? {} : { failure }),
    ...(requestInfo === undefined ? {} : { requestInfo }),
  };
}

/** Projects recorded failure diagnostics — never derives new conclusions. */
function buildFailureDetails(
  result: RequestRunResult,
): CollectionRunReportFailure | undefined {
  const diagnostics = result.failureDiagnostics;
  if (diagnostics === undefined) {
    return undefined;
  }
  const facts: string[] = [];
  if (
    result.resolvedVariables !== undefined &&
    result.resolvedVariables.length > 0
  ) {
    facts.push('Variables resolved');
  }
  facts.push(
    diagnostics.httpRequestSent ? 'HTTP request sent' : 'HTTP request not sent',
  );
  const stageLabel =
    diagnostics.failedAtStage === undefined
      ? undefined
      : describeFailureStage(diagnostics.failedAtStage);
  return {
    statusLabel: describeFailureCategory(diagnostics.category),
    reason: diagnostics.reason,
    httpRequestSent: diagnostics.httpRequestSent,
    ...(stageLabel === undefined ? {} : { stageLabel }),
    facts,
  };
}

const FAILURE_STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  parse: 'Parsing',
  validate: 'Validation',
  variables: 'Variable resolution',
  authentication: 'Authentication',
  build: 'Request build',
  transport: 'HTTP transport',
  assertions: 'Assertions',
  extraction: 'Extraction',
});

function describeFailureStage(stage: string): string {
  return FAILURE_STAGE_LABELS[stage] ?? stage;
}

/**
 * Report-level Variable Trace from dependency edges + produced/consumed names.
 * Does not change graph construction — projection only.
 */
function buildVariableTrace(
  results: readonly RequestRunResult[],
  edges: readonly DependencyEdge[],
  labelByRequestId: ReadonlyMap<string, string>,
): readonly CollectionRunReportVariableTrace[] {
  const byVariable = new Map<
    string,
    { producedBy: Set<string>; consumedBy: Set<string> }
  >();
  const ensure = (variable: string) => {
    let entry = byVariable.get(variable);
    if (entry === undefined) {
      entry = { producedBy: new Set(), consumedBy: new Set() };
      byVariable.set(variable, entry);
    }
    return entry;
  };

  for (const edge of edges) {
    if (edge.variable === undefined) {
      continue;
    }
    const entry = ensure(edge.variable);
    entry.producedBy.add(
      labelByRequestId.get(edge.fromRequestId) ?? edge.fromRequestId,
    );
    entry.consumedBy.add(
      labelByRequestId.get(edge.toRequestId) ?? edge.toRequestId,
    );
  }

  for (const result of results) {
    for (const name of result.producedVariables ?? []) {
      ensure(name).producedBy.add(result.label);
    }
    for (const name of result.consumedVariables ?? []) {
      ensure(name).consumedBy.add(result.label);
    }
  }

  return [...byVariable.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([variable, entry]) => ({
      variable,
      producedBy: [...entry.producedBy].sort(),
      consumedBy: [...entry.consumedBy].sort(),
    }));
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

/**
 * Pure host→webview message apply helper (mirrors REPORT_SCRIPT).
 * Returns undefined for unknown types or malformed payloads (including `error`).
 */
export function applyCollectionRunReportHostMessage(
  _current: CollectionRunReportModel | undefined,
  message: { type: string; model?: CollectionRunReportModel },
): { model: CollectionRunReportModel | undefined; resetExpanded: boolean } | undefined {
  if (message.type === 'init') {
    if (message.model === undefined) {
      return undefined;
    }
    return { model: message.model, resetExpanded: true };
  }
  if (message.type === 'live' || message.type === 'update') {
    if (message.model === undefined) {
      return undefined;
    }
    return { model: message.model, resetExpanded: false };
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
<title>Run Report</title>
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

function outcomeLabel(outcome: OutcomeKind | 'running' | 'pending'): string {
  switch (outcome) {
    case RequestRunOutcomeKind.Passed:
      return 'Passed';
    case RequestRunOutcomeKind.Failed:
      return 'Failed';
    case RequestRunOutcomeKind.Skipped:
      return 'Skipped';
    case RequestRunOutcomeKind.Cancelled:
      return 'Cancelled';
    case 'running':
      return 'Running';
    case 'pending':
      return 'Pending';
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
  outcome: OutcomeKind | 'running' | 'pending',
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
    case 'running':
      return { text: 'Running', className: 'status-running' };
    case 'pending':
      return { text: 'Pending', className: 'status-pending' };
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
.status-running {
  color: var(--vscode-charts-blue);
  border-color: color-mix(in srgb, var(--vscode-charts-blue) 45%, transparent);
}
tr.row-running td:first-child {
  /* Static cue that remains under prefers-reduced-motion (on td for collapsed tables) */
  box-shadow: inset 3px 0 0 0 color-mix(in srgb, var(--vscode-charts-blue) 55%, transparent);
}
@media (prefers-reduced-motion: no-preference) {
  tr.row-running td {
    background-image: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--vscode-foreground) 6%, transparent) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    background-repeat: no-repeat;
    animation: ah-row-shimmer 1.8s ease-in-out infinite;
  }
  @keyframes ah-row-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
}
.status-pending {
  color: var(--vscode-descriptionForeground);
  opacity: 0.85;
}
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
  /* Failure summaries are two lines (category then reason) — keep the break. */
  white-space: pre-line;
}
.message .message-title {
  display: block; font-weight: 600;
  color: var(--vscode-errorForeground);
}
.failure-facts { margin: 8px 0 0; padding: 0 0 0 1.1em; }
.failure-facts li { padding: 1px 0; color: var(--vscode-descriptionForeground); }
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
.variable-trace {
  margin: 0 0 var(--ah-space-2); padding: 0; list-style: none;
  color: var(--vscode-descriptionForeground); font-size: .88em;
}
.variable-trace li {
  padding: 4px 0; overflow-wrap: anywhere;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.variable-trace .var-name { font-weight: 600; color: var(--vscode-foreground); }
.variable-trace .var-meta { margin-top: 2px; font-size: .92em; }
tr.detail-row { cursor: default; }
tr.detail-row:hover { background: transparent; }
tr.detail-row td {
  padding: 0 var(--ah-space-4) var(--ah-space-3);
  background: var(--vscode-sideBar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}
.detail-panel { padding: var(--ah-space-2) 0; }
.detail-panel details {
  margin: 0 0 var(--ah-space-2);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-editor-background);
}
.detail-panel details > summary {
  cursor: pointer; padding: 6px 10px;
  font-weight: 600; font-size: .9em;
  color: var(--vscode-foreground);
  list-style: none;
}
.detail-panel details > summary::-webkit-details-marker { display: none; }
.detail-panel details > summary::before {
  content: '▸'; display: inline-block; width: 1em;
  color: var(--vscode-descriptionForeground);
}
.detail-panel details[open] > summary::before { content: '▾'; }
.detail-body {
  padding: 0 10px 10px;
  color: var(--vscode-foreground);
  font-size: .88em;
}
.detail-body pre, .detail-body code {
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.detail-body pre {
  margin: 0; padding: 8px;
  background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.12));
  border-radius: 3px; max-height: 24rem; overflow: auto;
}
.detail-table { width: 100%; border-collapse: collapse; }
.detail-table th, .detail-table td {
  text-align: left; padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  position: static; text-transform: none; letter-spacing: normal;
  font-size: inherit; font-weight: 400; background: transparent;
}
.detail-table th { color: var(--vscode-descriptionForeground); font-weight: 600; }
.timeline-grid, .exec-grid {
  display: grid; grid-template-columns: auto 1fr;
  gap: 4px 12px; margin: 0;
}
.timeline-grid dt, .exec-grid dt {
  color: var(--vscode-descriptionForeground); margin: 0;
}
.timeline-grid dd, .exec-grid dd { margin: 0; overflow-wrap: anywhere; }
.assert-list, .extract-list, .resolved-list, .dep-list {
  margin: 0; padding: 0; list-style: none;
}
.assert-item, .extract-item, .resolved-item, .dep-list li {
  padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border);
}
.assert-item:last-child, .extract-item:last-child,
.resolved-item:last-child, .dep-list li:last-child { border-bottom: none; }
.assert-heading {
  display: flex; align-items: baseline; gap: 6px;
  overflow-wrap: anywhere;
}
.assert-marker { flex-shrink: 0; line-height: 1.2; }
.assert-pass .assert-marker { color: var(--vscode-testing-iconPassed, #89d185); }
.assert-fail .assert-marker { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground)); }
.assert-skip .assert-marker { color: var(--vscode-descriptionForeground); }
.assert-status { margin: 4px 0 0; font-size: .9em; }
.assert-detail {
  display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;
  margin: 4px 0 0; color: var(--vscode-descriptionForeground);
}
.assert-detail > div { display: contents; }
.assert-detail dt { margin: 0; font-weight: 600; }
.assert-detail dd { margin: 0; overflow-wrap: anywhere; }
.failure-block {
  padding: 8px; border-radius: 3px;
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  background: var(--vscode-inputValidation-errorBackground, transparent);
}
.failure-block h3 { margin: 0 0 4px; font-size: 1em; }
.muted-inline { color: var(--vscode-descriptionForeground); }
.toggle-details {
  padding: 2px 8px; font-size: .9em;
}
`;

const REPORT_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let model = null;
  let filterFailed = false;
  const expanded = {};

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

  function renderBodySection(presentation) {
    if (presentation.failure) {
      const f = presentation.failure;
      return '<div class="failure-block"><h3>' + escapeHtml(f.title) + '</h3>' +
        '<p>' + escapeHtml(f.message) + '</p>' +
        '<p class="muted-inline"><code>' + escapeHtml(f.code) + '</code>' +
        (f.retryable ? ' · retryable' : '') + '</p></div>';
    }
    if (!presentation.body) {
      return '<p class="muted-inline">No response body</p>';
    }
    const text = presentation.body.prettyAvailable
      ? presentation.body.pretty
      : presentation.body.raw;
    const note = presentation.body.truncated
      ? '<p class="muted-inline">Preview truncated</p>'
      : '';
    return note + '<pre>' + escapeHtml(text) + '</pre>';
  }

  function renderHeadersSection(presentation) {
    const headers = presentation.headers || [];
    if (headers.length === 0) {
      return '<p class="muted-inline">No response headers</p>';
    }
    return '<table class="detail-table"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>' +
      headers.map(function (h) {
        return '<tr><td>' + escapeHtml(h.name) + '</td><td><code>' +
          escapeHtml(h.value) + '</code>' +
          (h.masked ? ' <span class="muted-inline">masked</span>' : '') +
          '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderCookiesSection(presentation) {
    if (!presentation.cookies || !presentation.cookies.available) {
      return '';
    }
    const entries = presentation.cookies.entries || [];
    if (entries.length === 0) {
      return '<p class="muted-inline">No cookies</p>';
    }
    return '<table class="detail-table"><thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th></tr></thead><tbody>' +
      entries.map(function (c) {
        return '<tr><td>' + escapeHtml(c.name) + '</td><td><code>' +
          escapeHtml(c.value) + '</code></td><td>' + escapeHtml(c.domain || '') +
          '</td><td>' + escapeHtml(c.path || '') + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderExtractionSection(presentation) {
    if (!presentation.extraction) {
      return '<p class="muted-inline">No extracted variables</p>';
    }
    const outcomes = presentation.extraction.outcomes || [];
    if (outcomes.length === 0) {
      return '<p class="muted-inline">No extracted variables</p>';
    }
    return '<ul class="extract-list">' +
      outcomes.map(function (o) {
        const value = o.maskedValue !== undefined
          ? ' = <code>' + escapeHtml(o.maskedValue) + '</code>'
          : '';
        const reason = o.reason
          ? ' <span class="muted-inline">(' + escapeHtml(o.reason) + ')</span>'
          : '';
        return '<li class="extract-item"><code>' + escapeHtml(o.variableName) +
          '</code>' + value +
          ' <span class="muted-inline">' + escapeHtml(o.outcome) +
          ' · ' + escapeHtml(o.sourceLabel) + '</span>' + reason + '</li>';
      }).join('') +
      '</ul>';
  }

  /** Bound Expected/Actual in Details so auto-open Assertions cannot dump huge bodies. */
  var ASSERTION_DETAIL_VALUE_MAX_CHARS = 500;

  function truncateAssertionDetailValue(value) {
    if (typeof value !== 'string' || value.length <= ASSERTION_DETAIL_VALUE_MAX_CHARS) {
      return value;
    }
    return value.slice(0, ASSERTION_DETAIL_VALUE_MAX_CHARS - 1) + '…';
  }

  function renderAssertionsSection(presentation) {
    if (!presentation.assertions) {
      return '<p class="muted-inline">No assertions</p>';
    }
    const items = presentation.assertions.assertions || [];
    if (items.length === 0) {
      return '<p class="muted-inline">No assertions</p>';
    }
    return '<ul class="assert-list">' +
      items.map(function (item) {
        const icon = item.outcome === 'passed' ? 'pass'
          : item.outcome === 'skipped' ? 'skip' : 'fail';
        const marker = item.outcome === 'passed' ? '✅'
          : item.outcome === 'skipped' ? '⊘' : '❌';
        let detail = '';
        if (item.failure) {
          let rows = '';
          if (item.failure.expected !== undefined) {
            rows += '<div><dt>Expected</dt><dd><code>' +
              escapeHtml(truncateAssertionDetailValue(item.failure.expected)) +
              '</code></dd></div>';
          }
          if (item.failure.actual !== undefined) {
            rows += '<div><dt>Actual</dt><dd><code>' +
              escapeHtml(truncateAssertionDetailValue(item.failure.actual)) +
              '</code></dd></div>';
          }
          if (item.failure.reason !== undefined) {
            rows += '<div><dt>Reason</dt><dd>' +
              escapeHtml(item.failure.reason) + '</dd></div>';
          }
          if (item.failure.context !== undefined) {
            rows += '<div><dt>Context</dt><dd>' +
              escapeHtml(item.failure.context) + '</dd></div>';
          }
          detail = rows.length > 0
            ? '<dl class="assert-detail">' + rows + '</dl>'
            : '';
        } else if (item.outcome === 'passed') {
          detail = '<p class="assert-status muted-inline">Passed</p>';
        } else if (item.outcome === 'skipped') {
          detail = '<p class="assert-status muted-inline">Skipped</p>';
        }
        return '<li class="assert-item assert-' + icon + '">' +
          '<div class="assert-heading"><span class="assert-marker" aria-hidden="true">' +
          marker + '</span><code>' + escapeHtml(item.text) + '</code></div>' +
          detail + '</li>';
      }).join('') +
      '</ul>';
  }

  function renderExecutionDetails(details) {
    const vars = details.resolvedVariables || [];
    const deps = details.dependencyLabels || [];
    if (vars.length === 0 && deps.length === 0) {
      return '<p class="muted-inline">No execution details</p>';
    }
    let html = '';
    if (vars.length > 0) {
      html += '<ul class="resolved-list">' +
        vars.map(function (v) {
          return '<li class="resolved-item"><code>{{' + escapeHtml(v.name) +
            '}}</code> → <code>' + escapeHtml(v.displayValue) + '</code>' +
            ' <span class="muted-inline">(' + escapeHtml(v.scope) +
            (v.sensitive ? ', sensitive' : '') + ')</span></li>';
        }).join('') +
        '</ul>';
    }
    if (deps.length > 0) {
      html += '<p class="muted-inline" style="margin-top:8px">Depends on</p>' +
        '<ul class="dep-list">' +
        deps.map(function (d) {
          return '<li>' + escapeHtml(d) + '</li>';
        }).join('') +
        '</ul>';
    }
    return html;
  }

  function renderDependenciesSection(details) {
    const deps = details.dependencyLabels || [];
    if (deps.length === 0) {
      return '<p class="muted-inline">No dependencies</p>';
    }
    return '<ul class="dep-list">' +
      deps.map(function (d) {
        return '<li>' + escapeHtml(d) + '</li>';
      }).join('') +
      '</ul>';
  }

  function renderTimelineSection(details) {
    if (!details.timeline) {
      return '<p class="muted-inline">No timeline</p>';
    }
    const t = details.timeline;
    return '<dl class="timeline-grid">' +
      '<dt>Start</dt><dd>' + escapeHtml(t.startedAt) + '</dd>' +
      '<dt>End</dt><dd>' + escapeHtml(t.completedAt) + '</dd>' +
      '<dt>Duration</dt><dd>' + escapeHtml(t.durationLabel) + '</dd>' +
      '</dl>';
  }

  function renderRowMessage(row) {
    if (row.skipReason) {
      return '<div class="message skip-reason">' + escapeHtml(row.skipReason) + '</div>';
    }
    if (!row.message) {
      return '';
    }
    const breakAt = row.message.indexOf('\\n');
    if (breakAt < 0) {
      return '<div class="message">' + escapeHtml(row.message) + '</div>';
    }
    return '<div class="message"><span class="message-title">' +
      escapeHtml(row.message.slice(0, breakAt)) + '</span>' +
      escapeHtml(row.message.slice(breakAt + 1)) + '</div>';
  }

  function renderFailureSection(failure) {
    let html = '<dl class="exec-grid">' +
      '<dt>Execution Status</dt><dd>' + escapeHtml(failure.statusLabel) + '</dd>' +
      '<dt>Failure Reason</dt><dd>' + escapeHtml(failure.reason) + '</dd>' +
      (failure.stageLabel
        ? '<dt>Execution Stage</dt><dd>' + escapeHtml(failure.stageLabel) + '</dd>'
        : '') +
      '</dl>';
    const facts = failure.facts || [];
    if (facts.length > 0) {
      html += '<ul class="failure-facts">' +
        facts.map(function (fact) {
          return '<li>' + escapeHtml(fact) + '</li>';
        }).join('') +
        '</ul>';
    }
    return html;
  }

  function renderHttpNotSentSection() {
    return '<p>API Hero did not send an HTTP request for this row.</p>';
  }

  function renderRequestInfoSection(info) {
    return '<dl class="exec-grid">' +
      '<dt>Request</dt><dd>' + escapeHtml(info.label) + '</dd>' +
      (info.method ? '<dt>Method</dt><dd>' + escapeHtml(info.method) + '</dd>' : '') +
      (info.url ? '<dt>URL</dt><dd><code>' + escapeHtml(info.url) + '</code></dd>' : '') +
      '</dl>';
  }

  function renderDetailPanel(details) {
    if (!details) {
      return '<p class="muted-inline">No debugger details for this request.</p>';
    }
    const presentation = details.presentation;
    const failure = details.failure;
    const sections = [];
    if (failure) {
      sections.push({
        id: 'failure',
        label: failure.statusLabel,
        body: renderFailureSection(failure),
        open: true,
      });
    }
    if (details.requestInfo) {
      sections.push({
        id: 'request-info',
        label: 'Request Information',
        body: renderRequestInfoSection(details.requestInfo),
        open: !presentation,
      });
    }
    if (failure && !failure.httpRequestSent) {
      sections.push({
        id: 'http-not-sent',
        label: 'HTTP Request — Not Sent',
        body: renderHttpNotSentSection(),
        open: false,
      });
    }
    if (details.timeline) {
      sections.push({
        id: 'timeline',
        label: 'Timeline',
        body: renderTimelineSection(details),
        open: false,
      });
    }
    if (presentation) {
      sections.push({
        id: 'response',
        label: 'Response',
        body: renderBodySection(presentation),
        open: true,
      });
      sections.push({
        id: 'headers',
        label: 'Headers' + (presentation.headers ? ' (' + presentation.headers.length + ')' : ''),
        body: renderHeadersSection(presentation),
        open: false,
      });
      if (presentation.cookies && presentation.cookies.available) {
        sections.push({
          id: 'cookies',
          label: 'Cookies',
          body: renderCookiesSection(presentation),
          open: false,
        });
      }
      sections.push({
        id: 'extraction',
        label: 'Extracted Variables',
        body: renderExtractionSection(presentation),
        open: false,
      });
      const assertionSummary = presentation.assertions &&
        presentation.assertions.summary;
      const openAssertions = !!(
        assertionSummary &&
        ((assertionSummary.failed || 0) +
          (assertionSummary.malformed || 0) > 0)
      );
      sections.push({
        id: 'assertions',
        label: 'Assertions',
        body: renderAssertionsSection(presentation),
        open: openAssertions,
      });
    }
    sections.push({
      id: 'execution',
      label: 'Execution Details',
      body: renderExecutionDetails(details),
      open: false,
    });
    sections.push({
      id: 'dependencies',
      label: 'Dependencies',
      body: renderDependenciesSection(details),
      open: false,
    });
    return '<div class="detail-panel">' +
      sections.map(function (s) {
        return '<details' + (s.open ? ' open' : '') + '>' +
          '<summary>' + escapeHtml(s.label) + '</summary>' +
          '<div class="detail-body">' + s.body + '</div></details>';
      }).join('') +
      '</div>';
  }

  function render() {
    if (!model) {
      return;
    }
    const categoryChip = function (label, count) {
      return (count || 0) > 0 ? [statChip(label, String(count), true)] : [];
    };
    const chips = [
      statChip('Passed', String(model.passed), model.failed === 0),
      statChip('Failed', String(model.failed), model.failed > 0),
    ].concat(
      categoryChip('Validation Failures', model.preconditionFailures),
      categoryChip('HTTP/Network Failures', model.transportFailures),
      categoryChip('Assertion Failures', model.assertionFailures),
      categoryChip('Extraction Failures', model.extractionFailures),
      [
        statChip('Skipped', String(model.skipped), false),
        statChip('Duration', model.durationLabel, false),
        statChip('Average', model.averageDurationLabel, false),
        statChip('Assertions', model.assertionsLabel, false),
      ],
    ).join('');

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
          const message = renderRowMessage(row);
          const producedVariables = row.producedVariablesLabel
            ? '<div class="vars-produced">' + escapeHtml(row.producedVariablesLabel) + '</div>'
            : '';
          const consumedVariables = row.consumedVariablesLabel
            ? '<div class="vars-consumed">' + escapeHtml(row.consumedVariablesLabel) + '</div>'
            : '';
          const hasDetails = !!row.details;
          const isExpanded = !!expanded[row.requestId];
          const detailRow = hasDetails && isExpanded
            ? '<tr class="detail-row" data-detail-for="' + escapeAttribute(row.requestId) + '">' +
              '<td colspan="6">' + renderDetailPanel(row.details) + '</td></tr>'
            : '';
          const rowClass = [
            row.isFailure ? 'row-fail' : '',
            row.outcome === 'running' ? 'row-running' : '',
          ].filter(Boolean).join(' ');
          return '<tr data-request-id="' + escapeAttribute(row.requestId) + '" tabindex="0"' +
            (rowClass ? ' class="' + rowClass + '"' : '') + '>' +
            '<td>' + escapeHtml(String(row.ordinal + 1)) + '</td>' +
            '<td><span class="status-badge ' + escapeAttribute(row.statusBadgeClass) + '">' +
              escapeHtml(row.statusBadgeText) + '</span></td>' +
            '<td class="request-cell"><div class="label">' + escapeHtml(row.label) + '</div>' +
              meta + producedVariables + consumedVariables + message + '</td>' +
            '<td>' + escapeHtml(row.durationLabel) + '</td>' +
            '<td class="' + (row.isFailure && row.assertionsLabel && /fail/i.test(row.assertionsLabel) ? 'assertions-fail' : '') + '">' + escapeHtml(row.assertionsLabel) + '</td>' +
            '<td class="row-actions">' +
              (hasDetails
                ? '<button type="button" class="toggle-details"' +
                  ' aria-expanded="' + (isExpanded ? 'true' : 'false') + '"' +
                  ' aria-label="Toggle details">' +
                  (isExpanded ? 'Hide' : 'Details') + '</button>'
                : '') +
              '<button type="button" class="primary open-btn"' +
                (row.canOpen ? '' : ' disabled') + ' aria-label="Open request">Open</button>' +
              '<button type="button" class="reveal-btn"' +
                (row.canOpen ? '' : ' disabled') + ' aria-label="Reveal in Collections">Reveal</button>' +
            '</td></tr>' + detailRow;
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

    const variableTrace = model.variableTrace || [];
    const variableTraceSection = variableTrace.length === 0
      ? ''
      : '<p class="section-label">Variable Trace</p>' +
        '<ul class="variable-trace" aria-label="Variable trace">' +
        variableTrace.map(function (entry) {
          const produced = entry.producedBy.length
            ? 'Produced by: ' + entry.producedBy.join(', ')
            : 'Produced by: —';
          const consumed = entry.consumedBy.length
            ? 'Consumed by: ' + entry.consumedBy.join(', ')
            : 'Consumed by: —';
          return '<li><span class="var-name">' + escapeHtml(entry.variable) +
            '</span><div class="var-meta">' + escapeHtml(produced) +
            '<br>' + escapeHtml(consumed) + '</div></li>';
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
        '<p class="muted-inline">Collection Run Debugger / Details inspect the last in-memory run (not History).</p>' +
        '<div class="stats-summary" aria-label="Run statistics">' + chips + '</div>' +
        dependenciesSection +
        unresolvedSection +
        variableTraceSection +
      '</header>' +
      body;

    const checkbox = document.getElementById('filterFailed');
    if (checkbox) {
      checkbox.addEventListener('change', function () {
        filterFailed = checkbox.checked;
        render();
      });
    }

    root.querySelectorAll('tbody tr[data-request-id]').forEach(function (tr) {
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
      const toggleBtn = tr.querySelector('.toggle-details');
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
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          expanded[requestId] = !expanded[requestId];
          render();
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
      Object.keys(expanded).forEach(function (key) { delete expanded[key]; });
      render();
      return;
    }
    if ((data.type === 'live' || data.type === 'update') && data.model) {
      model = data.model;
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
