import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  CollectionRunMode,
  CollectionRunStatus,
  FailurePolicyKind,
  RequestRunOutcomeKind,
  type RunSummary,
} from '../models';
import {
  applyCollectionRunReportHostMessage,
  buildCollectionRunReportModel,
  buildLiveCollectionRunReportModel,
  escapeAttribute,
  escapeHtml,
  formatDuration,
  formatFolderGroupLabel,
  normalizeFailurePolicySetting,
  parseCollectionRunReportMessage,
  renderCollectionRunReportHtml,
  resolveFailurePolicyForRun,
  FailurePolicySettingValue,
  type CollectionRunReportModel,
} from './run-report-html';

describe('collection-run-report-html', () => {
  test('renderCollectionRunReportHtml embeds CSP nonce and theme tokens', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /style-src 'nonce-reportNonce'/u);
    assert.match(html, /script-src 'nonce-reportNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="root"/u);
    assert.match(html, /Loading run report/u);
    assert.match(html, /<title>Run Report<\/title>/u);
    assert.match(
      html,
      /Collection Run Debugger \/ Details inspect the last in-memory run \(not History\)\./u,
    );
    assert.match(html, /--vscode-editor-background/u);
    assert.match(html, /data-outcome-filter/u);
    assert.match(html, /id="report-filters"/u);
    assert.match(html, /failed-section/u);
    assert.match(html, /folder-group/u);
    assert.doesNotMatch(html, /Failed only/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
  });

  test('escapeAttribute and escapeHtml neutralize breakouts', () => {
    assert.equal(escapeHtml(`a<b>"c"'`), 'a&lt;b&gt;&quot;c&quot;&#39;');
    assert.equal(escapeAttribute(`a"b'\``), 'a&quot;b&#39;&#96;');
  });

  test('parseCollectionRunReportMessage accepts allowlisted actions only', () => {
    assert.deepEqual(parseCollectionRunReportMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseCollectionRunReportMessage({ type: 'runAgain' }), {
      type: 'runAgain',
    });
    assert.deepEqual(parseCollectionRunReportMessage({ type: 'export' }), {
      type: 'export',
    });
    assert.deepEqual(
      parseCollectionRunReportMessage({
        type: 'open',
        requestId: 'req_1',
      }),
      { type: 'open', requestId: 'req_1' },
    );
    assert.deepEqual(
      parseCollectionRunReportMessage({
        type: 'reveal',
        requestId: 'req_2',
      }),
      { type: 'reveal', requestId: 'req_2' },
    );
    assert.equal(parseCollectionRunReportMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseCollectionRunReportMessage({ type: 'open', requestId: '' }),
      undefined,
    );
    assert.equal(
      parseCollectionRunReportMessage({
        type: 'open',
        requestId: 'req_1',
        extra: true,
      }),
      undefined,
    );
    assert.equal(
      parseCollectionRunReportMessage({ type: 'runAgain', extra: true }),
      undefined,
    );
    assert.equal(
      parseCollectionRunReportMessage({ type: 'export', extra: true }),
      undefined,
    );
    assert.equal(parseCollectionRunReportMessage(null), undefined);
  });

  test('buildCollectionRunReportModel maps per-request rows', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    assert.equal(model.collectionName, 'Demo');
    assert.equal(model.collectionId, 'collection:demo');
    assert.equal(model.status, CollectionRunStatus.Completed);
    assert.equal(model.passed, 1);
    assert.equal(model.failed, 1);
    assert.equal(model.rows.length, 2);
    assert.equal(model.rows[0]?.outcome, RequestRunOutcomeKind.Passed);
    assert.equal(model.rows[0]?.method, 'GET');
    assert.equal(model.rows[0]?.methodBadgeClass, 'method-badge method-get');
    assert.equal(model.rows[0]?.durationLabel, '120 ms');
    assert.equal(model.rows[0]?.assertionsLabel, '2/2');
    assert.equal(model.rows[1]?.isFailure, true);
    assert.equal(model.rows[1]?.assertionsLabel, '1/2 (1 failed)');
    assert.match(model.failurePolicyLabel, /Continue/u);
    assert.equal(model.rows[0]?.canOpen, true);
    assert.equal(model.reordered, false);
    assert.deepEqual(model.dependencyEdges, []);
    assert.deepEqual(model.unresolvedConsumes, []);
    assert.deepEqual(model.variableTrace, []);
  });

  test('buildCollectionRunReportModel projects folder fields from the plan', () => {
    const model = buildCollectionRunReportModel(sampleFolderSummary());
    assert.equal(model.rows[0]?.folderId, undefined);
    assert.equal(model.rows[0]?.folderRelativePath, '');
    assert.equal(formatFolderGroupLabel(model.rows[0]?.folderRelativePath), 'Root');
    assert.equal(model.rows[1]?.folderId, 'folder:assistants');
    assert.equal(model.rows[1]?.folderRelativePath, 'Assistants');
    assert.equal(formatFolderGroupLabel(model.rows[1]?.folderRelativePath), 'Assistants');
    assert.equal(model.rows[2]?.folderRelativePath, 'Chat/Threads');
    assert.equal(formatFolderGroupLabel(model.rows[2]?.folderRelativePath), 'Chat/Threads');
  });

  test('formatFolderGroupLabel maps empty paths to Root', () => {
    assert.equal(formatFolderGroupLabel(undefined), 'Root');
    assert.equal(formatFolderGroupLabel(''), 'Root');
    assert.equal(formatFolderGroupLabel('  '), 'Root');
    assert.equal(formatFolderGroupLabel('Assistants'), 'Assistants');
  });

  test('skipped rows use skipped duration label', () => {
    const model = buildCollectionRunReportModel(sampleDependencySummary());
    assert.equal(model.rows[1]?.durationLabel, 'skipped');
    assert.equal(model.rows[1]?.statusCode, undefined);
  });

  test('buildCollectionRunReportModel projects attempt lines for retries', () => {
    const base = sampleSummary();
    const withAttempts: RunSummary = {
      ...base,
      results: [
        {
          ...base.results[1]!,
          attempts: [
            {
              attemptNumber: 1,
              outcome: RequestRunOutcomeKind.Failed,
              statusCode: 503,
              retryable: true,
              durationMs: 10,
            },
            {
              attemptNumber: 2,
              outcome: RequestRunOutcomeKind.Failed,
              statusCode: 503,
              retryable: true,
              durationMs: 12,
            },
            {
              attemptNumber: 3,
              outcome: RequestRunOutcomeKind.Passed,
              statusCode: 200,
              durationMs: 8,
            },
          ],
        },
      ],
    };
    const model = buildCollectionRunReportModel(withAttempts);
    assert.equal(model.rows[0]?.attemptsLabel, '3 attempts');
    assert.deepEqual(model.rows[0]?.attemptLines, [
      '#1: 503 · retryable · 10 ms',
      '#2: 503 · retryable · 12 ms',
      '#3: 200 · 8 ms',
    ]);
    assert.match(
      renderCollectionRunReportHtml('n'),
      /attempt-list/u,
    );
  });

  test('buildCollectionRunReportModel surfaces dependency order, produced vars, and skip reasons', () => {
    const model = buildCollectionRunReportModel(sampleDependencySummary());
    assert.equal(model.reordered, true);
    assert.deepEqual(
      model.dependencyEdges.map((edge) => edge.label),
      ['Login → Products (accessToken)'],
    );
    assert.deepEqual(model.unresolvedConsumes, [
      {
        variable: 'orderId',
        requestId: 'req_invoice',
        requestLabel: 'Invoice',
      },
    ]);
    assert.equal(model.rows[0]?.producedVariablesLabel, undefined);
    assert.equal(model.rows[0]?.outcomeLabel, 'Failed');
    assert.equal(model.rows[1]?.skipReason, 'Missing run variable: accessToken (producer Login failed)');
    assert.equal(model.rows[1]?.producedVariablesLabel, undefined);
    assert.deepEqual(model.variableTrace, [
      {
        variable: 'accessToken',
        producedBy: ['Login'],
        consumedBy: ['Products'],
      },
    ]);
  });

  test('buildCollectionRunReportModel attaches presentation-based debugger details', () => {
    const base = sampleSummary();
    const withDetails: RunSummary = {
      ...base,
      results: [
        {
          ...base.results[0]!,
          producedVariables: ['accessToken'],
          consumedVariables: ['baseUrl'],
          resolvedVariables: [
            {
              name: 'baseUrl',
              scope: 'environment',
              sensitive: false,
              displayValue: 'https://example.test',
            },
          ],
          presentation: {
            success: true,
            requestId: 'req_ok',
            method: 'GET',
            requestUrl: 'https://example.test/users',
            status: { code: 200, text: 'OK' },
            headers: [{ name: 'Content-Type', value: 'application/json', masked: false }],
            cookies: { available: false, setCookieHeaderCount: 0 },
            statistics: {
              durationMs: 120,
              startedAt: '2026-07-27T10:00:00.000Z',
              completedAt: '2026-07-27T10:00:00.120Z',
              headerCount: 1,
              redirected: false,
              redirectCount: 0,
            },
            body: {
              language: 'json',
              raw: '{"ok":true}',
              pretty: '{\n  "ok": true\n}',
              prettyAvailable: true,
              truncated: false,
              displayedUnits: 11,
              totalUnits: 11,
              unit: 'characters',
            },
            extraction: {
              summary: {
                total: 1,
                extracted: 1,
                failed: 0,
                skipped: 0,
                malformed: 0,
              },
              chipLabel: 'Extracted 1',
              outcomes: [
                {
                  variableName: 'accessToken',
                  sourceLabel: '$.token',
                  outcome: 'extracted',
                  maskedValue: 'tok',
                },
              ],
            },
            assertions: {
              summary: {
                total: 1,
                passed: 1,
                failed: 0,
                skipped: 0,
                malformed: 0,
                passPercent: 100,
                durationMs: 1,
              },
              assertions: [
                { text: 'expect status == 200', outcome: 'passed' },
              ],
            },
            summary: '200 OK · 120 ms · 0 B',
          },
        },
        base.results[1]!,
      ],
      plan: {
        ...base.plan,
        extensions: {
          dependencies: {
            nodes: [],
            edges: [
              {
                fromRequestId: 'req_ok',
                toRequestId: 'req_fail',
                kind: 'implicit',
                variable: 'accessToken',
              },
            ],
            reordered: false,
            originalOrder: ['req_ok', 'req_fail'],
            executionOrder: ['req_ok', 'req_fail'],
            cycles: [],
            unresolvedConsumes: [],
          },
        },
      },
    };
    const model = buildCollectionRunReportModel(withDetails);
    const details = model.rows[0]?.details;
    assert.ok(details !== undefined);
    assert.equal(details?.presentation?.status?.code, 200);
    assert.equal(details?.presentation?.body?.pretty, '{\n  "ok": true\n}');
    assert.equal(
      details?.presentation?.extraction?.outcomes[0]?.maskedValue,
      'tok',
    );
    assert.equal(
      details?.presentation?.assertions?.assertions[0]?.outcome,
      'passed',
    );
    assert.deepEqual(details?.resolvedVariables, [
      {
        name: 'baseUrl',
        scope: 'environment',
        sensitive: false,
        displayValue: 'https://example.test',
      },
    ]);
    assert.deepEqual(details?.dependencyLabels, [
      'List users → Create user (accessToken)',
    ]);
    // Presentation already identifies the request — no plan-derived fallback.
    assert.equal(details?.requestInfo, undefined);
    assert.equal(details?.timeline?.startedAt, '2026-07-27T10:00:00.000Z');
    assert.equal(details?.timeline?.durationLabel, '120 ms');
    assert.equal(details?.timeline?.durationLabel, '120 ms');
    assert.equal(
      details?.timeline && 'networkTimeLabel' in details.timeline,
      false,
    );
    assert.deepEqual(model.variableTrace, [
      {
        variable: 'accessToken',
        producedBy: ['List users'],
        consumedBy: ['Create user'],
      },
      {
        variable: 'baseUrl',
        producedBy: [],
        consumedBy: ['List users'],
      },
    ]);
    // Model carries ResponsePresentation only — no RuntimeResponse fields.
    assert.equal(
      (details?.presentation as { response?: unknown } | undefined)?.response,
      undefined,
    );
  });

  test('categorized failure counts flow into the summary model', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    assert.equal(model.assertionFailures, 1);
    assert.equal(model.preconditionFailures, 0);
    assert.equal(model.transportFailures, 0);
    assert.equal(model.extractionFailures, 0);
  });

  test('precondition failures expose Details without a presentation', () => {
    const base = sampleSummary();
    const withPrecondition: RunSummary = {
      ...base,
      results: [
        base.results[0]!,
        {
          requestId: 'req_fail',
          ordinal: 1,
          label: 'Create user',
          outcome: RequestRunOutcomeKind.Failed,
          message: 'Validation Failed\nUndefined variable "productId"',
          failureDiagnostics: {
            category: 'precondition',
            reason: 'Undefined variable "productId"',
            httpRequestSent: false,
            failedAtStage: 'variables',
          },
        },
      ],
      statistics: {
        ...base.statistics,
        assertionFailures: 0,
        preconditionFailures: 1,
      },
    };

    const model = buildCollectionRunReportModel(withPrecondition);
    const row = model.rows[1];
    assert.equal(model.preconditionFailures, 1);
    assert.equal(row?.message, 'Validation Failed\nUndefined variable "productId"');
    const details = row?.details;
    assert.ok(details !== undefined, 'failure rows must expose Details');
    assert.equal(details?.presentation, undefined);
    assert.equal(details?.timeline, undefined);
    assert.deepEqual(details?.failure, {
      statusLabel: 'Validation Failed',
      reason: 'Undefined variable "productId"',
      stageLabel: 'Variable resolution',
      httpRequestSent: false,
      facts: ['HTTP request not sent'],
    });
    assert.deepEqual(details?.requestInfo, {
      label: 'Create user',
      method: 'POST',
      url: 'https://example.test/users',
    });
  });

  test('failure facts report resolved variables and a sent HTTP request', () => {
    const base = sampleSummary();
    const withFacts: RunSummary = {
      ...base,
      results: [
        base.results[0]!,
        {
          ...base.results[1]!,
          resolvedVariables: [
            {
              name: 'baseUrl',
              scope: 'environment',
              sensitive: false,
              displayValue: 'https://example.test',
            },
          ],
        },
      ],
    };

    const details = buildCollectionRunReportModel(withFacts).rows[1]?.details;
    assert.deepEqual(details?.failure, {
      statusLabel: 'Assertion Failed',
      reason: 'Expected status 200 but received 500.',
      stageLabel: 'Assertions',
      httpRequestSent: true,
      facts: ['Variables resolved', 'HTTP request sent'],
    });
  });

  test('projects possibleCauses from failureDiagnostics explanation', () => {
    const base = sampleSummary();
    const withExplanation: RunSummary = {
      ...base,
      results: [
        base.results[0]!,
        {
          ...base.results[1]!,
          failureDiagnostics: {
            category: 'assertion',
            reason: 'Expected status 200 but received 500.',
            httpRequestSent: true,
            failedAtStage: 'assertions',
            explanation: {
              title: '500 Internal Server Error',
              facts: ['Endpoint: https://example.test/users', 'Duration: 80 ms'],
              possibleCauses: [
                'Upstream service error',
                'Temporary server outage',
                'Unhandled exception on the server',
              ],
            },
          },
        },
      ],
    };
    const details = buildCollectionRunReportModel(withExplanation).rows[1]
      ?.details;
    assert.deepEqual(details?.failure?.possibleCauses, [
      'Upstream service error',
      'Temporary server outage',
      'Unhandled exception on the server',
    ]);
    assert.ok(
      details?.failure?.facts.some((f) => f.startsWith('Endpoint:')),
    );
  });

  test('Passed 401 projects status guidance into Details without category failure', () => {
    const base = sampleSummary();
    const with401: RunSummary = {
      ...base,
      results: [
        {
          ...base.results[0]!,
          statusCode: 401,
          presentation: {
            success: true,
            requestId: 'req_ok',
            method: 'GET',
            requestUrl: 'https://example.test/secure',
            status: { code: 401, text: 'Unauthorized' },
            headers: [],
            cookies: { available: false, setCookieHeaderCount: 0 },
            statistics: {
              durationMs: 15,
              startedAt: '2026-07-27T10:00:00.000Z',
              completedAt: '2026-07-27T10:00:00.015Z',
              headerCount: 0,
              redirected: false,
              redirectCount: 0,
            },
            explanation: {
              title: '401 Unauthorized',
              facts: ['Endpoint: https://example.test/secure'],
              possibleCauses: [
                'Authorization header missing',
                'Token unresolved',
                'Token invalid or expired',
              ],
            },
            summary: '401 Unauthorized · 15 ms · 0 B',
          },
        },
        base.results[1]!,
      ],
    };
    const details = buildCollectionRunReportModel(with401).rows[0]?.details;
    assert.equal(details?.failure?.statusLabel, '401 Unauthorized');
    assert.deepEqual(details?.failure?.possibleCauses, [
      'Authorization header missing',
      'Token unresolved',
      'Token invalid or expired',
    ]);
  });

  test('passed rows keep their existing Details shape', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    assert.equal(model.rows[0]?.details, undefined);
    assert.equal(model.rows[0]?.message, undefined);
  });

  test('renderCollectionRunReportHtml renders categorized chips and HTTP-not-sent section', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /Validation Failures/u);
    assert.match(html, /HTTP\/Network Failures/u);
    assert.match(html, /Assertion Failures/u);
    assert.match(html, /Extraction Failures/u);
    assert.match(html, /Execution Status/u);
    assert.match(html, /Failure Reason/u);
    assert.match(html, /Execution Stage/u);
    assert.match(html, /HTTP Request — Not Sent/u);
    assert.match(html, /Request Information/u);
    assert.match(html, /failure-facts/u);
    // Details must not fabricate a timestamped pipeline history.
    assert.doesNotMatch(html, /stage-timeline/u);
  });

  test('producedVariablesLabel formats names only, never values', () => {
    const base = sampleSummary();
    const withProduce: RunSummary = {
      ...base,
      results: [
        {
          ...base.results[0]!,
          producedVariables: ['accessToken', 'userId'],
        },
        ...base.results.slice(1),
      ],
    };
    const model = buildCollectionRunReportModel(withProduce);
    assert.equal(model.rows[0]?.producedVariablesLabel, '+accessToken, +userId');
  });

  test('consumedVariablesLabel formats names with minus prefix', () => {
    const base = sampleSummary();
    const withConsume: RunSummary = {
      ...base,
      results: [
        {
          ...base.results[0]!,
          producedVariables: ['productId'],
          consumedVariables: ['accessToken'],
        },
        ...base.results.slice(1),
      ],
    };
    const model = buildCollectionRunReportModel(withConsume);
    assert.equal(model.rows[0]?.consumedVariablesLabel, '-accessToken');
    assert.equal(model.rows[0]?.producedVariablesLabel, '+productId');
  });

  test('renderCollectionRunReportHtml shell includes dependency report hooks', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /Execution order may differ from folder order/u);
    assert.match(html, /Reordered/u);
    assert.match(html, /Dependencies/);
    assert.match(html, /renderDetailPanel/);
    assert.match(html, /vars-produced/);
    assert.match(html, /vars-consumed/);
    assert.match(html, /skip-reason/);
    assert.match(html, /expandedRequestId/u);
    assert.match(html, /runAgain/u);
    assert.match(html, /id="exportBtn"/u);
    assert.match(html, /type: 'export'/u);
    assert.match(html, /filter-chip/u);
    assert.match(html, /folder-group-header/u);
  });

  test('Variable Trace UX is compact in header with expand hooks', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /function renderVariablesStatus/u);
    assert.match(html, /function renderVariablesSection/u);
    assert.match(html, /function renderFullVariableTraceBody/u);
    assert.match(html, /Variables ✓/u);
    assert.match(html, /unresolved variables/u);
    assert.match(html, /View Variables/u);
    assert.match(html, /vars-expand/u);
    assert.match(html, /hasRequestVariableErrors/u);
    assert.match(html, /entry\.requestId === row\.requestId/u);
    // Healthy runs still get collapsed View Variables when trace exists
    assert.match(
      html,
      /unresolved\.length === 0[\s\S]*View Variables[\s\S]*renderFullVariableTraceBody/u,
    );
    // Full Variable Trace / Unresolved headings exist only inside expand body helper
    assert.match(html, /function renderFullVariableTraceBody[\s\S]*Variable Trace/u);
    assert.match(html, /function renderFullVariableTraceBody[\s\S]*Unresolved/u);
    assert.match(html, /Unresolved variable names/u);
    // Role labels live under Variables, not Overview extras
    assert.match(html, /vars-role-labels/u);
    assert.match(
      html,
      /function renderOverviewExtras[\s\S]*?return renderRowMessage\(row\);/u,
    );
    // Header render uses compact status, not always-on Variable Trace dump
    assert.match(html, /variablesStatusSection = renderVariablesStatus/u);
    assert.doesNotMatch(
      html,
      /variablesStatusSection[\s\S]{0,80}section-label">Variable Trace/u,
    );
    // Per-request Variables owns resolved lines; Execution Details keeps depends-on
    assert.match(
      html,
      /renderVariablesSection\(row, details\)[\s\S]*id: 'variables'[\s\S]*label: 'Variables'/u,
    );
    assert.match(
      html,
      /Resolved variables are listed under Variables/u,
    );
    assert.match(html, /request-vars-list/u);
    assert.match(
      html,
      /function renderExecutionDetails[\s\S]*?Depends on/u,
    );
  });

  test('Assertions section surfaces Expected/Actual without nested expanders', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /function renderAssertionsSection/u);
    assert.match(html, /ASSERTION_DETAIL_VALUE_MAX_CHARS/u);
    assert.match(html, /truncateAssertionDetailValue/u);
    assert.match(html, /<dt>Expected<\/dt>/u);
    assert.match(html, /<dt>Actual<\/dt>/u);
    assert.match(html, /assert-heading/u);
    assert.match(html, /assert-status muted-inline">Passed/u);
    assert.match(html, /assert-status muted-inline">Skipped/u);
    assert.doesNotMatch(html, /<details class="assert-detail">/u);
    assert.match(
      html,
      /openAssertions[\s\S]*id: 'assertions'[\s\S]*open: openAssertions/u,
    );
    assert.match(
      html,
      /assertionSummary\.failed[\s\S]*assertionSummary\.malformed/u,
    );
    assert.doesNotMatch(html, /stageLabel === 'Assertions'/u);
  });

  test('formatDuration handles missing and large values', () => {
    assert.equal(formatDuration(undefined), '—');
    assert.equal(formatDuration(40), '40 ms');
    assert.equal(formatDuration(1500), '1.50 s');
  });

  test('buildLiveCollectionRunReportModel marks live rows and progress', () => {
    const summary = sampleSummary();
    const session = {
      runId: summary.runId,
      status: 'running' as const,
      plan: summary.plan,
      collectionId: summary.plan.collectionId,
      collectionName: summary.plan.collectionName,
      mode: summary.plan.mode,
      failurePolicy: summary.plan.failurePolicy,
      total: summary.plan.requests.length,
      completed: 1,
      remaining: summary.plan.requests.length - 1,
      elapsedMs: 500,
      startedAt: summary.plan.createdAt,
      current: summary.plan.requests[1],
      results: summary.results.slice(0, 1),
    };
    const model = buildLiveCollectionRunReportModel(session);
    assert.equal(model.live, true);
    assert.equal(model.status, 'running');
    assert.equal(model.rows.length, 2);
    assert.match(model.summaryLine, /running/u);
    assert.equal(model.rows[0]?.outcome, RequestRunOutcomeKind.Passed);
    assert.equal(model.rows[0]?.message, undefined);
    assert.equal(model.rows[1]?.outcome, 'running');
    assert.equal(model.rows[1]?.message, 'Executing request...');
  });

  test('renderCollectionRunReportHtml includes running-row shimmer CSS and class wiring', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /row\.outcome === 'running' \? 'row-running'/u);
    assert.match(html, /\.req-row\.row-running/u);
    assert.match(
      html,
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.req-row\.row-running \{[\s\S]*?animation: ah-row-shimmer[\s\S]*?@keyframes ah-row-shimmer/u,
    );
  });

  test('buildLiveCollectionRunReportModel progresses as results accumulate then finishes', () => {
    const summary = sampleSummary();
    const baseSession = {
      runId: summary.runId,
      status: 'running' as const,
      plan: summary.plan,
      collectionId: summary.plan.collectionId,
      collectionName: summary.plan.collectionName,
      mode: summary.plan.mode,
      failurePolicy: summary.plan.failurePolicy,
      total: summary.plan.requests.length,
      startedAt: summary.plan.createdAt,
    };

    const started = buildLiveCollectionRunReportModel({
      ...baseSession,
      completed: 0,
      remaining: 2,
      elapsedMs: 10,
      current: summary.plan.requests[0],
      results: [],
    });
    assert.equal(started.rows[0]?.outcome, 'running');
    assert.equal(started.rows[0]?.message, 'Executing request...');
    assert.equal(started.rows[1]?.outcome, 'pending');
    assert.equal(started.rows[1]?.message, undefined);

    const mid = buildLiveCollectionRunReportModel({
      ...baseSession,
      completed: 1,
      remaining: 1,
      elapsedMs: 80,
      current: summary.plan.requests[1],
      results: summary.results.slice(0, 1),
    });
    assert.equal(mid.rows[0]?.outcome, RequestRunOutcomeKind.Passed);
    assert.equal(mid.rows[0]?.message, undefined);
    assert.equal(mid.rows[1]?.outcome, 'running');
    assert.equal(mid.rows[1]?.message, 'Executing request...');
    assert.equal(mid.passed, 1);
    assert.equal(mid.failed, 0);

    const finished = buildLiveCollectionRunReportModel({
      ...baseSession,
      status: 'completed',
      completed: 2,
      remaining: 0,
      elapsedMs: 220,
      results: summary.results,
      summary,
    });
    assert.equal(finished.live, false);
    assert.deepEqual(
      finished.rows.map((row) => row.outcome),
      buildCollectionRunReportModel(summary).rows.map((row) => row.outcome),
    );
    assert.ok(
      finished.rows.every((row) => row.outcome !== 'running'),
      'finished rows must not stay in running state (no row-running class)',
    );
    assert.ok(
      finished.rows.every((row) => row.message !== 'Executing request...'),
      'finished rows must not keep the running placeholder message',
    );
  });

  test('applyCollectionRunReportHostMessage accepts init, live, and update', () => {
    const summary = sampleSummary();
    const initModel = buildCollectionRunReportModel(summary);
    const liveModel = buildLiveCollectionRunReportModel({
      runId: summary.runId,
      status: 'running',
      plan: summary.plan,
      collectionId: summary.plan.collectionId,
      collectionName: summary.plan.collectionName,
      mode: summary.plan.mode,
      failurePolicy: summary.plan.failurePolicy,
      total: summary.plan.requests.length,
      completed: 0,
      remaining: summary.plan.requests.length,
      elapsedMs: 1,
      startedAt: summary.plan.createdAt,
      current: summary.plan.requests[0],
      results: [],
    });

    assert.deepEqual(
      applyCollectionRunReportHostMessage(undefined, { type: 'init', model: initModel }),
      { model: initModel, resetExpanded: true },
    );
    assert.deepEqual(
      applyCollectionRunReportHostMessage(initModel, { type: 'live', model: liveModel }),
      { model: liveModel, resetExpanded: false },
    );
    assert.deepEqual(
      applyCollectionRunReportHostMessage(initModel, { type: 'update', model: liveModel }),
      { model: liveModel, resetExpanded: false },
    );
    assert.equal(
      applyCollectionRunReportHostMessage(initModel, {
        type: 'error',
        model: initModel,
      }),
      undefined,
    );
    assert.equal(
      applyCollectionRunReportHostMessage(initModel, { type: 'unknown' }),
      undefined,
    );
  });

  test('renderCollectionRunReportHtml script handles live and update progress messages', () => {
    const html = renderCollectionRunReportHtml('reportNonce');
    assert.match(html, /data\.type === 'live' \|\| data\.type === 'update'/u);
  });

  test('normalizeFailurePolicySetting defaults unknown to ask', () => {
    assert.equal(
      normalizeFailurePolicySetting('ask'),
      FailurePolicySettingValue.Ask,
    );
    assert.equal(
      normalizeFailurePolicySetting('continue-on-error'),
      FailurePolicyKind.ContinueOnError,
    );
    assert.equal(
      normalizeFailurePolicySetting('stop-on-first-error'),
      FailurePolicyKind.StopOnFirstError,
    );
    assert.equal(
      normalizeFailurePolicySetting('skip-invalid-requests'),
      FailurePolicyKind.SkipInvalidRequests,
    );
    assert.equal(normalizeFailurePolicySetting('nope'), FailurePolicySettingValue.Ask);
    assert.equal(normalizeFailurePolicySetting(undefined), FailurePolicySettingValue.Ask);
  });

  test('resolveFailurePolicyForRun prompts only when ask', async () => {
    let prompted = 0;
    const prompt = async (): Promise<typeof FailurePolicyKind.ContinueOnError> => {
      prompted += 1;
      return FailurePolicyKind.ContinueOnError;
    };

    assert.equal(
      await resolveFailurePolicyForRun(
        FailurePolicyKind.StopOnFirstError,
        prompt,
      ),
      FailurePolicyKind.StopOnFirstError,
    );
    assert.equal(prompted, 0);

    assert.equal(
      await resolveFailurePolicyForRun(FailurePolicySettingValue.Ask, prompt),
      FailurePolicyKind.ContinueOnError,
    );
    assert.equal(prompted, 1);
  });

  test('buildLiveCollectionRunReportModel projects folder fields onto placeholders', () => {
    const summary = sampleFolderSummary();
    const model = buildLiveCollectionRunReportModel({
      runId: summary.runId,
      status: 'running',
      plan: summary.plan,
      collectionId: summary.plan.collectionId,
      collectionName: summary.plan.collectionName,
      mode: summary.plan.mode,
      failurePolicy: summary.plan.failurePolicy,
      total: summary.plan.requests.length,
      completed: 0,
      remaining: summary.plan.requests.length,
      elapsedMs: 5,
      startedAt: summary.plan.createdAt,
      current: summary.plan.requests[0],
      results: [],
    });
    assert.equal(model.collectionId, 'collection:demo');
    assert.equal(model.rows[1]?.folderId, 'folder:assistants');
    assert.equal(model.rows[1]?.folderRelativePath, 'Assistants');
    assert.equal(model.rows[0]?.outcome, 'running');
  });

  test('embedded report script parses and emits a valid cssEscapeAttr fallback', () => {
    const script = extractReportScript(renderCollectionRunReportHtml('reportNonce'));
    assert.doesNotThrow(() => {
      new Function(script);
    });
    assert.ok(
      script.includes("replaceAll('\\\\', '\\\\\\\\')"),
      'emitted script must contain replaceAll(\'\\\\\', \'\\\\\\\\\')',
    );
    assert.ok(
      !script.includes('replace(/\\/g'),
      'emitted script must not contain the broken /\\/g regex',
    );
  });

  test('init message replaces loading with a successful collection report', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    const { root } = runInitRender(model);
    assert.doesNotMatch(root.innerHTML, /Loading run report/u);
    assert.match(root.innerHTML, /Demo/u);
    assert.match(root.innerHTML, /id="exportBtn"/u);
    assert.match(root.innerHTML, /id="runAgainBtn"/u);
  });

  test('init message renders failed requests section', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    const { root } = runInitRender(model);
    assert.doesNotMatch(root.innerHTML, /Loading run report/u);
    assert.match(root.innerHTML, /Create user/u);
    assert.match(root.innerHTML, /failed-section/u);
  });

  test('init message renders unresolved variable status', () => {
    const model = buildCollectionRunReportModel(sampleDependencySummary());
    const { root } = runInitRender(model);
    assert.doesNotMatch(root.innerHTML, /Loading run report/u);
    assert.match(root.innerHTML, /unresolved/u);
    assert.match(root.innerHTML, /accessToken|orderId|Variables/u);
  });

  test('large collection init payload serializes and replaces loading', () => {
    const model = buildCollectionRunReportModel(largeSummary(80));
    const serialized = JSON.stringify({ type: 'init', model });
    const parsed = JSON.parse(serialized) as {
      type: string;
      model: CollectionRunReportModel;
    };
    const { root } = runInitRender(parsed.model);
    assert.doesNotMatch(root.innerHTML, /Loading run report/u);
    assert.match(root.innerHTML, /Demo/u);
  });

  test('historical open uses the same init handoff and render path', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    const applied = applyCollectionRunReportHostMessage(undefined, {
      type: 'init',
      model,
    });
    assert.deepEqual(applied, { model, resetExpanded: true });
    const { root } = runInitRender(applied?.model ?? model);
    assert.doesNotMatch(root.innerHTML, /Loading run report/u);
    assert.match(root.innerHTML, /Demo/u);
  });
});

function sampleFolderSummary(): RunSummary {
  return {
    runId: 'run_folders',
    plan: {
      runId: 'run_folders',
      mode: CollectionRunMode.Collection,
      collectionId: 'collection:demo',
      collectionName: 'Demo',
      failurePolicy: FailurePolicyKind.ContinueOnError,
      createdAt: '2026-07-21T10:00:00.000Z',
      requests: [
        {
          requestId: 'req_root',
          collectionId: 'collection:demo',
          filePath: 'file:///demo/root.api',
          offset: 0,
          label: 'Health',
          method: 'GET',
          url: 'https://example.test/health',
          ordinal: 0,
          folderRelativePath: '',
        },
        {
          requestId: 'req_assistants',
          collectionId: 'collection:demo',
          folderId: 'folder:assistants',
          filePath: 'file:///demo/assistants.api',
          offset: 0,
          label: 'List Assistants',
          method: 'GET',
          url: 'https://example.test/assistants',
          ordinal: 1,
          folderRelativePath: 'Assistants',
        },
        {
          requestId: 'req_threads',
          collectionId: 'collection:demo',
          folderId: 'folder:threads',
          filePath: 'file:///demo/threads.api',
          offset: 0,
          label: 'List Threads',
          method: 'GET',
          url: 'https://example.test/threads',
          ordinal: 2,
          folderRelativePath: 'Chat/Threads',
        },
      ],
    },
    results: [
      {
        requestId: 'req_root',
        ordinal: 0,
        label: 'Health',
        outcome: RequestRunOutcomeKind.Passed,
        durationMs: 40,
        statusCode: 200,
      },
      {
        requestId: 'req_assistants',
        ordinal: 1,
        label: 'List Assistants',
        outcome: RequestRunOutcomeKind.Passed,
        durationMs: 55,
        statusCode: 200,
      },
      {
        requestId: 'req_threads',
        ordinal: 2,
        label: 'List Threads',
        outcome: RequestRunOutcomeKind.Failed,
        durationMs: 70,
        statusCode: 500,
      },
    ],
    statistics: {
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      cancelled: 0,
      durationMs: 165,
      averageResponseTimeMs: 55,
      assertionsPassed: 0,
      assertionsFailed: 0,
      assertionsTotal: 0,
      preconditionFailures: 0,
      transportFailures: 0,
      assertionFailures: 0,
      extractionFailures: 0,
      protocolFailures: 0,
    },
    completedAt: '2026-07-21T10:00:01.000Z',
    status: CollectionRunStatus.Completed,
  };
}

function sampleDependencySummary(): RunSummary {
  return {
    runId: 'run_2',
    plan: {
      runId: 'run_2',
      mode: CollectionRunMode.Collection,
      collectionId: 'collection:demo',
      collectionName: 'Demo',
      failurePolicy: FailurePolicyKind.ContinueOnError,
      createdAt: '2026-07-21T10:00:00.000Z',
      requests: [
        {
          requestId: 'req_login',
          collectionId: 'collection:demo',
          filePath: 'file:///demo/login.api',
          offset: 0,
          label: 'Login',
          method: 'POST',
          url: 'https://example.test/login',
          ordinal: 0,
        },
        {
          requestId: 'req_products',
          collectionId: 'collection:demo',
          filePath: 'file:///demo/products.api',
          offset: 0,
          label: 'Products',
          method: 'GET',
          url: 'https://example.test/products',
          ordinal: 1,
        },
        {
          requestId: 'req_invoice',
          collectionId: 'collection:demo',
          filePath: 'file:///demo/invoice.api',
          offset: 0,
          label: 'Invoice',
          method: 'GET',
          url: 'https://example.test/invoices',
          ordinal: 2,
        },
      ],
      extensions: {
        dependencies: {
          nodes: [],
          edges: [
            {
              fromRequestId: 'req_login',
              toRequestId: 'req_products',
              kind: 'implicit',
              variable: 'accessToken',
            },
          ],
          reordered: true,
          originalOrder: ['req_products', 'req_login', 'req_invoice'],
          executionOrder: ['req_login', 'req_products', 'req_invoice'],
          cycles: [],
          unresolvedConsumes: [
            { requestId: 'req_invoice', variable: 'orderId' },
          ],
        },
      },
    },
    results: [
      {
        requestId: 'req_login',
        ordinal: 0,
        label: 'Login',
        outcome: RequestRunOutcomeKind.Failed,
        durationMs: 90,
        statusCode: 500,
      },
      {
        requestId: 'req_products',
        ordinal: 1,
        label: 'Products',
        outcome: RequestRunOutcomeKind.Skipped,
        message: 'Missing run variable: accessToken (producer Login failed)',
        skipReason: 'Missing run variable: accessToken (producer Login failed)',
      },
      {
        requestId: 'req_invoice',
        ordinal: 2,
        label: 'Invoice',
        outcome: RequestRunOutcomeKind.Skipped,
        message: 'Missing run variable: orderId',
        skipReason: 'Missing run variable: orderId',
      },
    ],
    statistics: {
      total: 3,
      passed: 0,
      failed: 1,
      skipped: 2,
      cancelled: 0,
      durationMs: 90,
      averageResponseTimeMs: 90,
      assertionsPassed: 0,
      assertionsFailed: 0,
      assertionsTotal: 0,
      preconditionFailures: 0,
      transportFailures: 0,
      assertionFailures: 0,
      extractionFailures: 0,
      protocolFailures: 0,
    },
    completedAt: '2026-07-21T10:00:01.000Z',
    status: CollectionRunStatus.Completed,
  };
}

function sampleSummary(): RunSummary {
  return {
    runId: 'run_1',
    plan: {
      runId: 'run_1',
      mode: CollectionRunMode.Collection,
      collectionId: 'collection:demo',
      collectionName: 'Demo',
      failurePolicy: FailurePolicyKind.ContinueOnError,
      createdAt: '2026-07-21T10:00:00.000Z',
      requests: [
        {
          requestId: 'req_ok',
          collectionId: 'collection:demo',
          filePath: 'file:///demo/ok.api',
          offset: 0,
          label: 'List users',
          method: 'GET',
          url: 'https://example.test/users',
          ordinal: 0,
        },
        {
          requestId: 'req_fail',
          collectionId: 'collection:demo',
          filePath: 'file:///demo/fail.api',
          offset: 0,
          label: 'Create user',
          method: 'POST',
          url: 'https://example.test/users',
          ordinal: 1,
        },
      ],
    },
    results: [
      {
        requestId: 'req_ok',
        ordinal: 0,
        label: 'List users',
        outcome: RequestRunOutcomeKind.Passed,
        durationMs: 120,
        statusCode: 200,
        assertionsPassed: 2,
        assertionsFailed: 0,
        assertionsTotal: 2,
      },
      {
        requestId: 'req_fail',
        ordinal: 1,
        label: 'Create user',
        outcome: RequestRunOutcomeKind.Failed,
        durationMs: 80,
        statusCode: 500,
        message: 'Assertion Failed\nExpected status 200 but received 500.',
        failureDiagnostics: {
          category: 'assertion',
          reason: 'Expected status 200 but received 500.',
          httpRequestSent: true,
          failedAtStage: 'assertions',
        },
        assertionsPassed: 1,
        assertionsFailed: 1,
        assertionsTotal: 2,
      },
    ],
    statistics: {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      cancelled: 0,
      durationMs: 220,
      averageResponseTimeMs: 100,
      assertionsPassed: 3,
      assertionsFailed: 1,
      assertionsTotal: 4,
      preconditionFailures: 0,
      transportFailures: 0,
      assertionFailures: 1,
      extractionFailures: 0,
      protocolFailures: 0,
    },
    completedAt: '2026-07-21T10:00:01.000Z',
    status: CollectionRunStatus.Completed,
  };
}

function extractReportScript(html: string): string {
  const match = /<script[^>]*>([\s\S]*)<\/script>/u.exec(html);
  assert.ok(match?.[1], 'expected embedded report script');
  return match[1];
}

function largeSummary(rowCount: number): RunSummary {
  const base = sampleSummary();
  const templateRequest = base.plan.requests[0]!;
  const templateResult = base.results[0]!;
  const requests = Array.from({ length: rowCount }, (_, index) => ({
    ...templateRequest,
    requestId: `req_${index}`,
    label: `Request ${index}`,
    ordinal: index,
    filePath: `file:///demo/r${index}.api`,
  }));
  const results = requests.map((request, index) => ({
    ...templateResult,
    requestId: request.requestId,
    label: request.label,
    ordinal: index,
    outcome:
      index % 10 === 0
        ? RequestRunOutcomeKind.Failed
        : RequestRunOutcomeKind.Passed,
  }));
  const failed = results.filter(
    (result) => result.outcome === RequestRunOutcomeKind.Failed,
  ).length;
  return {
    ...base,
    plan: { ...base.plan, requests },
    results,
    statistics: {
      ...base.statistics,
      total: rowCount,
      passed: rowCount - failed,
      failed,
    },
  };
}

function runInitRender(model: CollectionRunReportModel): { root: { innerHTML: string } } {
  const script = extractReportScript(renderCollectionRunReportHtml('reportNonce'));
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const root = {
    innerHTML: 'Loading run report…',
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  };
  runInNewContext(script, {
    acquireVsCodeApi() {
      return {
        postMessage() {
          /* unused in this harness */
        },
      };
    },
    document: {
      getElementById(id: string) {
        return id === 'root' ? root : null;
      },
    },
    window: {
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        if (type === 'message') {
          messageListeners.push(listener);
        }
      },
    },
  });
  for (const listener of messageListeners) {
    listener({ data: { type: 'init', model } });
  }
  return { root };
}
