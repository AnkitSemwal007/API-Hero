import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

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
  normalizeFailurePolicySetting,
  parseCollectionRunReportMessage,
  renderCollectionRunReportHtml,
  resolveFailurePolicyForRun,
  FailurePolicySettingValue,
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
    assert.match(html, /Failed only/u);
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
    assert.equal(parseCollectionRunReportMessage(null), undefined);
  });

  test('buildCollectionRunReportModel maps per-request rows', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    assert.equal(model.collectionName, 'Demo');
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

  test('buildCollectionRunReportModel surfaces dependency order, produced vars, and skip reasons', () => {
    const model = buildCollectionRunReportModel(sampleDependencySummary());
    assert.equal(model.reordered, true);
    assert.deepEqual(
      model.dependencyEdges.map((edge) => edge.label),
      ['Login → Products (accessToken)'],
    );
    assert.deepEqual(model.unresolvedConsumes, [
      { variable: 'orderId', requestLabel: 'Invoice' },
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
    assert.match(html, /Execution order/);
    assert.match(html, /Reordered/);
    assert.match(html, /Dependencies/);
    assert.match(html, /Unresolved/);
    assert.match(html, /Variable Trace/);
    assert.match(html, /toggle-details/);
    assert.match(html, /renderDetailPanel/);
    assert.match(html, /vars-produced/);
    assert.match(html, /vars-consumed/);
    assert.match(html, /skip-reason/);
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
    assert.match(html, /tr\.row-running td:first-child/u);
    assert.match(
      html,
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?tr\.row-running td \{[\s\S]*?animation: ah-row-shimmer[\s\S]*?@keyframes ah-row-shimmer/u,
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
});

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
        message: 'Assertions failed.',
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
    },
    completedAt: '2026-07-21T10:00:01.000Z',
    status: CollectionRunStatus.Completed,
  };
}
