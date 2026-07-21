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
  buildCollectionRunReportModel,
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
    assert.match(html, /Loading collection run report/u);
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
    assert.equal(model.rows[0]?.durationLabel, '120 ms');
    assert.equal(model.rows[0]?.assertionsLabel, '2/2');
    assert.equal(model.rows[1]?.isFailure, true);
    assert.equal(model.rows[1]?.assertionsLabel, '1/2 (1 failed)');
    assert.match(model.failurePolicyLabel, /Continue/u);
    assert.equal(model.rows[0]?.canOpen, true);
  });

  test('formatDuration handles missing and large values', () => {
    assert.equal(formatDuration(undefined), '—');
    assert.equal(formatDuration(40), '40 ms');
    assert.equal(formatDuration(1500), '1.50 s');
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
