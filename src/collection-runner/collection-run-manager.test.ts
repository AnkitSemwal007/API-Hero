import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CollectionRunAlreadyActiveError,
  CollectionRunManager,
} from './collection-run-manager';
import {
  CollectionRunMode,
  CollectionRunStatus,
  FailurePolicyKind,
  RequestRunOutcomeKind,
  type RunPlan,
  type RunProgressEvent,
  type RunSummary,
} from './models';
import { RunSessionStatus } from './run-session-models';

function samplePlan(overrides?: Partial<RunPlan>): RunPlan {
  return {
    runId: 'run_test_1',
    mode: CollectionRunMode.Collection,
    collectionId: 'collection:demo',
    collectionName: 'Demo',
    failurePolicy: FailurePolicyKind.ContinueOnError,
    createdAt: '2026-07-28T10:00:00.000Z',
    requests: [
      {
        requestId: 'request:a',
        collectionId: 'collection:demo',
        filePath: '/a.api',
        offset: 0,
        label: 'A',
        method: 'GET',
        url: 'https://example.test/a',
        ordinal: 0,
      },
      {
        requestId: 'request:b',
        collectionId: 'collection:demo',
        filePath: '/b.api',
        offset: 0,
        label: 'B',
        method: 'GET',
        url: 'https://example.test/b',
        ordinal: 1,
      },
    ],
    ...overrides,
  };
}

function progress(
  overrides: Partial<RunProgressEvent> &
    Pick<RunProgressEvent, 'runId' | 'phase'>,
): RunProgressEvent {
  return {
    completed: 0,
    remaining: 2,
    total: 2,
    elapsedMs: 10,
    ...overrides,
  };
}

function summaryFor(
  plan: RunPlan,
  status: (typeof CollectionRunStatus)[keyof typeof CollectionRunStatus] = CollectionRunStatus.Completed,
): RunSummary {
  return {
    runId: plan.runId,
    plan,
    results: [
      {
        requestId: 'request:a',
        ordinal: 0,
        label: 'A',
        outcome: RequestRunOutcomeKind.Passed,
        durationMs: 5,
        statusCode: 200,
      },
      {
        requestId: 'request:b',
        ordinal: 1,
        label: 'B',
        outcome: RequestRunOutcomeKind.Passed,
        durationMs: 5,
        statusCode: 200,
      },
    ],
    statistics: {
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      durationMs: 20,
      averageResponseTimeMs: 5,
      assertionsPassed: 0,
      assertionsFailed: 0,
      assertionsTotal: 0,
      preconditionFailures: 0,
      transportFailures: 0,
      assertionFailures: 0,
      extractionFailures: 0,
    },
    completedAt: '2026-07-28T10:00:20.000Z',
    status,
  };
}

describe('CollectionRunManager', () => {
  test('rejects a second begin with a different runId while first remains active', () => {
    const manager = new CollectionRunManager();
    const first = manager.begin({ plan: samplePlan({ runId: 'run_a' }) });
    assert.equal(manager.activeCount, 1);

    assert.throws(
      () => manager.begin({ plan: samplePlan({ runId: 'run_b' }) }),
      (error: unknown) =>
        error instanceof CollectionRunAlreadyActiveError &&
        error.activeRunId === 'run_a',
    );
    assert.equal(manager.activeCount, 1);
    assert.equal(manager.listActive()[0]?.runId, 'run_a');

    manager.onProgress(
      progress({
        runId: 'run_a',
        phase: 'request-started',
        current: first.snapshot.plan.requests[0],
        completed: 0,
        remaining: 2,
        elapsedMs: 5,
      }),
    );
    assert.equal(manager.get('run_a')?.elapsedMs, 5);

    manager.complete(summaryFor(samplePlan({ runId: 'run_a' })));
    assert.equal(manager.activeCount, 0);
    assert.equal(manager.listRecent()[0]?.runId, 'run_a');
  });

  test('cancellation still works on the single active run after a rejected second begin', () => {
    const manager = new CollectionRunManager();
    const started = manager.begin({ plan: samplePlan({ runId: 'run_a' }) });
    assert.throws(() =>
      manager.begin({ plan: samplePlan({ runId: 'run_b' }) }),
    );
    assert.equal(manager.cancel('run_a'), true);
    assert.equal(started.signal.aborted, true);
    assert.equal(manager.listActive().length, 1);
  });

  test('onProgress updates the active snapshot and accumulates lastResult', () => {
    const manager = new CollectionRunManager();
    const plan = samplePlan();
    manager.begin({ plan });
    let changes = 0;
    const subscription = manager.onDidChange(() => {
      changes += 1;
    });
    manager.onProgress(
      progress({
        runId: plan.runId,
        phase: 'request-started',
        current: plan.requests[0],
        completed: 0,
        remaining: 2,
        elapsedMs: 5,
      }),
    );
    manager.onProgress(
      progress({
        runId: plan.runId,
        phase: 'request-finished',
        current: plan.requests[0],
        completed: 1,
        remaining: 1,
        elapsedMs: 12,
        lastResult: {
          requestId: 'request:a',
          ordinal: 0,
          label: 'A',
          outcome: RequestRunOutcomeKind.Passed,
          statusCode: 200,
        },
      }),
    );
    const snapshot = manager.get(plan.runId);
    assert.equal(snapshot?.completed, 1);
    assert.equal(snapshot?.results.length, 1);
    assert.ok(changes >= 2);
    subscription.dispose();
  });

  test('complete moves the session into recent (newest first)', () => {
    const manager = new CollectionRunManager();
    const plan = samplePlan();
    manager.begin({ plan });
    manager.complete(summaryFor(plan));
    assert.equal(manager.listActive().length, 0);
    assert.equal(manager.listRecent().length, 1);
    assert.equal(manager.listRecent()[0]?.status, RunSessionStatus.Completed);
  });

  test('cancel aborts the controller without terminalizing', () => {
    const manager = new CollectionRunManager();
    const plan = samplePlan();
    const started = manager.begin({ plan });
    assert.equal(manager.cancel(plan.runId), true);
    assert.equal(started.signal.aborted, true);
    assert.equal(manager.listActive().length, 1);
  });

  test('recent ring keeps the latest 20 and drops older', () => {
    const manager = new CollectionRunManager({ recentLimit: 20 });
    for (let index = 0; index < 25; index += 1) {
      const plan = samplePlan({
        runId: `run_${index}`,
        collectionName: `C${index}`,
      });
      manager.begin({ plan });
      manager.complete(summaryFor(plan));
    }
    const recent = manager.listRecent();
    assert.equal(recent.length, 20);
    assert.equal(recent[0]?.runId, 'run_24');
    assert.equal(recent[19]?.runId, 'run_5');
  });

  test('fail terminalizes without a summary', () => {
    const manager = new CollectionRunManager();
    const plan = samplePlan();
    manager.begin({ plan });
    assert.equal(manager.fail(plan.runId, 'boom'), true);
    assert.equal(manager.listRecent()[0]?.status, RunSessionStatus.Failed);
    assert.equal(manager.listRecent()[0]?.errorMessage, 'boom');
  });
});
