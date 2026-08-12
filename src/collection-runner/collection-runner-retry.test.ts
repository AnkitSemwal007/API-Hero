import assert from 'node:assert/strict';
import test from 'node:test';

import {
  freezeWorkspaceCollections,
  type Collection,
  type RequestReference,
  type WorkspaceCollections,
} from '../collections';
import type {
  RunAtSourceLocationOptions,
  RunAtSourceLocationResult,
  RunRequestSource,
  SideEffectCommitContext,
} from '../orchestration';
import type { TestReport } from '../assertions';
import { InMemoryRunVariableStore } from '../variables';
import {
  CollectionRunnerService,
  CollectionRunModes,
  DESTRUCTIVE_REQUEST_SKIP_REASON,
  FailurePolicyKinds,
  RequestRunOutcomeKinds,
  buildRunPlan,
  freezeRunPlan,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
  type RunProgressEvent,
  type RunPlan,
} from './index';

function request(
  id: string,
  collectionId: string,
  filePath: string,
  index: number,
  method = 'GET',
): RequestReference {
  return {
    id,
    collectionId,
    folderId: undefined,
    filePath,
    requestIndex: index,
    method,
    url: `https://example.test/${index}`,
    display: { label: id },
    range: {
      start: { offset: index * 10, line: index, column: 0 },
      end: { offset: index * 10 + 5, line: index, column: 5 },
    },
  };
}

function aggregateWith(
  requests: Record<string, RequestReference>,
): WorkspaceCollections {
  const collectionId = 'collection:ws';
  const collection: Collection = {
    id: collectionId,
    rootPath: 'file:///ws',
    workspaceRootPath: 'file:///ws',
    kind: 'legacy',
    metadata: {
      name: 'ws',
      workspacePath: 'file:///ws',
      requestCount: Object.keys(requests).length,
      folderCount: 0,
    },
    display: { label: 'ws' },
    rootFolderIds: [],
    rootRequestIds: Object.keys(requests),
    folders: {},
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
  public async readText(filePath: string): Promise<string> {
    return `GET ${filePath}\n`;
  }
}

class SequencedExecutor implements CollectionRequestExecutorPort {
  public readonly calls: RunRequestSource[] = [];
  public readonly options: RunAtSourceLocationOptions[] = [];
  public readonly sideEffectDecisions: boolean[] = [];
  public outcomes: RunAtSourceLocationResult[] = [];
  public onSuccessWrite?: (store: InMemoryRunVariableStore) => void;
  private index = 0;
  private store: InMemoryRunVariableStore | undefined;

  public bindStore(store: InMemoryRunVariableStore): void {
    this.store = store;
  }

  public async runAtSourceLocation(
    source: RunRequestSource,
    options?: RunAtSourceLocationOptions,
  ): Promise<RunAtSourceLocationResult> {
    this.calls.push(source);
    this.options.push(options ?? {});
    if (options?.signal?.aborted) {
      return { outcome: 'cancelled', durationMs: 1 };
    }
    const next =
      this.outcomes[this.index] ?? {
        outcome: 'success',
        durationMs: 10,
        statusCode: 200,
      };
    this.index += 1;

    const commit = resolveCommitSideEffects(options, next);
    this.sideEffectDecisions.push(commit);

    if (next.outcome === 'success' && commit && this.store !== undefined) {
      this.onSuccessWrite?.(this.store);
    }
    return next;
  }
}

function resolveCommitSideEffects(
  options: RunAtSourceLocationOptions | undefined,
  result: RunAtSourceLocationResult,
): boolean {
  const ctx: SideEffectCommitContext = {
    ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
    httpSuccess: result.outcome === 'success',
    assertionsEvaluated: result.assertions !== undefined,
    assertionFailed: result.assertionFailed === true,
    cancelledAtTransport: result.outcome === 'cancelled',
    ...(result.outcome === 'failed' && result.statusCode === undefined
      ? { transportRetryable: true }
      : {}),
  };
  const callbackAllows = options?.shouldCommitSideEffects?.(ctx) ?? true;
  return (
    callbackAllows &&
    options?.commitHistory !== false &&
    options?.runPostExecution !== false
  );
}

/** Orchestrator-shaped completed HTTP response (outcome success). */
function httpSuccess(
  statusCode: number,
  extras?: Partial<RunAtSourceLocationResult>,
): RunAtSourceLocationResult {
  return {
    outcome: 'success',
    durationMs: 5,
    statusCode,
    ...extras,
  };
}

function assertionsPassReport(statusCode: number): TestReport {
  return {
    suite: { assertions: [] },
    results: [],
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      malformed: 0,
      durationMs: 0,
      passPercent: 100,
    },
    context: {
      requestId: 'r1',
      success: true,
      statusCode,
      headers: [],
      responseTimeMs: 5,
    },
  };
}

function assertionsFailReport(statusCode: number): TestReport {
  return {
    suite: { assertions: [] },
    results: [],
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      malformed: 0,
      durationMs: 0,
      passPercent: 0,
    },
    context: {
      requestId: 'r1',
      success: true,
      statusCode,
      headers: [],
      responseTimeMs: 5,
    },
  };
}

function httpSuccessWithAssertionsPass(
  statusCode: number,
): RunAtSourceLocationResult {
  return {
    outcome: 'success',
    durationMs: 5,
    statusCode,
    assertionFailed: false,
    assertions: assertionsPassReport(statusCode),
  };
}

function httpFailedWithAssertions(
  statusCode: number,
): RunAtSourceLocationResult {
  return {
    outcome: 'failed',
    durationMs: 5,
    statusCode,
    assertionFailed: true,
    assertions: assertionsFailReport(statusCode),
  };
}

/** Transport / network failure (no completed HTTP status). */
function transportFailed(): RunAtSourceLocationResult {
  return {
    outcome: 'failed',
    durationMs: 5,
  };
}

async function runPlan(
  plan: RunPlan,
  executor: SequencedExecutor,
  extras?: {
    readonly signal?: AbortSignal;
    readonly store?: InMemoryRunVariableStore;
    readonly progress?: RunProgressEvent[];
    readonly delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
) {
  const delays: number[] = [];
  const runner = new CollectionRunnerService({
    executor,
    sourceReader: new FakeSourceReader(),
    ...(extras?.progress === undefined
      ? {}
      : {
          progress: {
            onProgress: (event) => {
              extras.progress!.push(event);
            },
          },
        }),
    delay: extras?.delay ?? (async (ms) => {
      delays.push(ms);
    }),
  });
  if (extras?.store !== undefined) {
    executor.bindStore(extras.store);
  }
  const summary = await runner.execute({
    plan,
    ...(extras?.signal === undefined ? {} : { signal: extras.signal }),
    ...(extras?.store === undefined
      ? {}
      : { runVariableStore: extras.store }),
  });
  return { summary, delays };
}

test('retry recovers success+503 → success+503 → success+200 and records attempts', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: {
      retry: { enabled: true, maxRetries: 2, delayMs: 10, backoff: 'fixed' },
    },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [
    httpSuccess(503),
    httpSuccess(503),
    httpSuccess(200),
  ];
  const { summary, delays } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 3);
  assert.deepEqual(delays, [10, 10]);
  assert.equal(summary.results.length, 1);
  const result = summary.results[0]!;
  assert.equal(result.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(result.attempts?.length, 3);
  assert.equal(result.attempts?.[0]?.statusCode, 503);
  assert.equal(result.attempts?.[0]?.outcome, RequestRunOutcomeKinds.Failed);
  assert.equal(result.attempts?.[0]?.retryable, true);
  assert.equal(result.attempts?.[2]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(summary.status, 'completed');
  assert.deepEqual(executor.sideEffectDecisions, [false, false, true]);
});

test('retry exhausts on persistent success+503; final outcome remains Passed', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: {
      retry: {
        enabled: true,
        maxRetries: 2,
        delayMs: 5,
        backoff: 'exponential',
      },
    },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [
    httpSuccess(503),
    httpSuccess(503),
    httpSuccess(503),
  ];
  const { summary, delays } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 3);
  assert.deepEqual(delays, [5, 10]);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(summary.results[0]?.statusCode, 503);
  assert.equal(summary.results[0]?.attempts?.length, 3);
  assert.equal(
    summary.results[0]?.attempts?.[2]?.outcome,
    RequestRunOutcomeKinds.Passed,
  );
  assert.deepEqual(executor.sideEffectDecisions, [false, false, true]);
});

test('does not retry 400 / 401 / 403 / 404 / 422 / assertion failure on non-retryable status', async () => {
  for (const outcome of [
    httpSuccess(400),
    httpSuccess(403),
    httpSuccess(404),
    httpSuccess(422),
    httpFailedWithAssertions(401),
    httpFailedWithAssertions(200),
  ]) {
    const aggregate = aggregateWith({
      r1: request('r1', 'collection:ws', 'file:///a.api', 0),
    });
    const plan = buildRunPlan({
      aggregate,
      target: {
        mode: CollectionRunModes.Collection,
        collectionId: 'collection:ws',
      },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
      runOptions: {
        retry: { enabled: true, maxRetries: 3, delayMs: 1, backoff: 'fixed' },
      },
    });
    const executor = new SequencedExecutor();
    executor.outcomes = [outcome];
    const { summary, delays } = await runPlan(plan, executor);
    assert.equal(executor.calls.length, 1);
    assert.deepEqual(delays, []);
    assert.equal(summary.results[0]?.attempts?.length, 1);
    assert.equal(executor.sideEffectDecisions[0], true);
  }
});

test('does not retry success+503 when assertions all passed', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: {
      retry: { enabled: true, maxRetries: 2, delayMs: 1, backoff: 'fixed' },
    },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [httpSuccessWithAssertionsPass(503)];
  const { summary, delays } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(delays, []);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(summary.results[0]?.statusCode, 503);
  assert.equal(executor.sideEffectDecisions[0], true);
});

test('retries assertion failure on retryable status 503', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: {
      retry: { enabled: true, maxRetries: 1, delayMs: 0, backoff: 'fixed' },
    },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [
    httpFailedWithAssertions(503),
    httpSuccess(200),
  ];
  const { summary } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 2);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.deepEqual(executor.sideEffectDecisions, [false, true]);
});

test('retries network / success+408 / 429 / 502 / 504', async () => {
  for (const first of [
    transportFailed(),
    httpSuccess(408),
    httpSuccess(429),
    httpSuccess(502),
    httpSuccess(504),
  ]) {
    const aggregate = aggregateWith({
      r1: request('r1', 'collection:ws', 'file:///a.api', 0),
    });
    const plan = buildRunPlan({
      aggregate,
      target: {
        mode: CollectionRunModes.Collection,
        collectionId: 'collection:ws',
      },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
      runOptions: {
        retry: { enabled: true, maxRetries: 1, delayMs: 0, backoff: 'fixed' },
      },
    });
    const executor = new SequencedExecutor();
    executor.outcomes = [first, httpSuccess(200)];
    const { summary } = await runPlan(plan, executor);
    assert.equal(executor.calls.length, 2);
    assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  }
});

test('cancel during retry delay marks cancelled and stops', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
    r2: request('r2', 'collection:ws', 'file:///b.api', 1),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: {
      retry: { enabled: true, maxRetries: 2, delayMs: 50, backoff: 'fixed' },
    },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [httpSuccess(503)];
  const controller = new AbortController();
  const progress: RunProgressEvent[] = [];
  const { summary } = await runPlan(plan, executor, {
    signal: controller.signal,
    progress,
    delay: async (_ms, signal) => {
      controller.abort();
      if (signal?.aborted) {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }
    },
  });
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Cancelled);
  assert.equal(summary.results[1]?.outcome, RequestRunOutcomeKinds.Cancelled);
  assert.equal(summary.status, 'cancelled');
  assert.ok(progress.some((event) => event.attempt?.phase === 'waiting'));
});

test('intermediate attempts skip side effects; final success writes variables once', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: {
      retry: { enabled: true, maxRetries: 2, delayMs: 0, backoff: 'fixed' },
    },
  });
  const store = new InMemoryRunVariableStore();
  const executor = new SequencedExecutor();
  let writes = 0;
  executor.onSuccessWrite = (runStore) => {
    writes += 1;
    runStore.set('token', 'abc');
  };
  executor.outcomes = [
    httpSuccess(503),
    httpSuccess(503),
    httpSuccess(200),
  ];
  const { summary } = await runPlan(plan, executor, { store });
  assert.equal(writes, 1);
  assert.equal(store.get('token')?.value, 'abc');
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.ok(executor.options.every((opts) => opts.shouldCommitSideEffects !== undefined));
});

test('DELETE skipped when skipDestructiveRequests enabled', async () => {
  const aggregate = aggregateWith({
    del: request('del', 'collection:ws', 'file:///d.api', 0, 'DELETE'),
    get: request('get', 'collection:ws', 'file:///g.api', 1, 'GET'),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
    runOptions: { skipDestructiveRequests: true },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [{ outcome: 'success', durationMs: 1, statusCode: 200 }];
  const { summary } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 1);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Skipped);
  assert.equal(summary.results[0]?.skipReason, DESTRUCTIVE_REQUEST_SKIP_REASON);
  assert.equal(summary.results[0]?.attempts, undefined);
  assert.equal(summary.results[1]?.outcome, RequestRunOutcomeKinds.Passed);
});

test('DELETE executes when skipDestructiveRequests disabled', async () => {
  const aggregate = aggregateWith({
    del: request('del', 'collection:ws', 'file:///d.api', 0, 'DELETE'),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.ContinueOnError,
  });
  assert.equal(plan.runOptions, undefined);
  const executor = new SequencedExecutor();
  executor.outcomes = [{ outcome: 'success', durationMs: 1, statusCode: 204 }];
  const { summary } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 1);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
});

test('omitted runOptions keeps single-attempt behavior', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
  });
  const plan = freezeRunPlan({
    ...buildRunPlan({
      aggregate,
      target: {
        mode: CollectionRunModes.Collection,
        collectionId: 'collection:ws',
      },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
    }),
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [httpSuccess(503)];
  const { summary, delays } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(delays, []);
  assert.equal(summary.results[0]?.attempts?.length, 1);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(executor.options[0]?.shouldCommitSideEffects, undefined);
});

test('stop-on-first-error applies after exhausted success+503 retries', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
    r2: request('r2', 'collection:ws', 'file:///b.api', 1),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.StopOnFirstError,
    runOptions: {
      retry: { enabled: true, maxRetries: 1, delayMs: 0, backoff: 'fixed' },
    },
  });
  const executor = new SequencedExecutor();
  // Exhausted 503 with no failing assertions → Passed final semantics, so
  // stop-on-first-error must NOT stop the run.
  executor.outcomes = [httpSuccess(503), httpSuccess(503), httpSuccess(200)];
  const { summary } = await runPlan(plan, executor);
  assert.equal(executor.calls.length, 3);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(summary.results[0]?.attempts?.length, 2);
  assert.equal(summary.results[1]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(summary.status, 'completed');
});

test('stop-on-first-error applies to final transport failure after retries', async () => {
  const aggregate = aggregateWith({
    r1: request('r1', 'collection:ws', 'file:///a.api', 0),
    r2: request('r2', 'collection:ws', 'file:///b.api', 1),
  });
  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId: 'collection:ws' },
    failurePolicy: FailurePolicyKinds.StopOnFirstError,
    runOptions: {
      retry: { enabled: true, maxRetries: 1, delayMs: 0, backoff: 'fixed' },
    },
  });
  const executor = new SequencedExecutor();
  executor.outcomes = [transportFailed(), transportFailed()];
  const { summary } = await runPlan(plan, executor);
  assert.equal(summary.status, 'stopped');
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Failed);
  assert.equal(summary.results[0]?.attempts?.length, 2);
  assert.equal(summary.results[1]?.outcome, RequestRunOutcomeKinds.Skipped);
});
