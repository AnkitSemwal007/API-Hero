import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ExecutionResult,
  HttpTransport,
  HttpTransportRequest,
  HttpTransportResponse,
  RequestExecutor,
} from '../execution';
import { DefaultRequestExecutor } from '../execution';
import {
  DefaultHistoryRecorder,
  InMemoryHistoryRepository,
} from '../history';
import {
  ExecutionOrchestrator,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatus,
  type ExecutionStatusPresenter,
} from './execution-orchestrator';
import {
  CollectionRunnerService,
  CollectionRunModes,
  FailurePolicyKinds,
  RequestRunOutcomeKinds,
  buildRunPlan,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
} from '../collection-runner';
import {
  freezeWorkspaceCollections,
  type Collection,
  type RequestReference,
  type WorkspaceCollections,
} from '../collections';

const EMPTY_RESPONSE: HttpTransportResponse = {
  statusCode: 200,
  statusText: 'OK',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: new TextEncoder().encode('{"ok":true,"id":1}'),
  finalUrl: 'https://example.test/users',
  redirected: false,
  redirectCount: 0,
};

class FakeTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];

  public constructor(
    private readonly handler: (
      request: HttpTransportRequest,
      signal: AbortSignal,
    ) => Promise<HttpTransportResponse> = async () => EMPTY_RESPONSE,
  ) {}

  public execute(
    request: HttpTransportRequest,
    context: { readonly signal: AbortSignal },
  ): Promise<HttpTransportResponse> {
    this.requests.push(request);
    return this.handler(request, context.signal);
  }
}

class FakeStatus implements ExecutionStatusPresenter {
  public readonly updates: ExecutionStatus[] = [];
  public update(status: ExecutionStatus): void {
    this.updates.push(status);
  }
  public dispose(): void {
    /* no-op fake */
  }
}

class FakeViewer implements ExecutionResultViewer {
  public readonly results: ExecutionResult[] = [];
  public show(result: ExecutionResult): void {
    this.results.push(result);
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
  public run<T>(
    task: (
      signal: AbortSignal,
      reporter: { report(message: string): void },
    ) => Promise<T>,
  ): Promise<T> {
    return task(this.controller.signal, { report: () => undefined });
  }
}

function createPipeline(
  executor: RequestExecutor,
  historyRepository: InMemoryHistoryRepository,
) {
  const recorder = new DefaultHistoryRecorder(historyRepository);
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
    undefined,
    undefined,
    () => ({ definitions: [] }),
    undefined,
    undefined,
    recorder,
    () => ({ environmentName: 'Integration' }),
  );
  return { orchestrator, viewer, notifications, progress, historyRepository };
}

test('pipeline integration: parse → build → execute → assert → history (success)', async () => {
  const transport = new FakeTransport();
  const history = new InMemoryHistoryRepository();
  const { orchestrator, viewer } = createPipeline(
    new DefaultRequestExecutor(transport),
    history,
  );

  const text = [
    'GET https://example.test/users',
    'Accept: application/json',
    'expect status == 200',
    'expect body.ok == true',
  ].join('\n');

  const outcome = await orchestrator.runAtPosition({
    text,
    sourceId: 'integration.api',
    offset: 0,
  });

  assert.equal(outcome, 'success');
  assert.equal(transport.requests.length, 1);
  assert.equal(viewer.results.length, 1);
  assert.equal(viewer.results[0]?.success, true);

  const entries = await history.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.summary.status, 'success');
  assert.equal(entries[0]?.summary.method, 'GET');
  assert.doesNotMatch(JSON.stringify(entries[0]), /sekrit/u);
});

test('pipeline integration: assertion failure is recorded with history', async () => {
  const transport = new FakeTransport(async () => ({
    ...EMPTY_RESPONSE,
    statusCode: 500,
    statusText: 'Error',
    body: new TextEncoder().encode('{"ok":false}'),
  }));
  const history = new InMemoryHistoryRepository();
  const { orchestrator } = createPipeline(
    new DefaultRequestExecutor(transport),
    history,
  );

  const text = [
    'GET https://example.test/users',
    'expect status == 200',
  ].join('\n');

  const result = await orchestrator.runAtSourceLocation({
    text,
    sourceId: 'integration-fail.api',
    offset: 0,
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.assertionFailed, true);
  assert.equal(result.assertions?.summary.failed, 1);
  assert.equal((await history.list()).length, 1);
});

test('pipeline integration: cancelled path aborts in-flight execution', async () => {
  const transport = new FakeTransport(
    async () => new Promise<HttpTransportResponse>(() => undefined),
  );
  const history = new InMemoryHistoryRepository();
  const { orchestrator, progress } = createPipeline(
    new DefaultRequestExecutor(transport),
    history,
  );

  const run = orchestrator.runAtPosition({
    text: 'GET https://example.test/slow',
    sourceId: 'integration-cancel.api',
    offset: 0,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  progress.controller.abort();
  assert.equal(await run, 'cancelled');
});

test('pipeline integration: collection-runner single item through orchestrator port', async () => {
  const transport = new FakeTransport();
  const history = new InMemoryHistoryRepository();
  const { orchestrator } = createPipeline(
    new DefaultRequestExecutor(transport),
    history,
  );

  const collectionId = 'collection:ws';
  const requestRef: RequestReference = {
    id: 'r1',
    collectionId,
    folderId: undefined,
    filePath: 'file:///ws/one.api',
    requestIndex: 0,
    method: 'GET',
    url: 'https://example.test/users',
    display: { label: 'users' },
    range: {
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 3, line: 0, column: 3 },
    },
  };
  const collection: Collection = {
    id: collectionId,
    rootPath: 'file:///ws',
    workspaceRootPath: 'file:///ws',
    kind: 'legacy',
    metadata: {
      name: 'ws',
      workspacePath: 'file:///ws',
      requestCount: 1,
      folderCount: 0,
    },
    display: { label: 'ws' },
    rootFolderIds: [],
    rootRequestIds: ['r1'],
    folders: {},
    requests: { r1: requestRef },
  };
  const aggregate: WorkspaceCollections = freezeWorkspaceCollections({
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

  const sourceText = [
    'GET https://example.test/users',
    'expect status == 200',
    'expect body.id == 1',
  ].join('\n');

  const reader: CollectionRunSourceReader = {
    async readText(uri: string): Promise<string> {
      assert.equal(uri, 'file:///ws/one.api');
      return sourceText;
    },
  };
  const port: CollectionRequestExecutorPort = {
    runAtSourceLocation(source, options) {
      return orchestrator.runAtSourceLocation(source, options);
    },
  };

  const plan = buildRunPlan({
    aggregate,
    target: { mode: CollectionRunModes.Collection, collectionId },
    failurePolicy: FailurePolicyKinds.StopOnFirstError,
  });
  assert.equal(plan.requests.length, 1);

  const runner = new CollectionRunnerService({
    executor: port,
    sourceReader: reader,
  });
  const summary = await runner.execute({ plan });

  assert.equal(summary.statistics.passed, 1);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(transport.requests.length, 1);
  assert.equal((await history.list()).length, 1);
});
