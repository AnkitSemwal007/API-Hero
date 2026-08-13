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
import { MASKED_HEADER_VALUE } from '../../response/presentation';
import { SECRET_SCRUB_MASK } from '../../shared';
import { buildCollectionRunReportModel } from './run-report-html';
import {
  confirmOverwriteIfExists,
  renderStandaloneCollectionRunReportHtml,
  sanitizeRunReportFileStem,
  serializeCollectionRunReportJson,
  suggestedRunReportFileName,
} from './run-report-export';

const RAW_BEARER = 'rawBearerSecretValue99xyz';
const RAW_API_KEY = 'rawApiKeySecretValue99xyz';
const RAW_PASSWORD = 'rawPasswordSecretValue99xyz';
const RAW_ACCESS_TOKEN = 'rawAccessTokenSecretValue99xyz';
const RAW_REFRESH_TOKEN = 'rawRefreshTokenSecretValue99xyz';

describe('collection-run-report-export', () => {
  test('JSON export includes a successful report', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleSummary()),
    );
    const parsed = JSON.parse(json) as {
      collectionName: string;
      passed: number;
      failed: number;
      rows: readonly { label: string; outcome: string }[];
    };
    assert.equal(parsed.collectionName, 'Demo');
    assert.equal(parsed.passed, 1);
    assert.match(json, /List users/u);
    assert.equal(parsed.rows[0]?.outcome, RequestRunOutcomeKind.Passed);
  });

  test('JSON export includes a failed report', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleSummary()),
    );
    const parsed = JSON.parse(json) as {
      failed: number;
      rows: readonly { label: string; isFailure: boolean }[];
    };
    assert.equal(parsed.failed, 1);
    assert.equal(parsed.rows[1]?.label, 'Create user');
    assert.equal(parsed.rows[1]?.isFailure, true);
    assert.match(json, /Assertion Failed/u);
  });

  test('JSON export includes skipped requests', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleDependencySummary()),
    );
    const parsed = JSON.parse(json) as {
      skipped: number;
      rows: readonly { outcome: string; skipReason?: string }[];
    };
    assert.equal(parsed.skipped, 2);
    assert.equal(parsed.rows[1]?.outcome, RequestRunOutcomeKind.Skipped);
    assert.match(json, /Missing run variable: accessToken/u);
  });

  test('JSON export includes dependencies', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleDependencySummary()),
    );
    assert.match(json, /Login → Products \(accessToken\)/u);
    const parsed = JSON.parse(json) as {
      reordered: boolean;
      dependencyEdges: readonly { label: string }[];
    };
    assert.equal(parsed.reordered, true);
    assert.equal(parsed.dependencyEdges.length, 1);
  });

  test('JSON export includes unresolved variables', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleDependencySummary()),
    );
    assert.match(json, /"variable": "orderId"/u);
    assert.match(json, /Invoice/u);
  });

  test('JSON export includes assertions', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleAssertionSummary()),
    );
    assert.match(json, /expect status == 200/u);
    assert.match(json, /"assertionsLabel": "2\/2"/u);
  });

  test('JSON export includes diagnostics', () => {
    const json = serializeCollectionRunReportJson(
      buildCollectionRunReportModel(sampleSummary()),
    );
    assert.match(json, /Assertion Failed/u);
    assert.match(json, /Expected status 200 but received 500/u);
    assert.match(json, /"httpRequestSent": true/u);
  });

  test('HTML export includes a successful report', () => {
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(sampleSummary()),
    );
    assert.match(html, /<title>Run Report: Demo<\/title>/u);
    assert.match(html, /Demo/u);
    assert.match(html, /"passed":1/u);
    assert.match(html, /List users/u);
  });

  test('HTML export includes a failed report', () => {
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(sampleSummary()),
    );
    assert.match(html, /Create user/u);
    assert.match(html, /"failed":1/u);
    assert.match(html, /Assertion Failed/u);
  });

  test('HTML export includes dependencies', () => {
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(sampleDependencySummary()),
    );
    assert.match(html, /Login → Products \(accessToken\)/u);
  });

  test('HTML export includes unresolved variables', () => {
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(sampleDependencySummary()),
    );
    assert.match(html, /orderId/u);
    assert.match(html, /Invoice/u);
  });

  test('HTML export includes request results and diagnostics', () => {
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(sampleSummary()),
    );
    assert.match(html, /List users/u);
    assert.match(html, /Create user/u);
    assert.match(html, /"passed":1/u);
    assert.match(html, /"failed":1/u);
    assert.match(html, /"skipped":0/u);
    assert.match(html, /Expected status 200 but received 500/u);
  });

  test('standalone HTML does not call acquireVsCodeApi', () => {
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(sampleSummary()),
    );
    assert.doesNotMatch(html, /acquireVsCodeApi/u);
    assert.match(html, /const STANDALONE = true/u);
    assert.match(html, /id="report-model"/u);
    assert.match(html, /--vscode-foreground: CanvasText/u);
  });

  test('standalone HTML seeds the model and renders without acquireVsCodeApi', () => {
    const model = buildCollectionRunReportModel(sampleSummary());
    const html = renderStandaloneCollectionRunReportHtml(model);
    const { root } = runStandaloneRender(html);
    assert.doesNotMatch(root.innerHTML, /Loading run report/u);
    assert.match(root.innerHTML, /Demo/u);
    assert.match(root.innerHTML, /List users/u);
    assert.match(root.innerHTML, /Create user/u);
    assert.doesNotMatch(root.innerHTML, /id="exportBtn"/u);
    assert.doesNotMatch(root.innerHTML, /id="runAgainBtn"/u);
  });

  test('JSON and HTML redact API keys, passwords, and tokens', () => {
    const model = buildCollectionRunReportModel(sampleSecretSummary());
    const json = serializeCollectionRunReportJson(model);
    const html = renderStandaloneCollectionRunReportHtml(model);

    for (const output of [json, html]) {
      assert.doesNotMatch(output, new RegExp(RAW_BEARER, 'u'));
      assert.doesNotMatch(output, new RegExp(RAW_API_KEY, 'u'));
      assert.doesNotMatch(output, new RegExp(RAW_PASSWORD, 'u'));
      assert.doesNotMatch(output, new RegExp(RAW_ACCESS_TOKEN, 'u'));
      assert.doesNotMatch(output, new RegExp(RAW_REFRESH_TOKEN, 'u'));
      assert.match(output, /Authorization/u);
      assert.match(output, /X-Api-Key/u);
      assert.match(output, /accessToken|password|refreshToken|apiKey/u);
      assert.match(
        output,
        new RegExp(`${MASKED_HEADER_VALUE}|${SECRET_SCRUB_MASK}`, 'u'),
      );
    }
  });

  test('embedded HTML JSON escapes script breakout', () => {
    const base = sampleSummary();
    const withBreakout: RunSummary = {
      ...base,
      plan: { ...base.plan, collectionName: 'Demo</script><img>' },
    };
    const html = renderStandaloneCollectionRunReportHtml(
      buildCollectionRunReportModel(withBreakout),
    );
    assert.doesNotMatch(html, /<script type="application\/json"[^>]*>[\s\S]*<\/script><img>/u);
    assert.match(html, /<\\\/script>/u);
  });

  test('sanitize strips unsafe filesystem characters', () => {
    assert.equal(sanitizeRunReportFileStem('A<>:"/\\|?*B'), 'A_________B');
    assert.equal(sanitizeRunReportFileStem('  '), 'run-report');
    assert.equal(sanitizeRunReportFileStem(''), 'run-report');
    assert.equal(sanitizeRunReportFileStem('Demo.'), 'Demo');
  });

  test('suggested names end with .json or .html', () => {
    assert.equal(suggestedRunReportFileName('Demo', 'json'), 'Demo-run-report.json');
    assert.equal(suggestedRunReportFileName('Demo', 'html'), 'Demo-run-report.html');
    assert.equal(suggestedRunReportFileName('', 'json'), 'run-report.json');
    assert.match(suggestedRunReportFileName('Qux', 'json'), /\.json$/u);
    assert.match(suggestedRunReportFileName('Qux', 'html'), /\.html$/u);
  });

  test('overwrite confirm false does not write', async () => {
    let confirmed = false;
    const allowed = await confirmOverwriteIfExists(true, async () => {
      confirmed = true;
      return false;
    });
    assert.equal(allowed, false);
    assert.equal(confirmed, true);
  });

  test('overwrite skipped when destination does not exist', async () => {
    let confirmed = false;
    const allowed = await confirmOverwriteIfExists(false, async () => {
      confirmed = true;
      return false;
    });
    assert.equal(allowed, true);
    assert.equal(confirmed, false);
  });

  test('cancellation path returns without throwing', async () => {
    const allowed = await confirmOverwriteIfExists(true, async () => false);
    assert.equal(allowed, false);
    assert.doesNotThrow(() => suggestedRunReportFileName('', 'json'));
    assert.doesNotThrow(() => sanitizeRunReportFileStem(''));
  });
});

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

function sampleAssertionSummary(): RunSummary {
  const base = sampleSummary();
  return {
    ...base,
    results: [
      {
        ...base.results[0]!,
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
            assertions: [{ text: 'expect status == 200', outcome: 'passed' }],
          },
          summary: '200 OK · 120 ms · 0 B',
        },
      },
      base.results[1]!,
    ],
  };
}

function sampleSecretSummary(): RunSummary {
  const base = sampleSummary();
  const secretBody = JSON.stringify({
    accessToken: RAW_ACCESS_TOKEN,
    password: RAW_PASSWORD,
    refreshToken: RAW_REFRESH_TOKEN,
    apiKey: RAW_API_KEY,
  });
  return {
    ...base,
    results: [
      {
        ...base.results[0]!,
        resolvedVariables: [
          {
            name: 'password',
            scope: 'environment',
            sensitive: true,
            displayValue: SECRET_SCRUB_MASK,
          },
          {
            name: 'apiKey',
            scope: 'environment',
            sensitive: true,
            displayValue: MASKED_HEADER_VALUE,
          },
        ],
        presentation: {
          success: true,
          requestId: 'req_ok',
          method: 'GET',
          requestUrl: 'https://example.test/users',
          status: { code: 200, text: 'OK' },
          headers: [
            {
              name: 'Authorization',
              value: `Bearer ${RAW_BEARER}`,
              masked: false,
            },
            { name: 'X-Api-Key', value: RAW_API_KEY, masked: false },
            { name: 'Cookie', value: `session=${RAW_PASSWORD}`, masked: false },
          ],
          cookies: { available: false, setCookieHeaderCount: 0 },
          statistics: {
            durationMs: 120,
            startedAt: '2026-07-27T10:00:00.000Z',
            completedAt: '2026-07-27T10:00:00.120Z',
            headerCount: 3,
            redirected: false,
            redirectCount: 0,
          },
          body: {
            language: 'json',
            raw: secretBody,
            pretty: JSON.stringify(
              {
                accessToken: RAW_ACCESS_TOKEN,
                password: RAW_PASSWORD,
                refreshToken: RAW_REFRESH_TOKEN,
                apiKey: RAW_API_KEY,
              },
              null,
              2,
            ),
            prettyAvailable: true,
            truncated: false,
            displayedUnits: secretBody.length,
            totalUnits: secretBody.length,
            unit: 'characters',
          },
          summary: '200 OK · 120 ms · 0 B',
        },
      },
      base.results[1]!,
    ],
  };
}

function extractStandaloneScript(html: string): string {
  const matches = [...html.matchAll(/<script(?![^>]*type=)[^>]*>([\s\S]*?)<\/script>/gu)];
  const last = matches.at(-1)?.[1];
  assert.ok(last, 'expected standalone report script');
  return last;
}

function extractEmbeddedModel(html: string): unknown {
  const match = /<script type="application\/json" id="report-model">([\s\S]*?)<\/script>/u.exec(
    html,
  );
  assert.ok(match?.[1], 'expected embedded report model');
  return JSON.parse(match[1].replaceAll('<\\/', '</'));
}

function runStandaloneRender(html: string): { root: { innerHTML: string } } {
  const script = extractStandaloneScript(html);
  const model = extractEmbeddedModel(html);
  const root = {
    innerHTML: 'Loading run report…',
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  };
  const seed = { textContent: JSON.stringify(model) };
  assert.doesNotMatch(script, /acquireVsCodeApi/u);
  runInNewContext(script, {
    document: {
      getElementById(id: string) {
        if (id === 'root') {
          return root;
        }
        if (id === 'report-model') {
          return seed;
        }
        return null;
      },
    },
    window: {
      addEventListener() {
        /* unused */
      },
    },
  });
  return { root };
}
