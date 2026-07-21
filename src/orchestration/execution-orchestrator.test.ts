import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ExecutionResult,
  RequestExecutor,
} from '../execution';
import type { RuntimeRequest } from '../models';
import { freezeDetachedBytes } from '../shared';
import {
  AuthenticationProviderRegistry,
  DefaultAuthenticationResolver,
  NoneAuthenticationProvider,
  type AuthenticationResolutionContext,
  type AuthenticationResolver,
} from '../auth';
import {
  parseApiDocument,
  validateApiRequest,
} from '../parser';
import { buildSelectedRequest } from '../request';
import {
  ExecutionOrchestrator,
  type AssertionEvaluationObserver,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatus,
  type ExecutionStatusPresenter,
  type RequestExecutionPipeline,
} from './execution-orchestrator';
import { selectRequestAtOffset } from './request-selection';
import {
  DefaultHistoryRecorder,
  InMemoryHistoryRepository,
  type HistoryRecorder,
} from '../history';
import {
  DefaultVariableResolver,
  type VariableResolutionContext,
  type VariableResolver,
} from '../variables';

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

class FakeStatus implements ExecutionStatusPresenter {
  public readonly updates: ExecutionStatus[] = [];
  public disposed = false;
  public update(status: ExecutionStatus): void {
    this.updates.push(status);
  }
  public dispose(): void {
    this.disposed = true;
  }
}

class FakeViewer implements ExecutionResultViewer {
  public readonly results: ExecutionResult[] = [];
  public readonly assertionReports: (import('../assertions').TestReport | undefined)[] =
    [];
  public fail = false;
  public show(
    result: ExecutionResult,
    assertions?: import('../assertions').TestReport,
  ): void {
    if (this.fail) {
      throw new Error('viewer details must not escape');
    }
    this.results.push(result);
    this.assertionReports.push(assertions);
  }
}

class FakeNotifications implements ExecutionNotificationSink {
  public readonly messages: string[] = [];
  public error(message: string): void {
    this.messages.push(message);
  }
}

class FakeProgress implements ExecutionProgressRunner {
  public controller = new AbortController();
  public readonly messages: string[] = [];
  public run<T>(
    task: (
      signal: AbortSignal,
      reporter: { report(message: string): void },
    ) => Promise<T>,
  ): Promise<T> {
    return task(this.controller.signal, {
      report: (message) => this.messages.push(message),
    });
  }
}

function harness(
  executor: RequestExecutor,
  pipeline?: RequestExecutionPipeline,
  variableResolver?: VariableResolver,
  variableContext: VariableResolutionContext = { definitions: [] },
  authenticationResolver?: AuthenticationResolver,
  authenticationContext?: Omit<AuthenticationResolutionContext, 'variables'>,
  historyRecorder?: HistoryRecorder,
  assertionObserver?: AssertionEvaluationObserver,
) {
  const status = new FakeStatus();
  const viewer = new FakeViewer();
  const notifications = new FakeNotifications();
  const progress = new FakeProgress();
  const orchestrator = new ExecutionOrchestrator(
    executor,
    viewer,
    status,
    progress,
    notifications,
    () => ({}),
    pipeline,
    variableResolver,
    () => variableContext,
    authenticationResolver,
    authenticationContext === undefined
      ? undefined
      : () => authenticationContext,
    historyRecorder,
    () => ({ environmentName: 'TestEnv' }),
    assertionObserver,
  );
  return { orchestrator, status, viewer, notifications, progress };
}

function source(text: string, offset = 0) {
  return { text, offset, sourceId: 'test.api' };
}

function success(request: RuntimeRequest, statusCode = 200): ExecutionResult {
  return {
    success: true,
    requestId: request.id,
    request: { method: request.method, url: request.url },
    response: {
      requestId: request.id,
      statusCode,
      statusText: 'OK',
      headers: [],
      body: { bytes: freezeDetachedBytes(new Uint8Array(0)) },
      bodySizeBytes: 0,
      url: request.url,
      redirected: false,
      redirectCount: 0,
      timing: TIMING,
    },
    timing: TIMING,
  };
}

function failure(
  request: RuntimeRequest,
  code: 'NETWORK' | 'CANCELLED',
): ExecutionResult {
  return {
    success: false,
    requestId: request.id,
    request: { method: request.method, url: request.url },
    error: {
      code,
      message: code === 'CANCELLED' ? 'Cancelled.' : 'Network failed.',
      retryable: code === 'NETWORK',
    },
    timing: TIMING,
  };
}

test('runs the real parse, select, scoped validation, and build pipeline once', async () => {
  const requests: RuntimeRequest[] = [];
  const h = harness({
    async execute(request) {
      requests.push(request);
      return success(request, 204);
    },
  });
  const text = 'GET https://example.test/one\n###\nGET';

  const outcome = await h.orchestrator.runAtPosition(source(text, 1));

  assert.equal(outcome, 'success');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://example.test/one');
  assert.equal(requests[0]!.authentication.kind, 'resolved');
  assert.equal(
    (requests[0] as RuntimeRequest & { authenticationStage?: string })
      .authenticationStage,
    'authenticated',
  );
  assert.equal(h.viewer.results.length, 1);
  assert.deepEqual(h.status.updates.at(-1), {
    kind: 'success',
    statusCode: 204,
  });
  assert.deepEqual(h.notifications.messages, []);
  assert.deepEqual(h.progress.messages, [
    'Parsing request',
    'Validating request',
    'Building request',
    'Resolving variables',
    'Resolving authentication',
    'Sending request',
  ]);
});

test('authentication resolves exactly once and blocks transport on failure', async () => {
  let authenticationCalls = 0;
  let executeCalls = 0;
  const delegate = new DefaultAuthenticationResolver(
    new AuthenticationProviderRegistry([new NoneAuthenticationProvider()]),
  );
  const resolver: AuthenticationResolver = {
    async resolve(request, context, signal) {
      authenticationCalls += 1;
      return delegate.resolve(request, context, signal);
    },
  };
  const secrets = {
    get: (): Promise<undefined> => Promise.resolve(undefined),
    store: (): Promise<void> => Promise.resolve(),
    delete: (): Promise<void> => Promise.resolve(),
  };
  const h = harness(
    {
      async execute(request) {
        executeCalls += 1;
        return success(request);
      },
    },
    undefined,
    undefined,
    { definitions: [] },
    resolver,
    { profiles: [], secrets },
  );
  assert.equal(
    await h.orchestrator.runAtPosition(source('GET https://example.test')),
    'success',
  );
  assert.equal(authenticationCalls, 1);
  assert.equal(executeCalls, 1);

  const failed = harness({
    async execute(request) {
      executeCalls += 1;
      return success(request);
    },
  });
  assert.equal(
    await failed.orchestrator.runAtPosition(
      source('@auth missing\nGET https://example.test'),
    ),
    'precondition-failed',
  );
  assert.equal(executeCalls, 1);
  assert.match(failed.notifications.messages[0] ?? '', /profile "missing"/u);
  assert.equal(failed.viewer.results.length, 0);
});

test('resolves exactly once before execution and blocks unresolved requests', async () => {
  let resolveCalls = 0;
  let executeCalls = 0;
  const delegate = new DefaultVariableResolver();
  const countingResolver: VariableResolver = {
    analyze: (context) => delegate.analyze(context),
    resolveRequest(request, context) {
      resolveCalls += 1;
      return delegate.resolveRequest(request, context);
    },
  };
  const h = harness({
    async execute(runtimeRequest) {
      executeCalls += 1;
      return success(runtimeRequest);
    },
  }, undefined, countingResolver);

  assert.equal(
    await h.orchestrator.runAtPosition(source('GET https://{{missing}}', 1)),
    'precondition-failed',
  );
  assert.equal(resolveCalls, 1);
  assert.equal(executeCalls, 0);
  assert.equal(h.viewer.results.length, 0);
  assert.equal(h.notifications.messages[0], 'The selected request has unresolved variables: missing.');
});

test('passes the resolved immutable request to the executor', async () => {
  let received: RuntimeRequest | undefined;
  const h = harness({
    async execute(runtimeRequest) {
      received = runtimeRequest;
      return success(runtimeRequest);
    },
  }, undefined, undefined, {
    definitions: [{
      name: 'host',
      value: 'example.test',
      scope: 'environment',
      sensitive: false,
    }],
  });

  const outcome = await h.orchestrator.runAtPosition(
    source('GET https://{{host}}/users', 1),
  );

  assert.equal(outcome, 'success');
  assert.equal(received?.url, 'https://example.test/users');
  assert.deepEqual(received?.variables, []);
  assert.ok(Object.isFrozen(received));
});

test('gates selected syntax and semantic errors with friendly notifications', async () => {
  let calls = 0;
  const h = harness({
    async execute(request) {
      calls += 1;
      return success(request);
    },
  });

  assert.equal(
    await h.orchestrator.runAtPosition(source('GET "unterminated', 1)),
    'precondition-failed',
  );
  assert.match(h.notifications.messages.at(-1) ?? '', /syntax error/i);
  assert.equal(
    await h.orchestrator.runAtPosition(source('GET', 1)),
    'precondition-failed',
  );
  assert.match(h.notifications.messages.at(-1) ?? '', /invalid/i);
  assert.equal(calls, 0);
  assert.equal(h.viewer.results.length, 0);
});

test('shows structured operational failures in the reusable viewer', async () => {
  const h = harness({
    async execute(request) {
      return failure(request, 'NETWORK');
    },
  });

  assert.equal(
    await h.orchestrator.runAtPosition(source('GET https://example.test', 1)),
    'failed',
  );
  assert.equal(h.viewer.results[0]?.success, false);
  assert.deepEqual(h.status.updates.at(-1), { kind: 'failed' });
  assert.deepEqual(h.notifications.messages, []);
});

test('cancellation aborts execution and reports a clean cancelled outcome', async () => {
  const h = harness({
    execute(request, context) {
      return new Promise((resolve) => {
        context?.signal?.addEventListener(
          'abort',
          () => resolve(failure(request, 'CANCELLED')),
          { once: true },
        );
      });
    },
  });

  const run = h.orchestrator.runAtPosition(
    source('GET https://example.test', 1),
  );
  h.progress.controller.abort();
  assert.equal(await run, 'cancelled');
  assert.equal(h.viewer.results.length, 0);
  assert.deepEqual(h.status.updates.at(-1), { kind: 'cancelled' });
});

test('a replacement run prevents stale completion from changing viewer or status', async () => {
  const completions: ((result: ExecutionResult) => void)[] = [];
  const h = harness({
    execute() {
      return new Promise((resolve) => completions.push(resolve));
    },
  });

  const first = h.orchestrator.runAtPosition(
    source('GET https://example.test/first', 1),
  );
  const second = h.orchestrator.runAtPosition(
    source('GET https://example.test/second', 1),
  );
  const secondParsed = parseApiDocument('GET https://example.test/second', {
    sourceId: 'test.api',
  }).ast;
  const secondRequest = buildSelectedRequest(
    secondParsed,
    secondParsed.requests[0]!,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  completions[0]!(success(secondRequest, 202));
  assert.equal(await second, 'success');
  assert.equal(await first, 'replaced');
  assert.equal(h.viewer.results.length, 1);
  assert.equal(
    h.viewer.results[0]?.success && h.viewer.results[0].response.statusCode,
    202,
  );
});

test('maps build and viewer exceptions without exposing stack details', async () => {
  const pipeline: RequestExecutionPipeline = {
    parse: (input) =>
      parseApiDocument(input.text, { sourceId: input.sourceId }),
    select: selectRequestAtOffset,
    validate: validateApiRequest,
    build: () => {
      throw new Error('private builder stack detail');
    },
  };
  const buildHarness = harness({
    async execute(request) {
      return success(request);
    },
  }, pipeline);
  assert.equal(
    await buildHarness.orchestrator.runAtPosition(
      source('GET https://example.test', 1),
    ),
    'precondition-failed',
  );
  assert.equal(
    buildHarness.notifications.messages[0],
    'API Hero could not prepare or execute the selected request.',
  );

  const viewerHarness = harness({
    async execute(request) {
      return success(request);
    },
  });
  viewerHarness.viewer.fail = true;
  assert.equal(
    await viewerHarness.orchestrator.runAtPosition(
      source('GET https://example.test', 1),
    ),
    'failed',
  );
  assert.match(viewerHarness.notifications.messages[0] ?? '', /response viewer/i);
});

test('a pre-aborted progress signal skips the pipeline, executor, and viewer', async () => {
  const counts = { parse: 0, select: 0, validate: 0, build: 0 };
  let executeCalls = 0;
  const countingPipeline: RequestExecutionPipeline = {
    parse: (input) => {
      counts.parse += 1;
      return parseApiDocument(input.text, { sourceId: input.sourceId });
    },
    select: (document, offset) => {
      counts.select += 1;
      return selectRequestAtOffset(document, offset);
    },
    validate: (document, request) => {
      counts.validate += 1;
      return validateApiRequest(document, request);
    },
    build: (document, request, validation) => {
      counts.build += 1;
      return buildSelectedRequest(document, request, validation);
    },
  };
  const h = harness({
    async execute(request) {
      executeCalls += 1;
      return success(request);
    },
  }, countingPipeline);
  h.progress.controller.abort();

  const outcome = await h.orchestrator.runAtPosition(
    source('GET https://example.test', 1),
  );

  assert.equal(outcome, 'cancelled');
  assert.deepEqual(counts, { parse: 0, select: 0, validate: 0, build: 0 });
  assert.equal(executeCalls, 0);
  assert.equal(h.viewer.results.length, 0);
  assert.deepEqual(h.status.updates.at(-1), { kind: 'cancelled' });
  assert.deepEqual(h.notifications.messages, []);
});

test('dispose aborts active work and disposes status exactly once', async () => {
  const h = harness({
    execute(request, context) {
      return new Promise((resolve) => {
        context?.signal?.addEventListener(
          'abort',
          () => resolve(failure(request, 'CANCELLED')),
          { once: true },
        );
      });
    },
  });
  const run = h.orchestrator.runAtPosition(
    source('GET https://example.test', 1),
  );
  h.orchestrator.dispose();
  h.orchestrator.dispose();
  assert.equal(await run, 'replaced');
  assert.equal(h.status.disposed, true);
});

test('records history after a successful network execution', async () => {
  const repository = new InMemoryHistoryRepository();
  const recorder = new DefaultHistoryRecorder(repository);
  const h = harness(
    {
      async execute(request) {
        return success(request);
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    recorder,
  );

  const outcome = await h.orchestrator.runAtPosition(
    source('GET https://example.test/items\n', 0),
  );

  assert.equal(outcome, 'success');
  const entries = await repository.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.summary.status, 'success');
  assert.equal(entries[0]?.summary.method, 'GET');
  assert.equal(entries[0]?.metadata.environmentName, 'TestEnv');
  assert.equal(entries[0]?.metadata.source?.uri, 'test.api');
  assert.doesNotMatch(JSON.stringify(entries[0]), /Authorization|password/iu);
});

test('skips history for precondition failures before execute', async () => {
  const repository = new InMemoryHistoryRepository();
  const recorder = new DefaultHistoryRecorder(repository);
  const h = harness(
    {
      async execute() {
        throw new Error('executor must not run');
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    recorder,
  );

  const outcome = await h.orchestrator.runAtPosition(
    source('GET\n', 0),
  );

  assert.equal(outcome, 'precondition-failed');
  assert.equal((await repository.list()).length, 0);
});

test('runAtSourceLocation can suppress the response viewer', async () => {
  const h = harness({
    async execute(request) {
      return success(request, 200);
    },
  });
  const result = await h.orchestrator.runAtSourceLocation(
    source('GET https://example.test', 1),
    { showViewer: false, useProgressUi: false, showNotifications: false },
  );
  assert.equal(result.outcome, 'success');
  assert.equal(result.statusCode, 200);
  assert.equal(h.viewer.results.length, 0);
  assert.equal(h.notifications.messages.length, 0);
});

test('merges historyCaptureContext override with provider environmentName', async () => {
  const repository = new InMemoryHistoryRepository();
  const recorder = new DefaultHistoryRecorder(repository);
  const h = harness(
    {
      async execute(request) {
        return success(request);
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    recorder,
  );

  const result = await h.orchestrator.runAtSourceLocation(
    source('GET https://example.test/items\n', 0),
    {
      showViewer: false,
      useProgressUi: false,
      showNotifications: false,
      historyCaptureContext: { collectionName: 'DemoCollection' },
    },
  );

  assert.equal(result.outcome, 'success');
  const entries = await repository.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.metadata.environmentName, 'TestEnv');
  assert.equal(entries[0]?.metadata.collectionName, 'DemoCollection');
});

test('evaluates assertions after execute and attaches them to the viewer', async () => {
  const observations: { sourceId: string; hasReport: boolean }[] = [];
  const h = harness(
    {
      async execute(request) {
        return success(request, 200);
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      onEvaluated: (input) => {
        observations.push({
          sourceId: input.sourceId,
          hasReport: input.report !== undefined,
        });
      },
    },
  );

  const text = [
    'GET https://example.test/items',
    'expect status == 200',
    'expect status == 201',
  ].join('\n');
  const result = await h.orchestrator.runAtSourceLocation(source(text, 0));

  assert.equal(result.outcome, 'failed');
  assert.equal(result.assertionFailed, true);
  assert.equal(result.assertions?.summary.total, 2);
  assert.equal(result.assertions?.summary.passed, 1);
  assert.equal(result.assertions?.summary.failed, 1);
  assert.equal(h.viewer.assertionReports.length, 1);
  assert.equal(h.viewer.assertionReports[0]?.summary.failed, 1);
  assert.deepEqual(observations, [{ sourceId: 'test.api', hasReport: true }]);
});

test('still evaluates assertions against HTTP 4xx responses', async () => {
  const h = harness({
    async execute(request) {
      return success(request, 404);
    },
  });
  const text = [
    'GET https://example.test/missing',
    'expect status == 404',
  ].join('\n');
  const result = await h.orchestrator.runAtSourceLocation(source(text, 0));

  assert.equal(result.outcome, 'success');
  assert.equal(result.statusCode, 404);
  assert.equal(result.assertionFailed, false);
  assert.equal(result.assertions?.summary.passed, 1);
});

test('skips assertion evaluation and Problems observer for CANCELLED results', async () => {
  const observations: unknown[] = [];
  const h = harness(
    {
      async execute(request) {
        return failure(request, 'CANCELLED');
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      onEvaluated: (input) => observations.push(input),
    },
  );

  const text = [
    'GET https://example.test/items',
    'expect status == 200',
  ].join('\n');
  const result = await h.orchestrator.runAtSourceLocation(source(text, 0));

  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.assertions, undefined);
  assert.equal(observations.length, 0);
});

test('skips assertion evaluation for precondition failures before execute', async () => {
  let executeCalls = 0;
  const observations: unknown[] = [];
  const h = harness(
    {
      async execute(request) {
        executeCalls += 1;
        return success(request);
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      onEvaluated: (input) => observations.push(input),
    },
  );

  const outcome = await h.orchestrator.runAtPosition(
    source('GET\nexpect status == 200'),
  );

  assert.equal(outcome, 'precondition-failed');
  assert.equal(executeCalls, 0);
  assert.equal(observations.length, 0);
  assert.equal(h.viewer.results.length, 0);
});

test('skips assertion evaluation for replaced runs', async () => {
  const observations: unknown[] = [];
  const completions: ((result: ExecutionResult) => void)[] = [];
  const h = harness(
    {
      execute() {
        return new Promise((resolve) => completions.push(resolve));
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      onEvaluated: (input) => observations.push(input),
    },
  );

  const text = [
    'GET https://example.test/items',
    'expect status == 200',
  ].join('\n');
  const first = h.orchestrator.runAtSourceLocation(source(text, 0));
  const second = h.orchestrator.runAtSourceLocation(source(text, 0));
  const parsed = parseApiDocument(text, { sourceId: 'test.api' }).ast;
  const request = buildSelectedRequest(parsed, parsed.requests[0]!);

  for (let attempt = 0; attempt < 20 && completions.length < 2; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.ok(completions.length >= 1);
  for (const complete of completions) {
    complete(success(request, 200));
  }

  const firstResult = await first;
  const secondResult = await second;
  assert.equal(firstResult.outcome, 'replaced');
  assert.equal(firstResult.assertions, undefined);
  assert.equal(secondResult.outcome, 'success');
  assert.equal(secondResult.assertions?.summary.passed, 1);
  assert.equal(observations.length, 1);
});

test('stores secret-free assertion counts only in history extensions', async () => {
  const repository = new InMemoryHistoryRepository();
  const recorder = new DefaultHistoryRecorder(repository);
  const h = harness(
    {
      async execute(request) {
        return success(request, 200);
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    recorder,
  );

  const text = [
    'GET https://example.test/items',
    'expect status == 200',
    'expect status == 500',
  ].join('\n');
  await h.orchestrator.runAtSourceLocation(source(text, 0), {
    showViewer: false,
  });

  const entries = await repository.list();
  assert.equal(entries.length, 1);
  const counts = entries[0]?.extensions?.assertions;
  assert.deepEqual(counts, {
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    malformed: 0,
    passPercent: 50,
  });
  assert.doesNotMatch(JSON.stringify(entries[0]), /expect status/u);
});
