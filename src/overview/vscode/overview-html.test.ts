import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  HISTORY_SCHEMA_VERSION,
  HistoryExecutionStatus,
  type HistoryEntry,
} from '../../history/models';
import type { WorkspaceCollections } from '../../collections/models';
import {
  OverviewQuickAction,
  buildOverviewModel,
  parseOverviewMessage,
  renderOverviewHtml,
} from './overview-html';

describe('overview-html', () => {
  test('renderOverviewHtml embeds CSP nonce and theme tokens', () => {
    const html = renderOverviewHtml('ovNonce');
    assert.match(html, /style-src 'nonce-ovNonce'/u);
    assert.match(html, /script-src 'nonce-ovNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="root"/u);
    assert.match(html, /Loading overview/u);
    assert.match(html, /--vscode-editor-background/u);
    assert.match(html, /--vscode-button-background/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
    assert.match(html, /Create Request/u);
    assert.match(html, /Focus Collections/u);
  });

  test('parseOverviewMessage accepts allowlisted actions only', () => {
    assert.deepEqual(parseOverviewMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseOverviewMessage({ type: 'refresh' }), {
      type: 'refresh',
    });
    assert.deepEqual(parseOverviewMessage({ type: 'focusCollections' }), {
      type: 'focusCollections',
    });
    assert.deepEqual(
      parseOverviewMessage({
        type: 'runAction',
        action: OverviewQuickAction.CreateRequest,
      }),
      { type: 'runAction', action: 'createRequest' },
    );
    assert.deepEqual(
      parseOverviewMessage({ type: 'openHistory', id: 'hist_1' }),
      { type: 'openHistory', id: 'hist_1' },
    );
    assert.equal(parseOverviewMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseOverviewMessage({ type: 'runAction', action: 'hack' }),
      undefined,
    );
    assert.equal(
      parseOverviewMessage({ type: 'openHistory', id: '' }),
      undefined,
    );
    assert.equal(
      parseOverviewMessage({ type: 'ready', extra: true }),
      undefined,
    );
    assert.equal(parseOverviewMessage(null), undefined);
  });

  test('buildOverviewModel maps recent history and collections', () => {
    const model = buildOverviewModel(
      [sampleEntry('a'), sampleEntry('b')],
      sampleCollections(),
      { historyLimit: 1, collectionLimit: 2 },
    );
    assert.equal(model.history.length, 1);
    assert.equal(model.history[0]?.id, 'a');
    assert.equal(model.historyEmpty, false);
    assert.equal(model.collections.length, 2);
    assert.equal(model.collections[0]?.label, 'Newer');
    assert.equal(model.collections[0]?.requestCountLabel, '3 requests');
    assert.equal(model.collectionsEmpty, false);
    assert.equal(model.hasWorkspace, true);
  });

  test('buildOverviewModel handles empty workspace', () => {
    const model = buildOverviewModel([], undefined);
    assert.equal(model.historyEmpty, true);
    assert.equal(model.collectionsEmpty, true);
    assert.equal(model.hasWorkspace, false);
  });
});

function sampleEntry(id: string): HistoryEntry {
  return {
    id,
    schemaVersion: HISTORY_SCHEMA_VERSION,
    summary: {
      method: 'GET',
      url: 'https://example.test/users',
      statusCode: 200,
      statusText: 'OK',
      durationMs: 42,
      timestamp: '2026-07-21T12:00:00.000Z',
      status: HistoryExecutionStatus.Success,
    },
    metadata: {
      requestName: 'List users',
    },
  };
}

function sampleCollections(): WorkspaceCollections {
  return {
    workspaceRoots: [
      {
        id: 'ws1',
        path: '/ws',
        display: { label: 'ws' },
        collectionIds: ['c-new', 'c-old'],
      },
    ],
    collections: {
      'c-old': {
        id: 'c-old',
        rootPath: '/ws/Collections/Older',
        workspaceRootPath: '/ws',
        kind: 'native',
        metadata: {
          name: 'Older',
          workspacePath: '/ws/Collections/Older',
          requestCount: 1,
          folderCount: 0,
          lastModified: 100,
        },
        display: { label: 'Older' },
        rootFolderIds: [],
        rootRequestIds: [],
        folders: {},
        requests: {},
      },
      'c-new': {
        id: 'c-new',
        rootPath: '/ws/Collections/Newer',
        workspaceRootPath: '/ws',
        kind: 'native',
        metadata: {
          name: 'Newer',
          workspacePath: '/ws/Collections/Newer',
          requestCount: 3,
          folderCount: 1,
          lastModified: 200,
          description: 'Primary API',
        },
        display: { label: 'Newer' },
        rootFolderIds: [],
        rootRequestIds: [],
        folders: {},
        requests: {},
      },
    },
    discoveredAt: 1,
    issues: [],
  };
}
