import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatLastRunDetail,
  readScenarioLastRuns,
} from './scenario-last-runs';

describe('scenarios/vscode/scenario-last-runs', () => {
  test('readScenarioLastRuns returns empty for non-objects', () => {
    assert.deepEqual(readScenarioLastRuns(undefined), {});
    assert.deepEqual(readScenarioLastRuns(null), {});
    assert.deepEqual(readScenarioLastRuns([]), {});
    assert.deepEqual(readScenarioLastRuns('x'), {});
  });

  test('readScenarioLastRuns keeps valid records and drops invalid/in-flight ones', () => {
    const map = readScenarioLastRuns({
      a: { status: 'completed', at: '2026-07-30T10:00:00.000Z' },
      b: { status: 'nope', at: '2026-07-30T10:00:00.000Z' },
      c: { status: 'failed', at: '' },
      d: { status: 'running', at: '2026-07-30T11:00:00.000Z' },
      e: null,
    });
    assert.deepEqual(map, {
      a: { status: 'completed', at: '2026-07-30T10:00:00.000Z' },
    });
  });

  test('formatLastRunDetail renders status and relative time', () => {
    assert.equal(formatLastRunDetail(undefined), undefined);
    const now = Date.parse('2026-07-30T12:00:00.000Z');
    assert.equal(
      formatLastRunDetail(
        { status: 'completed', at: '2026-07-30T11:59:30.000Z' },
        now,
      ),
      'Last run: Completed · 30s ago',
    );
    assert.equal(
      formatLastRunDetail(
        { status: 'failed', at: '2026-07-30T11:00:00.000Z' },
        now,
      ),
      'Last run: Failed · 1h ago',
    );
  });
});
