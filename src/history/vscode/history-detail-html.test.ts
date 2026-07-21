import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  HISTORY_SCHEMA_VERSION,
  HistoryExecutionStatus,
  type HistoryEntry,
} from '../models';
import {
  buildHistoryDetailModel,
  escapeAttribute,
  escapeHtml,
  formatBytes,
  formatDuration,
  formatHistorySummaryText,
  parseHistoryDetailMessage,
  renderHistoryDetailHtml,
} from './history-detail-html';

describe('history-detail-html', () => {
  test('renderHistoryDetailHtml embeds CSP nonce and shell', () => {
    const html = renderHistoryDetailHtml('histNonce');
    assert.match(html, /style-src 'nonce-histNonce'/u);
    assert.match(html, /script-src 'nonce-histNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="root"/u);
    assert.match(html, /Loading history entry/u);
    assert.match(html, /--vscode-editor-background/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
  });

  test('escapeAttribute and escapeHtml neutralize breakouts', () => {
    assert.equal(escapeHtml(`a<b>"c"'`), 'a&lt;b&gt;&quot;c&quot;&#39;');
    assert.equal(escapeAttribute(`a"b'\``), 'a&quot;b&#39;&#96;');
  });

  test('parseHistoryDetailMessage accepts allowlisted actions only', () => {
    assert.deepEqual(parseHistoryDetailMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseHistoryDetailMessage({ type: 'rerun' }), {
      type: 'rerun',
    });
    assert.deepEqual(parseHistoryDetailMessage({ type: 'reveal' }), {
      type: 'reveal',
    });
    assert.deepEqual(parseHistoryDetailMessage({ type: 'copySummary' }), {
      type: 'copySummary',
    });
    assert.deepEqual(parseHistoryDetailMessage({ type: 'delete' }), {
      type: 'delete',
    });
    assert.equal(parseHistoryDetailMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseHistoryDetailMessage({ type: 'rerun', extra: true }),
      undefined,
    );
    assert.equal(parseHistoryDetailMessage(null), undefined);
  });

  test('buildHistoryDetailModel maps success metadata without body fields', () => {
    const model = buildHistoryDetailModel(sampleEntry());
    assert.equal(model.id, 'hist_1');
    assert.equal(model.method, 'GET');
    assert.equal(model.url, 'https://example.test/users');
    assert.equal(model.outcome, HistoryExecutionStatus.Success);
    assert.equal(model.statusBadgeClass, 'status-success');
    assert.match(model.statusBadgeText, /200/u);
    assert.equal(model.durationLabel, '120 ms');
    assert.equal(model.contentType, 'application/json');
    assert.equal(model.responseSizeLabel, '3 B');
    assert.equal(model.canRerun, true);
    assert.equal(model.canReveal, true);
    assert.equal(model.environmentName, 'local');
    assert.doesNotMatch(model.summaryText, /body/iu);
    assert.match(model.summaryText, /GET https:\/\/example\.test\/users/u);
  });

  test('buildHistoryDetailModel handles failure without source', () => {
    const model = buildHistoryDetailModel({
      id: 'hist_fail',
      schemaVersion: HISTORY_SCHEMA_VERSION,
      summary: {
        method: 'POST',
        url: 'https://example.test/login',
        durationMs: 40,
        timestamp: '2026-07-20T10:00:00.000Z',
        status: HistoryExecutionStatus.Failure,
      },
      metadata: {
        errorCode: 'NETWORK',
        errorMessage: 'Connection refused',
      },
    });
    assert.equal(model.canRerun, false);
    assert.equal(model.canReveal, false);
    assert.equal(model.errorCode, 'NETWORK');
    assert.equal(model.statusBadgeClass, 'status-error');
    assert.match(model.summaryText, /NETWORK/u);
  });

  test('format helpers cover duration and bytes edges', () => {
    assert.equal(formatDuration(500), '500 ms');
    assert.equal(formatDuration(1500), '1.50 s');
    assert.equal(formatDuration(Number.NaN), '—');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KiB');
    assert.equal(formatBytes(-1), '—');
  });

  test('formatHistorySummaryText lists key metadata lines', () => {
    const text = formatHistorySummaryText(sampleEntry());
    assert.match(text, /Outcome: Success/u);
    assert.match(text, /Duration: 120 ms/u);
    assert.match(text, /Environment: local/u);
    assert.match(text, /Source: file:\/\/\/workspace\/users\.api/u);
  });
});

function sampleEntry(
  overrides: {
    readonly summary?: Partial<HistoryEntry['summary']>;
    readonly metadata?: Partial<HistoryEntry['metadata']>;
  } = {},
): HistoryEntry {
  return {
    id: 'hist_1',
    schemaVersion: HISTORY_SCHEMA_VERSION,
    summary: {
      method: 'GET',
      url: 'https://example.test/users',
      statusCode: 200,
      statusText: 'OK',
      durationMs: 120,
      timestamp: '2026-07-20T10:00:00.120Z',
      status: HistoryExecutionStatus.Success,
      ...overrides.summary,
    },
    metadata: {
      requestName: 'List users',
      environmentName: 'local',
      contentType: 'application/json',
      responseSizeBytes: 3,
      source: {
        uri: 'file:///workspace/users.api',
        line: 0,
        character: 0,
      },
      ...overrides.metadata,
    },
  };
}
