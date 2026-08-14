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
  type RequestAttemptRecord,
  type RequestRunOutcomeKind as OutcomeKind,
  type RequestRunResult,
  type RunSummary,
} from '../models';
import { listFailurePolicies } from '../failure-policies';
import { formatAttemptLabel } from '../progress-labels';
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
  /**
   * Plan folder id when the request lives under a folder.
   * Presentation-only — projected from {@link PlannedRequest.folderId}.
   * Grouping uses {@link folderRelativePath}; `folderId` is kept for stable
   * plan identity / tests / future consumers.
   */
  readonly folderId?: string;
  /**
   * Plan folder relative path (`''` / omitted for collection root).
   * Presentation-only — projected from {@link PlannedRequest.folderRelativePath}.
   */
  readonly folderRelativePath?: string;
  /** `+accessToken, +userId` — extracted variable names only, never values (§10.1). */
  readonly producedVariablesLabel?: string;
  readonly consumedVariablesLabel?: string;
  /** Secret-free reason a dependent request was skipped (§10.1, §6.7). */
  readonly skipReason?: string;
  /**
   * Per-attempt lines for retried requests (status codes / outcomes).
   * Presentation-only projection of {@link RequestRunResult.attempts}.
   */
  readonly attemptsLabel?: string;
  readonly attemptLines?: readonly string[];
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
 * synthesized stage history and no invented timings. Speculative guidance
 * lives only under {@link possibleCauses}.
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
  /** Speculative guidance — always render under "Possible causes". */
  readonly possibleCauses?: readonly string[];
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
  /** Plan request id — used to associate unresolved vars with a report row. */
  readonly requestId: string;
  readonly requestLabel: string;
}

/** Serializable view model posted to the Collection Run Report webview. */
export interface CollectionRunReportModel {
  readonly runId: string;
  /** Plan collection id — used for Run Again (presentation host wiring only). */
  readonly collectionId: string;
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
   * Environment name is not on {@link RunSummary} / {@link RunPlan}.
   * Optional presentation-only field — omit unless a host wires it without
   * changing execution models. The report UI does not invent it.
   */
  readonly environmentName?: string;
  /**
   * Categorized failure breakdown (additive to {@link failed} / {@link skipped}).
   * Chips render only for non-zero counts.
   */
  readonly preconditionFailures: number;
  readonly transportFailures: number;
  readonly assertionFailures: number;
  readonly extractionFailures: number;
  readonly protocolFailures: number;
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
  | { readonly type: 'reveal'; readonly requestId: string }
  | { readonly type: 'runAgain' }
  | { readonly type: 'export' }
  | { readonly type: 'compareRuns'; readonly requestId: string };

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

const INBOUND_TYPES = new Set([
  'ready',
  'open',
  'reveal',
  'runAgain',
  'export',
  'compareRuns',
]);

const POLICY_LABELS: Readonly<Record<FailurePolicyKindType, string>> =
  Object.freeze(
    Object.fromEntries(
      listFailurePolicies().map((policy) => [policy.kind, policy.label]),
    ) as Record<FailurePolicyKindType, string>,
  );

/** Builds the report model from a finished run summary. */
export function buildCollectionRunReportModel(
  summary: RunSummary,
  options?: { readonly environmentName?: string },
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
  const environmentName = options?.environmentName?.trim();
  const rows: CollectionRunReportRow[] = summary.results.map((result) => {
    const planned =
      plannedByOrdinal.get(result.ordinal) ??
      summary.plan.requests.find(
        (request) => request.requestId === result.requestId,
      );
    const statusBadge = resolveOutcomeBadge(result.outcome);
    const assertionsLabel = formatAssertions(
      result.assertionsPassed,
      result.assertionsFailed,
      result.assertionsTotal,
    );
    const details = buildRequestDetails(
      result,
      planned,
      edges,
      labelByRequestId,
      environmentName,
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
      durationLabel: formatRowDuration(result.outcome, result.durationMs),
      assertionsLabel,
      ...(result.statusCode === undefined
        ? {}
        : { statusCode: result.statusCode }),
      ...(result.message === undefined ? {} : { message: result.message }),
      canOpen: result.requestId.trim().length > 0,
      isFailure: result.outcome === RequestRunOutcomeKind.Failed,
      ...projectFolderFields(planned),
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
      ...projectAttemptFields(result.attempts),
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
    collectionId: summary.plan.collectionId,
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
    protocolFailures: stats.protocolFailures,
    rows,
    reordered: dependencies?.reordered ?? false,
    dependencyEdges: edges.map((edge) => ({
      label: formatDependencyEdgeLabel(edge, labelByRequestId),
    })),
    unresolvedConsumes: (dependencies?.unresolvedConsumes ?? []).map(
      (entry) => ({
        variable: entry.variable,
        requestId: entry.requestId,
        requestLabel: labelByRequestId.get(entry.requestId) ?? entry.requestId,
      }),
    ),
    variableTrace: buildVariableTrace(summary.results, edges, labelByRequestId),
    ...(environmentName !== undefined && environmentName.length > 0
      ? { environmentName }
      : {}),
  };
}

/**
 * Builds a report model from a live (or just-failed) session snapshot.
 * Finished sessions with a summary reuse {@link buildCollectionRunReportModel}.
 */
export function buildLiveCollectionRunReportModel(
  session: CollectionRunSessionSnapshot,
  options?: { readonly environmentName?: string },
): CollectionRunReportModel {
  if (session.summary !== undefined) {
    return {
      ...buildCollectionRunReportModel(session.summary, options),
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
  const environmentName = options?.environmentName?.trim();
  const rows: CollectionRunReportRow[] = plan.requests.map((planned) => {
    const finished = resultsByOrdinal.get(planned.ordinal);
    if (finished !== undefined) {
      return mapResultRow(
        finished,
        planned,
        edges,
        labelByRequestId,
        environmentName,
      );
    }
    if (
      session.status === 'running' &&
      currentOrdinal !== undefined &&
      planned.ordinal === currentOrdinal
    ) {
      return mapPlaceholderRow(
        planned,
        'running',
        session.lastProgress?.attempt,
      );
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
    collectionId: session.collectionId,
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
        requestId: entry.requestId,
        requestLabel: labelByRequestId.get(entry.requestId) ?? entry.requestId,
      }),
    ),
    variableTrace: buildVariableTrace(session.results, edges, labelByRequestId),
    live,
    ...(environmentName !== undefined && environmentName.length > 0
      ? { environmentName }
      : {}),
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
  | 'protocolFailures'
> {
  const count = (category: RequestFailureCategory): number =>
    results.filter((result) => result.failureDiagnostics?.category === category)
      .length;
  return {
    preconditionFailures: count(RequestFailureCategory.Precondition),
    transportFailures: count(RequestFailureCategory.Transport),
    assertionFailures: count(RequestFailureCategory.Assertion),
    extractionFailures: count(RequestFailureCategory.Extraction),
    protocolFailures: count(RequestFailureCategory.Protocol),
  };
}

function mapResultRow(
  result: RequestRunResult,
  planned: PlannedRequest | undefined,
  edges: readonly DependencyEdge[],
  labelByRequestId: ReadonlyMap<string, string>,
  environmentName?: string,
): CollectionRunReportRow {
  const statusBadge = resolveOutcomeBadge(result.outcome);
  const assertionsLabel = formatAssertions(
    result.assertionsPassed,
    result.assertionsFailed,
    result.assertionsTotal,
  );
  const details = buildRequestDetails(
    result,
    planned,
    edges,
    labelByRequestId,
    environmentName,
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
    durationLabel: formatRowDuration(result.outcome, result.durationMs),
    assertionsLabel,
    ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
    ...(result.message === undefined ? {} : { message: result.message }),
    canOpen: result.requestId.trim().length > 0,
    isFailure: result.outcome === RequestRunOutcomeKind.Failed,
    ...projectFolderFields(planned),
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
    ...projectAttemptFields(result.attempts),
    ...(details === undefined ? {} : { details }),
  };
}

function projectAttemptFields(
  attempts: readonly RequestAttemptRecord[] | undefined,
): Partial<CollectionRunReportRow> {
  if (attempts === undefined || attempts.length <= 1) {
    return {};
  }
  const attemptLines = attempts.map(formatAttemptLine);
  return {
    attemptsLabel: `${attempts.length} attempts`,
    attemptLines,
  };
}

function formatAttemptLine(attempt: RequestAttemptRecord): string {
  const status =
    attempt.statusCode === undefined ? attempt.outcome : String(attempt.statusCode);
  const retryable =
    attempt.retryable === true
      ? ' · retryable'
      : attempt.retryable === false
        ? ' · not retryable'
        : '';
  const duration =
    attempt.durationMs === undefined ? '' : ` · ${attempt.durationMs} ms`;
  return `#${attempt.attemptNumber}: ${status}${retryable}${duration}`;
}

function mapPlaceholderRow(
  planned: PlannedRequest,
  phase: 'running' | 'pending',
  attempt?: import('../models').RunProgressAttempt,
): CollectionRunReportRow {
  const attemptMessage =
    phase === 'running' ? formatAttemptLabel(attempt) : undefined;
  return {
    requestId: planned.requestId,
    ordinal: planned.ordinal,
    label: planned.label,
    method: planned.method,
    methodBadgeClass: methodBadgeClass(planned.method),
    url: planned.url,
    outcome: phase,
    outcomeLabel: phase === 'running' ? 'Running' : 'Pending',
    statusBadgeText: phase === 'running' ? '●' : '○',
    statusBadgeClass: phase === 'running' ? 'status-running' : 'status-pending',
    durationLabel: '—',
    assertionsLabel: '—',
    ...(phase === 'running'
      ? {
          message:
            attemptMessage === undefined
              ? 'Executing request...'
              : attemptMessage,
        }
      : {}),
    canOpen: planned.requestId.trim().length > 0,
    isFailure: false,
    ...projectFolderFields(planned),
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
  environmentName?: string,
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
  const failure = buildFailureDetails(result, environmentName);
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
  environmentName?: string,
): CollectionRunReportFailure | undefined {
  const diagnostics = result.failureDiagnostics;
  const presentationExplanation = result.presentation?.explanation;
  if (diagnostics === undefined && presentationExplanation === undefined) {
    return undefined;
  }
  const facts: string[] = [];
  if (
    result.resolvedVariables !== undefined &&
    result.resolvedVariables.length > 0
  ) {
    facts.push('Variables resolved');
  }
  if (diagnostics !== undefined) {
    facts.push(
      diagnostics.httpRequestSent
        ? 'HTTP request sent'
        : 'HTTP request not sent',
    );
  } else {
    facts.push('HTTP request sent');
  }
  const explanation = diagnostics?.explanation ?? presentationExplanation;
  if (explanation !== undefined) {
    for (const fact of explanation.facts) {
      if (!facts.includes(fact)) {
        facts.push(fact);
      }
    }
    if (
      environmentName !== undefined &&
      environmentName.trim().length > 0 &&
      !facts.some((fact) => fact.startsWith('Environment:'))
    ) {
      facts.push(`Environment: ${environmentName.trim()}`);
    }
  }
  const stageLabel =
    diagnostics?.failedAtStage === undefined
      ? undefined
      : describeFailureStage(diagnostics.failedAtStage);
  const possibleCauses = explanation?.possibleCauses;
  if (diagnostics !== undefined) {
    return {
      statusLabel: describeFailureCategory(diagnostics.category),
      reason: diagnostics.reason,
      httpRequestSent: diagnostics.httpRequestSent,
      ...(stageLabel === undefined ? {} : { stageLabel }),
      facts,
      ...(possibleCauses === undefined || possibleCauses.length === 0
        ? {}
        : { possibleCauses }),
    };
  }
  // Passed transport with 4xx/5xx — status guidance only (no failure category).
  return {
    statusLabel: explanation!.title,
    reason: explanation!.title,
    httpRequestSent: true,
    facts,
    ...(possibleCauses === undefined || possibleCauses.length === 0
      ? {}
      : { possibleCauses }),
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
  if (
    record.type === 'ready' ||
    record.type === 'runAgain' ||
    record.type === 'export'
  ) {
    if (Object.keys(record).length !== 1) {
      return undefined;
    }
    return { type: record.type };
  }
  if (record.type === 'open' || record.type === 'reveal' || record.type === 'compareRuns') {
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
<script nonce="${safeNonce}">${buildCollectionRunReportScript()}</script>
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

/**
 * Display label for a folder group from plan `folderRelativePath`.
 * Empty / omitted → `Root` (collection root). Nested paths use the full path
 * (`a/b`) so deep folders stay distinct.
 */
export function formatFolderGroupLabel(
  folderRelativePath: string | undefined,
): string {
  if (folderRelativePath === undefined || folderRelativePath.trim() === '') {
    return 'Root';
  }
  return folderRelativePath;
}

function projectFolderFields(
  planned: PlannedRequest | undefined,
): Pick<CollectionRunReportRow, 'folderId' | 'folderRelativePath'> {
  if (planned === undefined) {
    return {};
  }
  return {
    ...(planned.folderId === undefined ? {} : { folderId: planned.folderId }),
    ...(planned.folderRelativePath === undefined
      ? {}
      : { folderRelativePath: planned.folderRelativePath }),
  };
}

function formatRowDuration(
  outcome: OutcomeKind | 'running' | 'pending',
  durationMs: number | undefined,
): string {
  if (outcome === RequestRunOutcomeKind.Skipped) {
    return 'skipped';
  }
  return formatDuration(durationMs);
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
): { readonly text: string; readonly className: string } {
  switch (outcome) {
    case RequestRunOutcomeKind.Passed:
      return {
        text: '✓',
        className: 'status-success',
      };
    case RequestRunOutcomeKind.Failed:
      return {
        text: '✕',
        className: 'status-error',
      };
    case RequestRunOutcomeKind.Skipped:
      return { text: '⊘', className: 'status-neutral' };
    case RequestRunOutcomeKind.Cancelled:
      return { text: '■', className: 'status-cancelled' };
    case 'running':
      return { text: '●', className: 'status-running' };
    case 'pending':
      return { text: '○', className: 'status-pending' };
    default:
      return { text: '—', className: 'status-neutral' };
  }
}

export const REPORT_CSS = `
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
.header {
  padding: var(--ah-space-3) var(--ah-space-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.header-top {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--ah-space-3); flex-wrap: wrap;
}
.header-titles { min-width: 0; flex: 1 1 12rem; }
.header h1 {
  margin: 0; font-size: 1.05em; font-weight: 600; overflow-wrap: anywhere;
}
.header-kicker {
  margin: 2px 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: .85em;
}
.header-actions {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
}
.outcome-line {
  display: flex; align-items: center; gap: var(--ah-space-3); flex-wrap: wrap;
  margin: var(--ah-space-2) 0 0;
  font-variant-numeric: tabular-nums;
}
.outcome-pill {
  display: inline-flex; align-items: center; gap: 4px;
  font-weight: 600; font-size: .92em;
}
.outcome-pill .outcome-icon { font-size: 1em; line-height: 1; }
.outcome-pill.pass .outcome-icon { color: var(--vscode-testing-iconPassed, #89d185); }
.outcome-pill.fail .outcome-icon { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground)); }
.outcome-pill.skip .outcome-icon { color: var(--vscode-testing-iconSkipped, var(--vscode-descriptionForeground)); }
.meta-line {
  margin: var(--ah-space-1) 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: .85em;
}
.meta-line .sep { opacity: .55; margin: 0 2px; }
.debugger-note {
  margin: var(--ah-space-1) 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: .78em; opacity: .9;
}
.stats-summary {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
  margin-top: var(--ah-space-2);
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
.req-row.row-running {
  box-shadow: inset 3px 0 0 0 color-mix(in srgb, var(--vscode-charts-blue) 55%, transparent);
}
@media (prefers-reduced-motion: no-preference) {
  .req-row.row-running {
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
.failed-section {
  padding: var(--ah-space-2) var(--ah-space-4) var(--ah-space-3);
  border-bottom: 1px solid var(--vscode-panel-border);
}
.failed-list {
  margin: 0; padding: 0; list-style: none;
  display: flex; flex-direction: column; gap: 2px;
}
.failed-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--ah-space-2);
  align-items: baseline;
  padding: 4px 8px;
  border-radius: var(--ah-radius);
  cursor: pointer;
  font-size: .92em;
  font-variant-numeric: tabular-nums;
}
.failed-item:hover { background: var(--vscode-list-hoverBackground); }
.failed-item:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}
.failed-item .name { font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.failed-item .code {
  color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.failed-item .dur { color: var(--vscode-descriptionForeground); }
.filters {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
  padding: var(--ah-space-2) var(--ah-space-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.filter-chips {
  display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap;
}
.filter-chip {
  padding: 2px 8px; font-size: .85em; min-height: 22px;
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--ah-radius);
}
.filter-chip[aria-pressed="true"] {
  background: var(--vscode-button-secondaryBackground);
  border-color: var(--vscode-focusBorder);
  font-weight: 600;
}
.filter-search {
  flex: 1 1 10rem; min-width: 8rem; max-width: 20rem;
  height: var(--ah-control-height);
  padding: 2px 8px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  font: inherit; font-size: .9em;
}
.filter-search:focus {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}
.filter-method {
  height: var(--ah-control-height);
  padding: 2px 6px;
  color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  font: inherit; font-size: .85em;
}
.list-wrap { padding: 0 0 var(--ah-space-4); }
.folder-group { border-bottom: 1px solid var(--vscode-panel-border); }
.folder-group-header {
  display: flex; align-items: center; gap: var(--ah-space-2);
  width: 100%; padding: 6px var(--ah-space-4);
  background: var(--vscode-sideBar-background);
  border: none; border-radius: 0;
  color: var(--vscode-foreground);
  text-align: left; cursor: pointer;
  font: inherit; font-weight: 600; font-size: .9em;
  min-height: 28px;
}
.folder-group-header:hover { background: var(--vscode-list-hoverBackground); }
.folder-group-header .chev {
  color: var(--vscode-descriptionForeground); width: 1em; flex-shrink: 0;
}
.folder-group-header .group-name { flex: 1 1 auto; overflow-wrap: anywhere; }
.folder-group-header .group-counts {
  color: var(--vscode-descriptionForeground);
  font-weight: 500; font-variant-numeric: tabular-nums; font-size: .92em;
  white-space: nowrap;
}
.folder-group-header .group-mark.pass { color: var(--vscode-testing-iconPassed, #89d185); }
.folder-group-header .group-mark.fail { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground)); }
.folder-group-header .group-mark.skip { color: var(--vscode-testing-iconSkipped, var(--vscode-descriptionForeground)); }
.folder-group-body { display: none; }
.folder-group[data-open="true"] .folder-group-body { display: block; }
.folder-group[data-open="true"] .folder-group-header .chev::before { content: '▾'; }
.folder-group:not([data-open="true"]) .folder-group-header .chev::before { content: '▸'; }
.reorder-note {
  margin: 0; padding: 4px var(--ah-space-4) 8px;
  color: var(--vscode-descriptionForeground); font-size: .78em;
}
.req-row {
  display: grid;
  grid-template-columns: 1.25rem 3.25rem minmax(6rem, 1fr) 2.75rem 4.25rem;
  gap: var(--ah-space-2);
  align-items: baseline;
  padding: 5px var(--ah-space-4);
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.req-row:hover { background: var(--vscode-list-hoverBackground); }
.req-row:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}
.req-row.expanded {
  background: color-mix(in srgb, var(--vscode-list-hoverBackground) 55%, transparent);
}
.req-row.row-fail .outcome-icon {
  color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
}
.req-row .outcome-icon {
  font-weight: 700; line-height: 1;
  color: var(--vscode-testing-iconPassed, #89d185);
  text-align: center;
}
.req-row .outcome-icon.skip,
.req-row .outcome-icon.neutral {
  color: var(--vscode-testing-iconSkipped, var(--vscode-descriptionForeground));
}
.req-row .outcome-icon.cancelled {
  color: var(--vscode-testing-iconUnset, var(--vscode-descriptionForeground));
}
.req-row .outcome-icon.running { color: var(--vscode-charts-blue); }
.req-row .outcome-icon.pending { color: var(--vscode-descriptionForeground); opacity: .85; }
.req-row .method {
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  font-size: .85em; font-weight: 600;
}
.req-row .label { font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.req-row .http-status {
  text-align: right;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  color: var(--vscode-descriptionForeground);
}
.req-row .duration {
  text-align: right;
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
}
.detail-slot {
  padding: 0 var(--ah-space-4) var(--ah-space-3);
  background: var(--vscode-sideBar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}
.detail-panel { padding: var(--ah-space-2) 0; }
.detail-overview {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
  margin: 0 0 var(--ah-space-2);
  padding: 6px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--ah-radius);
  background: var(--vscode-editor-background);
  font-size: .9em; font-variant-numeric: tabular-nums;
}
.detail-overview .ov-label { color: var(--vscode-descriptionForeground); }
.detail-actions {
  display: flex; gap: var(--ah-space-1); flex-wrap: wrap;
  margin-top: var(--ah-space-2);
}
.detail-actions button { padding: 2px 8px; font-size: .9em; }
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
.graphql-errors-card {
  padding: 8px; border-radius: 3px;
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  background: var(--vscode-inputValidation-errorBackground, transparent);
}
.graphql-errors-card h3 { margin: 0 0 4px; font-size: 1em; }
.graphql-errors-card ul { margin: 0; padding-left: 1.2em; }
.graphql-errors-card li { margin: 2px 0; overflow-wrap: anywhere; }
.ws-messages { margin: 0; }
.ws-message-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 4px;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  font-size: .92em;
}
.ws-event {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline;
  overflow-wrap: anywhere;
}
.ws-arrow { flex: 0 0 auto; font-weight: 600; }
.ws-event-sent .ws-arrow { color: var(--vscode-charts-blue, var(--vscode-terminal-ansiBlue, #3794ff)); }
.ws-event-received .ws-arrow { color: var(--vscode-charts-green, var(--vscode-terminal-ansiGreen, #89d185)); }
.ws-event-connection { color: var(--vscode-descriptionForeground); }
.ws-event-error { color: var(--vscode-errorForeground, var(--vscode-editorError-foreground)); }
.muted-inline { color: var(--vscode-descriptionForeground); }
.message {
  color: var(--vscode-descriptionForeground);
  font-size: .88em; overflow-wrap: anywhere; margin-top: var(--ah-space-1);
  white-space: pre-line;
}
.message .message-title {
  display: block; font-weight: 600;
  color: var(--vscode-errorForeground);
}
.failure-facts { margin: 8px 0 0; padding: 0 0 0 1.1em; }
.failure-facts li { padding: 1px 0; color: var(--vscode-descriptionForeground); }
.failure-causes-title {
  margin: 10px 0 4px; font-size: 0.9em; font-weight: 600;
  color: var(--vscode-descriptionForeground);
}
.failure-causes { margin: 0; padding: 0 0 0 1.1em; }
.failure-causes li { padding: 1px 0; }
.message.skip-reason { color: var(--vscode-editorWarning-foreground); }
.attempts {
  margin-top: var(--ah-space-1);
  font-size: .88em;
  color: var(--vscode-descriptionForeground);
}
.attempts-label { font-weight: 600; margin-bottom: 2px; }
.attempt-list {
  margin: 2px 0 0;
  padding-left: 1.2em;
}
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
.dependency-list, .unresolved-list {
  margin: 0 0 var(--ah-space-2); padding: 0; list-style: none;
  color: var(--vscode-descriptionForeground); font-size: .88em;
}
.dependency-list li, .unresolved-list li {
  padding: 2px 0; overflow-wrap: anywhere;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.unresolved-list li { color: var(--vscode-editorWarning-foreground); }
.vars-status {
  margin: var(--ah-space-2) 0 0;
  font-size: .88em; font-weight: 600;
}
.vars-status.vars-ok {
  color: var(--vscode-testing-iconPassed, #89d185);
}
.vars-status.vars-warn {
  color: var(--vscode-editorWarning-foreground);
}
.vars-compact { margin: var(--ah-space-2) 0 0; }
.vars-unresolved-names {
  margin: 2px 0 0; padding: 0; list-style: none;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  font-size: .88em;
  color: var(--vscode-editorWarning-foreground);
}
.vars-unresolved-names li { padding: 1px 0; overflow-wrap: anywhere; }
.vars-unresolved-names .vars-more {
  color: var(--vscode-descriptionForeground);
}
.vars-expand { margin: var(--ah-space-1) 0 0; font-size: .88em; }
.vars-expand > summary {
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  list-style: none;
}
.vars-expand > summary::-webkit-details-marker { display: none; }
.vars-expand-body { margin-top: var(--ah-space-2); }
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
.request-vars-list {
  margin: 0; padding: 0; list-style: none;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
}
.request-vars-list li {
  display: grid;
  grid-template-columns: 1.2em minmax(5rem, 9rem) minmax(0, 1fr);
  gap: 4px 8px; padding: 2px 0; overflow-wrap: anywhere;
  align-items: baseline;
}
.request-vars-list .var-mark-ok {
  color: var(--vscode-testing-iconPassed, #89d185);
}
.request-vars-list .var-mark-warn {
  color: var(--vscode-editorWarning-foreground);
}
.request-vars-list .var-name { font-weight: 600; }
.request-vars-list .var-value { color: var(--vscode-descriptionForeground); }
.vars-role-labels { margin: 0 0 6px; }
.toggle-details { padding: 2px 8px; font-size: .9em; }
@media (max-width: 420px) {
  .req-row {
    grid-template-columns: 1.1rem 2.75rem minmax(0, 1fr);
    grid-template-rows: auto auto;
  }
  .req-row .http-status { grid-column: 2; text-align: left; }
  .req-row .duration { grid-column: 3; }
}
`;

/**
 * Builds the Collection Run Report client script.
 * Standalone mode uses a no-op host API and seeds `model` from `#report-model`.
 */
export function buildCollectionRunReportScript(
  options?: { readonly standalone?: boolean },
): string {
  const standalone = options?.standalone === true;
  const vscodeInit = standalone
    ? 'const vscode = { postMessage: function () {} };'
    : 'const vscode = acquireVsCodeApi();';
  return `
(function () {
  const STANDALONE = ${standalone ? 'true' : 'false'};
  ${vscodeInit}
  const root = document.getElementById('root');
  let model = null;
  /** @type {'all'|'passed'|'failed'|'skipped'} */
  let outcomeFilter = 'all';
  let searchText = '';
  let methodFilter = '';
  /** Single-expand: at most one request detail open (performance for large collections). */
  let expandedRequestId = null;
  /** Folder groups collapsed by user; default open. */
  const collapsedGroups = {};
  let searchDebounceTimer = null;

  function cssEscapeAttr(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    // REPORT_SCRIPT is a TS template literal — double every backslash so the
    // webview receives replaceAll('\\', '\\\\').replaceAll('"', '\\"').
    return String(value).replaceAll('\\\\', '\\\\\\\\').replaceAll('"', '\\\\"');
  }

  function requestRowSelector(requestId) {
    return '[data-request-id="' + cssEscapeAttr(requestId) + '"]';
  }

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

  function formatFolderGroupLabel(folderRelativePath) {
    if (folderRelativePath === undefined || folderRelativePath === null ||
        String(folderRelativePath).trim() === '') {
      return 'Root';
    }
    return String(folderRelativePath);
  }

  function outcomeIconClass(outcome) {
    if (outcome === 'passed') return '';
    if (outcome === 'failed') return '';
    if (outcome === 'skipped') return 'skip neutral';
    if (outcome === 'cancelled') return 'cancelled';
    if (outcome === 'running') return 'running';
    if (outcome === 'pending') return 'pending';
    return 'neutral';
  }

  function httpStatusLabel(row) {
    if (row.outcome === 'skipped' || row.outcome === 'cancelled' ||
        row.outcome === 'pending' || row.outcome === 'running') {
      return '—';
    }
    return row.statusCode === undefined || row.statusCode === null
      ? '—'
      : String(row.statusCode);
  }

  function matchesSearch(row, q) {
    if (!q) return true;
    const hay = [
      row.label || '',
      row.method || '',
      row.url || '',
      row.outcomeLabel || '',
    ].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function matchesOutcome(row) {
    if (outcomeFilter === 'all') return true;
    if (outcomeFilter === 'passed') return row.outcome === 'passed';
    if (outcomeFilter === 'failed') return row.isFailure === true;
    if (outcomeFilter === 'skipped') {
      return row.outcome === 'skipped' || row.outcome === 'cancelled';
    }
    return true;
  }

  function visibleRows() {
    if (!model) return [];
    const q = searchText.trim().toLowerCase();
    return model.rows.filter(function (row) {
      if (!matchesOutcome(row)) return false;
      if (methodFilter && row.method !== methodFilter) return false;
      return matchesSearch(row, q);
    });
  }

  function uniqueMethods(rows) {
    const set = {};
    rows.forEach(function (row) {
      if (row.method && row.method !== '—') set[row.method] = true;
    });
    return Object.keys(set).sort();
  }

  function groupRows(rows) {
    const order = [];
    const map = {};
    rows.forEach(function (row) {
      const key = formatFolderGroupLabel(row.folderRelativePath);
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(row);
    });
    return order.map(function (key) {
      return { key: key, rows: map[key] };
    });
  }

  function groupCounts(rows) {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    rows.forEach(function (row) {
      if (row.isFailure) failed += 1;
      else if (row.outcome === 'passed') passed += 1;
      else if (row.outcome === 'skipped' || row.outcome === 'cancelled') skipped += 1;
    });
    return { passed: passed, failed: failed, skipped: skipped, total: rows.length };
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

  function renderGraphqlErrorsSection(presentation) {
    const graphql = presentation.graphql;
    if (!graphql) return '';
    if (graphql.validEnvelope !== false && !graphql.hasErrors) return '';
    const heading = graphql.validEnvelope === false
      ? 'Invalid GraphQL response'
      : 'GraphQL Errors';
    const messages = graphql.errorMessages || [];
    const list = messages.length === 0
      ? ''
      : '<ul>' + messages.map(function (message) {
          return '<li>' + escapeHtml(message) + '</li>';
        }).join('') + '</ul>';
    return '<div class="graphql-errors-card" data-testid="graphql-errors">' +
      '<h3>' + escapeHtml(heading) + '</h3>' + list + '</div>';
  }

  function renderWebsocketSection(presentation) {
    const session = presentation.websocket;
    if (!session || !session.events || session.events.length === 0) {
      return '<p class="muted-inline">No WebSocket session events</p>';
    }
    return '<ul class="ws-message-list">' +
      session.events.map(function (event) {
        const kindClass = event.kind === 'sent'
          ? 'ws-event-sent'
          : event.kind === 'received'
            ? 'ws-event-received'
            : event.kind === 'error'
              ? 'ws-event-error'
              : 'ws-event-connection';
        const arrow = event.direction === 'sent'
          ? '<span class="ws-arrow" aria-hidden="true">→</span>'
          : event.direction === 'received'
            ? '<span class="ws-arrow" aria-hidden="true">←</span>'
            : '';
        const hint = event.direction === 'sent'
          ? ' <span class="muted-inline">(sent)</span>'
          : event.direction === 'received'
            ? ' <span class="muted-inline">(received)</span>'
            : '';
        return '<li class="ws-event ' + kindClass + '">' + arrow +
          '<span class="ws-event-text">' + escapeHtml(event.text || '') +
          '</span>' + hint + '</li>';
      }).join('') +
      '</ul>';
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
    const deps = details.dependencyLabels || [];
    const hasVars = (details.resolvedVariables || []).length > 0;
    if (deps.length === 0) {
      return hasVars
        ? '<p class="muted-inline">Resolved variables are listed under Variables.</p>'
        : '<p class="muted-inline">No execution details</p>';
    }
    return '<p class="muted-inline">Depends on</p>' +
      '<ul class="dep-list">' +
      deps.map(function (d) {
        return '<li>' + escapeHtml(d) + '</li>';
      }).join('') +
      '</ul>';
  }

  /** Unresolved consume entries that apply to this request row. */
  function unresolvedConsumesForRow(row) {
    const unresolved = (model && model.unresolvedConsumes) || [];
    return unresolved.filter(function (entry) {
      return entry.requestId === row.requestId;
    });
  }

  function hasRequestVariableErrors(row) {
    return unresolvedConsumesForRow(row).length > 0;
  }

  /**
   * Per-request Variables section — resolved displayValue (masked) + unresolved.
   * Owns variable lines; Execution Details keeps depends-on only.
   */
  function renderVariablesSection(row, details) {
    const vars = (details && details.resolvedVariables) || [];
    const unresolved = unresolvedConsumesForRow(row);
    const hasRoles = !!(row.producedVariablesLabel || row.consumedVariablesLabel);
    if (vars.length === 0 && unresolved.length === 0 && !hasRoles) {
      return null;
    }
    const resolvedNames = {};
    vars.forEach(function (v) { resolvedNames[v.name] = true; });
    let html = '';
    if (hasRoles) {
      const bits = [];
      if (row.producedVariablesLabel) {
        bits.push('<span class="vars-produced">' +
          escapeHtml(row.producedVariablesLabel) + '</span>');
      }
      if (row.consumedVariablesLabel) {
        bits.push('<span class="vars-consumed">' +
          escapeHtml(row.consumedVariablesLabel) + '</span>');
      }
      html += '<p class="vars-role-labels muted-inline">' + bits.join(' · ') + '</p>';
    }
    if (vars.length === 0 && unresolved.length === 0) {
      return html || '<p class="muted-inline">No variables</p>';
    }
    html += '<ul class="request-vars-list" aria-label="Request variables">';
    vars.forEach(function (v) {
      html += '<li><span class="var-mark-ok" aria-hidden="true">✓</span>' +
        '<span class="var-name">' + escapeHtml(v.name) + '</span>' +
        '<span class="var-value"><code>' + escapeHtml(v.displayValue) +
        '</code></span></li>';
    });
    unresolved.forEach(function (entry) {
      if (resolvedNames[entry.variable]) return;
      html += '<li><span class="var-mark-warn" aria-hidden="true">⚠</span>' +
        '<span class="var-name">' + escapeHtml(entry.variable) + '</span>' +
        '<span class="var-value var-mark-warn">Unresolved</span></li>';
    });
    html += '</ul>';
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
    let html = '';
    if (row.attemptLines && row.attemptLines.length > 0) {
      html += '<div class="attempts"><div class="attempts-label">' +
        escapeHtml(row.attemptsLabel || 'Attempts') +
        '</div><ul class="attempt-list">' +
        row.attemptLines.map(function (line) {
          return '<li>' + escapeHtml(line) + '</li>';
        }).join('') +
        '</ul></div>';
    }
    if (!row.message) {
      return html;
    }
    const breakAt = row.message.indexOf('\\n');
    if (breakAt < 0) {
      return html + '<div class="message">' + escapeHtml(row.message) + '</div>';
    }
    return html + '<div class="message"><span class="message-title">' +
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
    const causes = failure.possibleCauses || [];
    if (causes.length > 0) {
      html += '<h4 class="failure-causes-title">Possible causes</h4>' +
        '<ul class="failure-causes">' +
        causes.map(function (cause) {
          return '<li>' + escapeHtml(cause) + '</li>';
        }).join('') +
        '</ul>';
    }
    return html;
  }

  function renderHttpNotSentSection() {
    return '<p>API Hero did not send this request.</p>';
  }

  function renderRequestInfoSection(info) {
    return '<dl class="exec-grid">' +
      '<dt>Request</dt><dd>' + escapeHtml(info.label) + '</dd>' +
      (info.method ? '<dt>Method</dt><dd>' + escapeHtml(info.method) + '</dd>' : '') +
      (info.url ? '<dt>URL</dt><dd><code>' + escapeHtml(info.url) + '</code></dd>' : '') +
      '</dl>';
  }

  function renderOverview(row) {
    return '<div class="detail-overview" aria-label="Request overview">' +
      '<span class="status-badge ' + escapeAttribute(row.statusBadgeClass) + '">' +
        escapeHtml(row.statusBadgeText) + '</span>' +
      '<span>' + escapeHtml(row.outcomeLabel) + '</span>' +
      '<span class="ov-label">HTTP</span><strong>' + escapeHtml(httpStatusLabel(row)) + '</strong>' +
      '<span class="ov-label">Duration</span><strong>' + escapeHtml(row.durationLabel) + '</strong>' +
      '<span class="ov-label">Assertions</span><strong>' + escapeHtml(row.assertionsLabel) + '</strong>' +
      '</div>';
  }

  function renderOverviewExtras(row) {
    // Produced/consumed role labels live under Variables (not Overview).
    return renderRowMessage(row);
  }

  function renderDetailPanel(row) {
    const details = row.details;
    if (!details) {
      const varsOnly = renderVariablesSection(row, {});
      let varsBlock = '';
      if (varsOnly !== null) {
        varsBlock = '<details' + (hasRequestVariableErrors(row) ? ' open' : '') + '>' +
          '<summary>Variables</summary>' +
          '<div class="detail-body">' + varsOnly + '</div></details>';
      }
      return '<div class="detail-panel">' + renderOverview(row) +
        renderOverviewExtras(row) +
        (varsBlock ||
          '<p class="muted-inline">No debugger details for this request.</p>') +
        renderDetailActions(row) +
        '</div>';
    }
    const presentation = details.presentation;
    const failure = details.failure;
    const openResponse = !!row.isFailure;
    const sections = [];
    sections.push({
      id: 'overview',
      label: 'Overview',
      body: renderOverview(row) + renderOverviewExtras(row),
      open: true,
    });
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
        label: 'Request — Not Sent',
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
      const graphqlErrors = renderGraphqlErrorsSection(presentation);
      if (graphqlErrors) {
        sections.push({
          id: 'graphql-errors',
          label: 'GraphQL Errors',
          body: graphqlErrors,
          open: true,
        });
      }
      if (presentation.websocket) {
        sections.push({
          id: 'websocket',
          label: 'Messages',
          body: renderWebsocketSection(presentation),
          open: true,
        });
      }
      sections.push({
        id: 'response',
        label: 'Response',
        body: renderBodySection(presentation),
        open: openResponse && !presentation.websocket,
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
    const variablesBody = renderVariablesSection(row, details);
    if (variablesBody !== null) {
      sections.push({
        id: 'variables',
        label: 'Variables',
        body: variablesBody,
        open: hasRequestVariableErrors(row),
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
      renderDetailActions(row) +
      '</div>';
  }

  function renderDetailActions(row) {
    if (STANDALONE) {
      return '';
    }
    const canCompare = !!(row.details && row.details.presentation);
    return '<div class="detail-actions">' +
      '<button type="button" class="primary open-btn"' +
        (row.canOpen ? '' : ' disabled') + ' aria-label="Open request">Open</button>' +
      '<button type="button" class="reveal-btn"' +
        (row.canOpen ? '' : ' disabled') + ' aria-label="Reveal in Collections">Reveal</button>' +
      (canCompare
        ? '<button type="button" class="compare-runs-btn" data-compare-runs="' +
          escapeAttribute(row.requestId) +
          '" aria-label="Compare Runs">Compare Runs</button>'
        : '') +
      '</div>';
  }

  function renderFailedSection() {
    if (!model || !model.failed) return '';
    const failedRows = model.rows.filter(function (row) { return row.isFailure; });
    if (failedRows.length === 0) return '';
    return '<section class="failed-section" id="failed-section" aria-label="Failed requests">' +
      '<p class="section-label" style="margin:0 0 6px">Failed Requests</p>' +
      '<ul class="failed-list">' +
      failedRows.map(function (row) {
        return '<li class="failed-item" tabindex="0" data-jump-id="' +
          escapeAttribute(row.requestId) + '">' +
          '<span class="name">' + escapeHtml(row.label) + '</span>' +
          '<span class="code">' + escapeHtml(httpStatusLabel(row)) + '</span>' +
          '<span class="dur">' + escapeHtml(row.durationLabel) + '</span></li>';
      }).join('') +
      '</ul></section>';
  }

  /** Unique unresolved variable names (order preserved). */
  function uniqueUnresolvedVariableNames(unresolved) {
    const seen = {};
    const names = [];
    unresolved.forEach(function (entry) {
      if (seen[entry.variable]) return;
      seen[entry.variable] = true;
      names.push(entry.variable);
    });
    return names;
  }

  function hasVariableActivity() {
    const trace = model.variableTrace || [];
    if (trace.length > 0) return true;
    if ((model.unresolvedConsumes || []).length > 0) return true;
    return (model.rows || []).some(function (row) {
      return !!(row.producedVariablesLabel || row.consumedVariablesLabel);
    });
  }

  function renderFullVariableTraceBody() {
    const variableTrace = model.variableTrace || [];
    const unresolved = model.unresolvedConsumes || [];
    let html = '';
    if (variableTrace.length > 0) {
      html += '<p class="section-label">Variable Trace</p>' +
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
    }
    if (unresolved.length > 0) {
      html += '<p class="section-label">Unresolved</p>' +
        '<ul class="unresolved-list" aria-label="Unresolved variables">' +
        unresolved.map(function (entry) {
          return '<li>' + escapeHtml(entry.variable) + ' — ' +
            escapeHtml(entry.requestLabel) + '</li>';
        }).join('') +
        '</ul>';
    }
    return html || '<p class="muted-inline">No variable details</p>';
  }

  /**
   * Compact header variables status — no full Variable Trace by default.
   * Healthy: "Variables ✓" + collapsed View Variables when trace exists.
   * Unresolved: compact names + View Variables expand.
   */
  function renderVariablesStatus() {
    const unresolved = model.unresolvedConsumes || [];
    const trace = model.variableTrace || [];
    if (unresolved.length === 0) {
      if (!hasVariableActivity()) return '';
      const expand = trace.length > 0
        ? '<details class="vars-expand">' +
          '<summary>View Variables</summary>' +
          '<div class="vars-expand-body">' + renderFullVariableTraceBody() + '</div>' +
          '</details>'
        : '';
      return '<div class="vars-compact vars-ok-wrap" aria-label="Variables resolved">' +
        '<p class="vars-status vars-ok">Variables ✓</p>' +
        expand +
        '</div>';
    }
    const names = uniqueUnresolvedVariableNames(unresolved);
    const maxVisible = 8;
    const visible = names.slice(0, maxVisible);
    const more = names.length - visible.length;
    const nameItems = visible.map(function (name) {
      return '<li>' + escapeHtml(name) + '</li>';
    }).join('') +
      (more > 0
        ? '<li class="vars-more">+' + more + ' more</li>'
        : '');
    return '<div class="vars-compact" aria-label="Unresolved variables diagnostic">' +
      '<p class="vars-status vars-warn">' +
        '<span aria-hidden="true">⚠</span> ' + names.length +
        ' unresolved variables</p>' +
      '<ul class="vars-unresolved-names" aria-label="Unresolved variable names">' +
        nameItems + '</ul>' +
      '<details class="vars-expand">' +
        '<summary>View Variables</summary>' +
        '<div class="vars-expand-body">' + renderFullVariableTraceBody() + '</div>' +
      '</details>' +
      '</div>';
  }

  function renderFilters(methods) {
    const chip = function (id, label) {
      return '<button type="button" class="filter-chip" data-outcome-filter="' + id +
        '" aria-pressed="' + (outcomeFilter === id ? 'true' : 'false') + '">' +
        escapeHtml(label) + '</button>';
    };
    const methodOptions = '<option value="">All methods</option>' +
      methods.map(function (m) {
        return '<option value="' + escapeAttribute(m) + '"' +
          (methodFilter === m ? ' selected' : '') + '>' +
          escapeHtml(m) + '</option>';
      }).join('');
    return '<div class="filters" role="toolbar" aria-label="Report filters" id="report-filters">' +
      '<div class="filter-chips" role="group" aria-label="Outcome filter">' +
        chip('all', 'All') +
        chip('passed', 'Passed') +
        chip('failed', 'Failed') +
        chip('skipped', 'Skipped') +
      '</div>' +
      '<input type="search" class="filter-search" id="filterSearch" placeholder="Search name, method, URL…" value="' +
        escapeAttribute(searchText) + '" aria-label="Search requests" />' +
      (methods.length > 1
        ? '<select class="filter-method" id="filterMethod" aria-label="Filter by method">' +
          methodOptions + '</select>'
        : '') +
      '</div>';
  }

  function renderCompactRow(row) {
    const isExpanded = expandedRequestId === row.requestId;
    const iconClass = outcomeIconClass(row.outcome);
    const rowClass = [
      'req-row',
      row.isFailure ? 'row-fail' : '',
      row.outcome === 'running' ? 'row-running' : '',
      isExpanded ? 'expanded' : '',
    ].filter(Boolean).join(' ');
    const detailHtml = isExpanded
      ? '<div class="detail-slot" data-detail-for="' + escapeAttribute(row.requestId) + '">' +
        renderDetailPanel(row) + '</div>'
      : '';
    const ariaLabel = [
      row.outcomeLabel,
      row.method,
      row.label,
      'HTTP ' + httpStatusLabel(row),
      row.durationLabel,
    ].join(', ');
    return '<div class="' + rowClass + '" data-request-id="' + escapeAttribute(row.requestId) +
      '" tabindex="0" role="button" aria-expanded="' + (isExpanded ? 'true' : 'false') +
      '" aria-label="' + escapeAttribute(ariaLabel) + '">' +
      '<span class="outcome-icon ' + iconClass + '" aria-hidden="true">' +
        escapeHtml(row.statusBadgeText) + '</span>' +
      '<span class="method ' + escapeAttribute(row.methodBadgeClass) + '">' +
        escapeHtml(row.method) + '</span>' +
      '<span class="label">' + escapeHtml(row.label) + '</span>' +
      '<span class="http-status">' + escapeHtml(httpStatusLabel(row)) + '</span>' +
      '<span class="duration">' + escapeHtml(row.durationLabel) + '</span>' +
      '</div>' + detailHtml;
  }

  function renderRequestList(rows) {
    if (rows.length === 0) {
      return '<div class="empty-state" id="empty" role="status">' +
        '<strong>No matching requests</strong>' +
        'Adjust filters or search to see results.' +
        '</div>';
    }
    const groups = groupRows(rows);
    const reorderNote = model.reordered
      ? '<p class="reorder-note">Execution order may differ from folder order due to dependencies.</p>'
      : '';
    return '<div class="list-wrap" id="request-list">' +
      reorderNote +
      groups.map(function (group) {
        const counts = groupCounts(group.rows);
        const mark = counts.failed > 0 ? '✕' : (counts.passed === counts.total ? '✓' : '⊘');
        const markClass = counts.failed > 0 ? 'fail' : (counts.passed === counts.total ? 'pass' : 'skip');
        const isOpen = !collapsedGroups[group.key];
        return '<section class="folder-group" data-group-key="' + escapeAttribute(group.key) +
          '" data-open="' + (isOpen ? 'true' : 'false') + '">' +
          '<button type="button" class="folder-group-header" data-toggle-group="' +
            escapeAttribute(group.key) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
            '<span class="chev" aria-hidden="true"></span>' +
            '<span class="group-name">' + escapeHtml(group.key) + '</span>' +
            '<span class="group-counts">' + counts.passed + '/' + counts.total +
              ' <span class="group-mark ' + markClass + '">' + mark + '</span></span>' +
          '</button>' +
          '<div class="folder-group-body">' +
            group.rows.map(renderCompactRow).join('') +
          '</div></section>';
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
    const chips = [].concat(
      categoryChip('Validation Failures', model.preconditionFailures),
      categoryChip('HTTP/Network Failures', model.transportFailures),
      categoryChip('Assertion Failures', model.assertionFailures),
      categoryChip('Extraction Failures', model.extractionFailures),
      categoryChip('Protocol Failures', model.protocolFailures),
    ).join('');

    const canRunAgain = !STANDALONE && !model.live && !!model.collectionId;
    const canExport = !STANDALONE;
    const envLine = model.environmentName
      ? '<span class="sep">·</span> Environment: ' + escapeHtml(model.environmentName)
      : '';

    const dependenciesSection = model.dependencyEdges.length === 0
      ? ''
      : '<p class="section-label">Dependencies</p>' +
        '<ul class="dependency-list" aria-label="Dependency edges">' +
        model.dependencyEdges.map(function (edge) {
          return '<li>' + escapeHtml(edge.label) + '</li>';
        }).join('') +
        '</ul>';

    const variablesStatusSection = renderVariablesStatus();

    const rows = visibleRows();
    const methods = uniqueMethods(model.rows);

    root.innerHTML =
      '<header class="header">' +
        '<div class="header-top">' +
          '<div class="header-titles">' +
            '<h1>' + escapeHtml(model.collectionName) + '</h1>' +
            '<p class="header-kicker">Collection Run' +
              (model.live ? ' · Live' : '') +
              ' · <span class="status-badge ' +
              (model.failed > 0 ? 'status-error' : model.live ? 'status-running' : 'status-success') +
              '">' + escapeHtml(model.statusLabel) + '</span></p>' +
          '</div>' +
          '<div class="header-actions">' +
            (canRunAgain
              ? '<button type="button" class="primary" id="runAgainBtn">Run Again</button>'
              : '') +
            (canExport
              ? '<button type="button" class="secondary" id="exportBtn">Export</button>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="outcome-line" aria-label="Run outcome counts">' +
          '<span class="outcome-pill pass"><span class="outcome-icon" aria-hidden="true">✓</span>' +
            model.passed + ' passed</span>' +
          '<span class="outcome-pill fail"><span class="outcome-icon" aria-hidden="true">✕</span>' +
            model.failed + ' failed</span>' +
          '<span class="outcome-pill skip"><span class="outcome-icon" aria-hidden="true">⊘</span>' +
            model.skipped + ' skipped</span>' +
        '</div>' +
        '<p class="meta-line">' +
          escapeHtml(String(model.total)) + ' requests' +
          '<span class="sep">·</span>' + escapeHtml(model.durationLabel) +
          '<span class="sep">·</span>' + escapeHtml(model.failurePolicyLabel) +
          (model.cancelled > 0
            ? '<span class="sep">·</span>' + model.cancelled + ' cancelled'
            : '') +
          (model.reordered
            ? '<span class="sep">·</span><span class="status-badge status-neutral">Reordered</span>'
            : '') +
          envLine +
        '</p>' +
        '<p class="debugger-note">Collection Run Debugger / Details inspect the last in-memory run (not History).</p>' +
        (chips ? '<div class="stats-summary" aria-label="Failure categories">' + chips + '</div>' : '') +
        dependenciesSection +
        variablesStatusSection +
      '</header>' +
      renderFailedSection() +
      renderFilters(methods) +
      renderRequestList(rows);

    const runAgainBtn = document.getElementById('runAgainBtn');
    if (runAgainBtn) {
      runAgainBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'runAgain' });
      });
    }
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'export' });
      });
    }

    root.querySelectorAll('[data-outcome-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        outcomeFilter = btn.getAttribute('data-outcome-filter') || 'all';
        render();
      });
    });

    const searchInput = document.getElementById('filterSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        const next = searchInput.value || '';
        if (searchDebounceTimer !== null) {
          clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(function () {
          searchDebounceTimer = null;
          searchText = next;
          render();
          const again = document.getElementById('filterSearch');
          if (again) {
            again.focus();
            const len = again.value.length;
            again.setSelectionRange(len, len);
          }
        }, 120);
      });
    }

    const methodSelect = document.getElementById('filterMethod');
    if (methodSelect) {
      methodSelect.addEventListener('change', function () {
        methodFilter = methodSelect.value || '';
        render();
      });
    }

    root.querySelectorAll('[data-toggle-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const key = btn.getAttribute('data-toggle-group');
        if (!key) return;
        if (collapsedGroups[key]) delete collapsedGroups[key];
        else collapsedGroups[key] = true;
        render();
      });
    });

    function expandRequest(requestId) {
      expandedRequestId = expandedRequestId === requestId ? null : requestId;
      const groupKey = formatFolderGroupLabel(
        (model.rows.find(function (r) { return r.requestId === requestId; }) || {}).folderRelativePath
      );
      delete collapsedGroups[groupKey];
      render();
      const el = root.querySelector(requestRowSelector(requestId));
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    }

    root.querySelectorAll('.failed-item[data-jump-id]').forEach(function (item) {
      const requestId = item.getAttribute('data-jump-id');
      if (!requestId) return;
      const jump = function () {
        outcomeFilter = 'all';
        searchText = '';
        methodFilter = '';
        expandedRequestId = requestId;
        const groupKey = formatFolderGroupLabel(
          (model.rows.find(function (r) { return r.requestId === requestId; }) || {}).folderRelativePath
        );
        delete collapsedGroups[groupKey];
        render();
        const el = root.querySelector(requestRowSelector(requestId));
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' });
        }
      };
      item.addEventListener('click', jump);
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          jump();
        }
      });
    });

    root.querySelectorAll('.req-row[data-request-id]').forEach(function (rowEl) {
      const requestId = rowEl.getAttribute('data-request-id');
      if (!requestId) return;
      rowEl.addEventListener('click', function (event) {
        if (event.target.closest('button')) return;
        expandRequest(requestId);
      });
      rowEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          expandRequest(requestId);
        }
      });
    });

    root.querySelectorAll('.detail-slot').forEach(function (slot) {
      const requestId = slot.getAttribute('data-detail-for');
      if (!requestId) return;
      const openBtn = slot.querySelector('.open-btn');
      const revealBtn = slot.querySelector('.reveal-btn');
      const compareBtn = slot.querySelector('.compare-runs-btn');
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
      if (compareBtn) {
        compareBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          vscode.postMessage({ type: 'compareRuns', requestId: requestId });
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
      outcomeFilter = 'all';
      searchText = '';
      methodFilter = '';
      expandedRequestId = null;
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      Object.keys(collapsedGroups).forEach(function (key) { delete collapsedGroups[key]; });
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

  if (STANDALONE) {
    const seed = document.getElementById('report-model');
    if (seed && seed.textContent) {
      try {
        model = JSON.parse(seed.textContent);
        render();
      } catch (err) {
        root.innerHTML = '<div class="empty-state" role="alert"><strong>Unable to load report</strong>' +
          escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
      }
    }
    return;
  }

  vscode.postMessage({ type: 'ready' });
})();
`;
}

