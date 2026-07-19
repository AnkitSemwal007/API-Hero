import assert from 'node:assert/strict';
import test from 'node:test';

import {
  freezeWorkspaceCollections,
  type Collection,
  type Folder,
  type RequestReference,
  type WorkspaceCollections,
} from '../collections';
import type {
  RunAtSourceLocationOptions,
  RunAtSourceLocationResult,
  RunRequestSource,
} from '../orchestration';
import {
  CollectionRunnerService,
  CollectionRunModes,
  FailurePolicyKinds,
  RequestRunOutcomeKinds,
  buildRunPlan,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
  type RunProgressEvent,
} from './index';

function request(
  id: string,
  collectionId: string,
  filePath: string,
  index: number,
  folderId?: string,
): RequestReference {
  return {
    id,
    collectionId,
    folderId,
    filePath,
    requestIndex: index,
    method: 'GET',
    url: `https://example.test/${index}`,
    display: { label: `req-${index}` },
    range: {
      start: { offset: index * 10, line: index, column: 0 },
      end: { offset: index * 10 + 5, line: index, column: 5 },
    },
  };
}

function sampleAggregate(): WorkspaceCollections {
  const collectionId = 'collection:ws';
  const folderA = 'folder:collection:ws:a';
  const folderB = 'folder:collection:ws:a/b';
  const requests: Record<string, RequestReference> = {
    r1: request('r1', collectionId, 'file:///a/one.api', 0, folderA),
    r2: request('r2', collectionId, 'file:///a/b/two.api', 0, folderB),
    r3: request('r3', collectionId, 'file:///a/b/two.api', 1, folderB),
    r4: request('r4', collectionId, 'file:///root.api', 0),
  };
  const collection: Collection = {
    id: collectionId,
    rootPath: 'file:///ws',
    workspaceRootPath: 'file:///ws',
    metadata: {
      name: 'ws',
      workspacePath: 'file:///ws',
      requestCount: 4,
      folderCount: 2,
    },
    display: { label: 'ws' },
    rootFolderIds: [folderA],
    rootRequestIds: ['r4'],
    folders: {
      [folderA]: {
        id: folderA,
        collectionId,
        parentId: undefined,
        relativePath: 'a',
        display: { label: 'a' },
        folderIds: [folderB],
        requestIds: ['r1'],
      },
      [folderB]: {
        id: folderB,
        collectionId,
        parentId: folderA,
        relativePath: 'a/b',
        display: { label: 'b' },
        folderIds: [],
        requestIds: ['r2', 'r3'],
      },
    },
    requests,
  };
  return freezeWorkspaceCollections({
    workspaceRoots: [
      {
        id: 'workspace:ws',
        path: 'file:///ws',
        display: { label: 'ws' },
        collectionIds: [collectionId],
      },
    ],
    collections: { [collectionId]: collection },
    discoveredAt: 1,
    issues: [],
  });
}

class FakeSourceReader implements CollectionRunSourceReader {
  public readonly reads: string[] = [];
  public failPaths = new Set<string>();

  public async readText(filePath: string): Promise<string> {
    this.reads.push(filePath);
    if (this.failPaths.has(filePath)) {
      throw new Error('unreadable');
    }
    return `GET https://example.test\n`;
  }
}

class FakeExecutor implements CollectionRequestExecutorPort {
  public readonly calls: RunRequestSource[] = [];
  public readonly options: RunAtSourceLocationOptions[] = [];
  public outcomes: RunAtSourceLocationResult[] = [];
  public hangUntil: AbortSignal | undefined;
  private index = 0;

  public async runAtSourceLocation(
    source: RunRequestSource,
    options?: RunAtSourceLocationOptions,
  ): Promise<RunAtSourceLocationResult> {
    this.calls.push(source);
    this.options.push(options ?? {});
    if (this.hangUntil !== undefined) {
      await new Promise<void>((resolve) => {
        if (this.hangUntil!.aborted) {
          resolve();
          return;
        }
        this.hangUntil!.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
      return { outcome: 'cancelled', durationMs: 5 };
    }
    const next = this.outcomes[this.index] ?? { outcome: 'success', durationMs: 10, statusCode: 200 };
    this.index += 1;
    if (options?.signal?.aborted) {
      return { outcome: 'cancelled', durationMs: 1 };
    }
    return next;
  }
}

test('buildRunPlan orders collection DFS: nested folders then root requests', () => {
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runId: 'run_test',
    now: () => 1_000,
  });

  // Tree DFS: folder a → nested b (r2, r3) → a’s requests (r1) → root (r4).
  assert.deepEqual(
    plan.requests.map((item) => item.requestId),
    ['r2', 'r3', 'r1', 'r4'],
  );
  assert.equal(plan.mode, CollectionRunModes.Collection);
  assert.equal(plan.collectionName, 'ws');
  assert.equal(plan.requests[2]?.offset, 0);
  assert.equal(plan.requests[0]?.offset, 0);
  assert.equal(plan.requests[1]?.offset, 10);
});

test('buildRunPlan folder mode includes nested folder requests only', () => {
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.Folder,
      collectionId: 'collection:ws',
      folderId: 'folder:collection:ws:a',
    },
    failurePolicy: FailurePolicyKinds.StopOnFirstError,
  });
  assert.deepEqual(
    plan.requests.map((item) => item.requestId),
    ['r2', 'r3', 'r1'],
  );
  assert.equal(plan.folderId, 'folder:collection:ws:a');
});

test('buildRunPlan selected mode preserves caller order and drops unknown ids', () => {
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r3', 'missing', 'r1'],
    },
    failurePolicy: FailurePolicyKinds.SkipInvalidRequests,
  });
  assert.deepEqual(
    plan.requests.map((item) => item.requestId),
    ['r3', 'r1'],
  );
});

test('large plan ordering stays stable across many nested folders', () => {
  const collectionId = 'collection:big';
  const folders: Record<string, Folder> = {};
  const requests: Record<string, RequestReference> = {};
  const rootFolderIds: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    const folderId = `folder:${collectionId}:f${i}`;
    rootFolderIds.push(folderId);
    const requestId = `r${i}`;
    requests[requestId] = request(
      requestId,
      collectionId,
      `file:///f${i}.api`,
      0,
      folderId,
    );
    folders[folderId] = {
      id: folderId,
      collectionId,
      parentId: undefined,
      relativePath: `f${i}`,
      display: { label: `f${i}` },
      folderIds: [],
      requestIds: [requestId],
    };
  }
  const aggregate = freezeWorkspaceCollections({
    workspaceRoots: [],
    collections: {
      [collectionId]: {
        id: collectionId,
        rootPath: 'file:///big',
        workspaceRootPath: 'file:///big',
        metadata: {
          name: 'big',
          workspacePath: 'file:///big',
          requestCount: 20,
          folderCount: 20,
        },
        display: { label: 'big' },
        rootFolderIds,
        rootRequestIds: [],
        folders,
        requests,
      },
    },
    discoveredAt: 1,
    issues: [],
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });
  assert.equal(plan.requests.length, 20);
  assert.deepEqual(
    plan.requests.map((item) => item.requestId),
    Array.from({ length: 20 }, (_, i) => `r${i}`),
  );
});

test('executes sequentially and suppresses viewer via orchestrator options', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    { outcome: 'success', durationMs: 11, statusCode: 200 },
    { outcome: 'success', durationMs: 22, statusCode: 201 },
  ];
  const reader = new FakeSourceReader();
  const events: RunProgressEvent[] = [];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: reader,
    progress: { onProgress: (event) => events.push(event) },
    now: (() => {
      let t = 0;
      return () => {
        t += 5;
        return t;
      };
    })(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r4'],
    },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runId: 'run_seq',
  });

  const summary = await runner.execute({ plan });

  assert.equal(executor.calls.length, 2);
  assert.equal(executor.calls[0]?.offset, 0);
  assert.equal(executor.calls[1]?.offset, 0);
  assert.equal(executor.options[0]?.showViewer, false);
  assert.equal(executor.options[0]?.useProgressUi, false);
  assert.equal(executor.options[0]?.showNotifications, false);
  assert.equal(summary.statistics.passed, 2);
  assert.equal(summary.statistics.failed, 0);
  assert.ok(events.some((event) => event.phase === 'started'));
  assert.ok(events.some((event) => event.phase === 'request-started'));
  assert.ok(events.some((event) => event.phase === 'request-finished'));
  assert.ok(events.some((event) => event.phase === 'completed'));
  assert.equal(summary.statistics.averageResponseTimeMs, 17);
});

test('stop-on-first-error skips remaining requests', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    { outcome: 'success', durationMs: 5, statusCode: 200 },
    { outcome: 'failed', durationMs: 5 },
    { outcome: 'success', durationMs: 5, statusCode: 200 },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r2', 'r3'],
    },
    failurePolicy: FailurePolicyKinds.StopOnFirstError,
  });

  const summary = await runner.execute({ plan });

  assert.equal(executor.calls.length, 2);
  assert.equal(summary.status, 'stopped');
  assert.equal(summary.statistics.passed, 1);
  assert.equal(summary.statistics.failed, 1);
  assert.equal(summary.statistics.skipped, 1);
  assert.equal(summary.results[2]?.outcome, RequestRunOutcomeKinds.Skipped);
});

test('continue-on-error runs every request', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    { outcome: 'failed', durationMs: 3 },
    { outcome: 'success', durationMs: 4, statusCode: 200 },
    { outcome: 'precondition-failed' },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r2', 'r3'],
    },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });

  const summary = await runner.execute({ plan });

  assert.equal(executor.calls.length, 3);
  assert.equal(summary.status, 'completed');
  assert.equal(summary.statistics.passed, 1);
  assert.equal(summary.statistics.failed, 2);
  assert.equal(summary.statistics.skipped, 0);
});

test('skip-invalid-requests marks precondition failures as skipped', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    { outcome: 'precondition-failed' },
    { outcome: 'success', durationMs: 8, statusCode: 204 },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r4'],
    },
    failurePolicy: FailurePolicyKinds.SkipInvalidRequests,
  });

  const summary = await runner.execute({ plan });

  assert.equal(executor.calls.length, 2);
  assert.equal(summary.statistics.skipped, 1);
  assert.equal(summary.statistics.passed, 1);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Skipped);
});

test('skip-invalid-requests skips unreadable sources without calling orchestrator', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [{ outcome: 'success', durationMs: 8, statusCode: 204 }];
  const reader = new FakeSourceReader();
  reader.failPaths.add('file:///a/one.api');
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: reader,
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r4'],
    },
    failurePolicy: FailurePolicyKinds.SkipInvalidRequests,
  });

  const summary = await runner.execute({ plan });

  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.sourceId, 'file:///root.api');
  assert.equal(summary.statistics.skipped, 1);
  assert.equal(summary.statistics.passed, 1);
});

test('cancellation aborts in-flight work and marks remaining cancelled', async () => {
  const controller = new AbortController();
  const executor = new FakeExecutor();
  executor.hangUntil = controller.signal;
  const events: RunProgressEvent[] = [];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
    progress: { onProgress: (event) => events.push(event) },
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r2', 'r3'],
    },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });

  const pending = runner.execute({ plan, signal: controller.signal });
  // Allow the first request to start hanging, then cancel.
  await Promise.resolve();
  await Promise.resolve();
  controller.abort('cancelled');
  const summary = await pending;

  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.statistics.cancelled, 3);
  assert.deepEqual(
    summary.results.map((result) => result.outcome),
    [
      RequestRunOutcomeKinds.Cancelled,
      RequestRunOutcomeKinds.Cancelled,
      RequestRunOutcomeKinds.Cancelled,
    ],
  );
  assert.ok(events.some((event) => event.phase === 'completed'));
});

test('forwards merged historyCaptureContext to the orchestrator port', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    { outcome: 'success', durationMs: 4, statusCode: 200 },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r4'],
    },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });

  await runner.execute({
    plan,
    historyCaptureContext: {
      environmentName: 'Dev',
      collectionName: plan.collectionName,
    },
  });

  assert.deepEqual(executor.options[0]?.historyCaptureContext, {
    environmentName: 'Dev',
    collectionName: 'ws',
  });
});

test('summary statistics cover totals and average timing', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    { outcome: 'success', durationMs: 10, statusCode: 200 },
    { outcome: 'failed', durationMs: 30 },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
    now: (() => {
      let t = 100;
      return () => {
        const value = t;
        t += 50;
        return value;
      };
    })(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r2'],
    },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });

  const summary = await runner.execute({ plan });
  assert.equal(summary.statistics.total, 2);
  assert.equal(summary.statistics.passed, 1);
  assert.equal(summary.statistics.failed, 1);
  assert.equal(summary.statistics.averageResponseTimeMs, 20);
  assert.ok(summary.statistics.durationMs > 0);
});

test('treats assertion failures as failures and stops on first error', async () => {
  const executor = new FakeExecutor();
  // Production shape: HTTP succeeded but asserts failed → outcome 'failed'.
  executor.outcomes = [
    {
      outcome: 'failed',
      durationMs: 12,
      statusCode: 200,
      assertionFailed: true,
      assertions: {
        suite: { assertions: [] },
        results: [],
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          malformed: 0,
          durationMs: 1,
          passPercent: 50,
        },
        context: {
          requestId: 'r1',
          success: true,
          statusCode: 200,
          headers: [],
          responseTimeMs: 12,
        },
      },
    },
    { outcome: 'success', durationMs: 8, statusCode: 200 },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1', 'r2'],
    },
    failurePolicy: FailurePolicyKinds.StopOnFirstError,
  });

  const summary = await runner.execute({ plan });

  assert.equal(executor.calls.length, 1);
  assert.equal(summary.status, 'stopped');
  assert.equal(summary.statistics.passed, 0);
  assert.equal(summary.statistics.failed, 1);
  assert.equal(summary.statistics.skipped, 1);
  assert.equal(summary.statistics.assertionsTotal, 2);
  assert.equal(summary.statistics.assertionsPassed, 1);
  assert.equal(summary.statistics.assertionsFailed, 1);
  assert.equal(summary.results[0]?.message, 'Assertions failed.');
});

test('prefers transport failure message when HTTP did not succeed', async () => {
  const executor = new FakeExecutor();
  executor.outcomes = [
    {
      outcome: 'failed',
      durationMs: 9,
      assertionFailed: true,
      assertions: {
        suite: { assertions: [] },
        results: [],
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          malformed: 0,
          durationMs: 1,
          passPercent: 0,
        },
        context: {
          requestId: 'r1',
          success: false,
          headers: [],
          responseTimeMs: 9,
          errorCode: 'TIMEOUT',
        },
      },
    },
  ];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
  });
  const plan = buildRunPlan({
    aggregate: sampleAggregate(),
    target: {
      mode: CollectionRunModes.SelectedRequests,
      collectionId: 'collection:ws',
      requestIds: ['r1'],
    },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });

  const summary = await runner.execute({ plan });
  assert.equal(summary.results[0]?.message, 'Request failed.');
});
