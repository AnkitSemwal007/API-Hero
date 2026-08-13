import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';

import type {
  ExecutionResult,
  HttpTransport,
  HttpTransportRequest,
  HttpTransportResponse,
} from '../execution';
import { DefaultRequestExecutor } from '../execution';
import {
  CollectionRunnerService,
  CollectionRunModes,
  FailurePolicyKinds,
  RequestRunOutcomeKinds,
  buildRunPlan,
  type CollectionRunSourceReader,
} from '../collection-runner';
import {
  freezeWorkspaceCollections,
  type Collection,
  type RequestReference,
  type WorkspaceCollections,
} from '../collections';
import { redactForMcp } from '../mcp/redact';
import { presentExecutionResult } from '../response';
import { MASKED_HEADER_VALUE } from '../response/presentation';
import {
  DefaultExtractionEngine,
  type VariableWriteRequest,
  type VariableWriteResult,
  type VariableWriter,
} from '../extraction';
import { ScenarioEngine } from '../scenarios/execution/scenario-engine';
import { RequestStepRunner } from '../scenarios/execution/step-runners/request-step-runner';
import {
  ScenarioSchemaVersion,
  StepType,
  type RequestStep,
} from '../scenarios/models';
import { extractDocumentVariables } from '../variables';
import {
  ExecutionOrchestrator,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatus,
  type ExecutionStatusPresenter,
} from './execution-orchestrator';

const REST_OK: HttpTransportResponse = {
  statusCode: 200,
  statusText: 'OK',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: new TextEncoder().encode('{"ok":true}'),
  finalUrl: 'https://example.test/users',
  redirected: false,
  redirectCount: 0,
};

const GRAPHQL_OK: HttpTransportResponse = {
  ...REST_OK,
  body: new TextEncoder().encode('{"data":{"user":{"name":"Ada"}}}'),
  finalUrl: 'https://example.test/graphql',
};

class FakeTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];

  public constructor(
    private readonly handler: (
      request: HttpTransportRequest,
    ) => Promise<HttpTransportResponse> = async (request) =>
      request.url.includes('/graphql') ? GRAPHQL_OK : REST_OK,
  ) {}

  public execute(
    request: HttpTransportRequest,
  ): Promise<HttpTransportResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

class FakeStatus implements ExecutionStatusPresenter {
  public readonly updates: ExecutionStatus[] = [];
  public update(status: ExecutionStatus): void {
    this.updates.push(status);
  }
  public dispose(): void {
    /* no-op */
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

class RecordingWriter implements VariableWriter {
  public constructor(
    private readonly extracted: {
      name: string;
      value: string;
      sensitive: boolean;
    }[],
  ) {}

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    this.extracted.push({
      name: request.name,
      value: request.value,
      sensitive: request.sensitive === true,
    });
    return { ok: true };
  }
}

function createOrchestrator(
  transport: FakeTransport,
  executionContext: { readonly timeoutMs?: number } = {},
) {
  const status = new FakeStatus();
  const viewer = new FakeViewer();
  const notifications = new FakeNotifications();
  const progress = new FakeProgress();
  const extracted: {
    name: string;
    value: string;
    sensitive: boolean;
  }[] = [];
  const orchestrator = new ExecutionOrchestrator(
    new DefaultRequestExecutor(transport),
    viewer,
    status,
    progress,
    notifications,
    () => executionContext,
    undefined,
    undefined,
    (document) => ({
      definitions: [
        ...extractDocumentVariables(document).definitions,
        ...extracted.map((item) => ({
          name: item.name,
          value: item.value,
          scope: 'run' as const,
          sensitive: item.sensitive,
        })),
      ],
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      async onExecuted(input) {
        return new DefaultExtractionEngine().apply(
          input.extractionRules,
          {
            result: input.result,
            assertionReport: input.assertionReport,
            requestKey: input.requestKey,
          },
          new RecordingWriter(extracted),
        );
      },
    },
  );
  return { orchestrator, viewer, notifications, status, transport, extracted };
}

async function echoServer(options?: {
  readonly echo?: boolean;
}): Promise<{
  readonly url: string;
  readonly headers: string[];
  readonly close: () => Promise<void>;
}> {
  const headers: string[] = [];
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (socket, request) => {
    headers.push(request.headers.authorization ?? '');
    socket.on('message', (data, isBinary) => {
      if (options?.echo === false) {
        return;
      }
      if (!isBinary) {
        socket.send(data.toString());
      }
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('echo server has no port');
  }
  return {
    url: `ws://127.0.0.1:${address.port}`,
    headers,
    async close() {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}

function collectionAggregate(
  requests: Record<string, RequestReference>,
): { collectionId: string; aggregate: WorkspaceCollections } {
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
  return {
    collectionId,
    aggregate: freezeWorkspaceCollections({
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
    }),
  };
}

function requestRef(
  id: string,
  filePath: string,
  method: string,
  url: string,
): RequestReference {
  return {
    id,
    collectionId: 'collection:ws',
    folderId: undefined,
    filePath,
    requestIndex: 0,
    method,
    url,
    display: { label: id },
    range: {
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 4, line: 0, column: 4 },
    },
  };
}

test('missing protocol remains HTTP and never opens a WebSocket', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: 'GET https://example.test/users',
    sourceId: 'rest.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  assert.equal(transport.requests.length, 1);
  if (result.execution?.success) {
    assert.equal(result.execution.websocket, undefined);
  }
});

test('unknown @protocol is still a validation error', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: ['@protocol mqtt', 'GET https://example.test/users'].join('\n'),
    sourceId: 'mqtt.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'precondition-failed');
  assert.equal(transport.requests.length, 0);
});

test('GraphQL still uses HTTP transport when WebSocket is available', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query { user { name } }" }',
    ].join('\n'),
    sourceId: 'gql.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  assert.equal(transport.requests.length, 1);
  if (result.execution?.success) {
    assert.equal(result.execution.websocket, undefined);
    assert.equal(result.execution.graphql?.hasData, true);
  }
});

test('WebSocket variables resolve in URL, headers, and message', async () => {
  const server = await echoServer();
  try {
    const { orchestrator, transport, status } = createOrchestrator(new FakeTransport());
    const result = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        `@variable wsUrl=${server.url}`,
        '@variable greet=hello-ada',
        'GET {{wsUrl}}',
        'X-Room: {{greet}}',
        '',
        '{"message":"{{greet}}"}',
      ].join('\n'),
      sourceId: 'ws-vars.api',
      offset: 0,
    });
    assert.equal(result.outcome, 'success');
    assert.equal(transport.requests.length, 0);
    assert.equal(result.statusCode, undefined);
    assert.equal(result.execution?.success, true);
    if (result.execution?.success) {
      assert.equal(result.execution.response.body.text, '{"message":"hello-ada"}');
    }
    const successStatus = status.updates.find((update) => update.kind === 'success');
    assert.equal(successStatus?.kind, 'success');
    if (successStatus?.kind === 'success') {
      assert.equal(successStatus.statusCode, undefined);
    }
  } finally {
    await server.close();
  }
});

test('WebSocket JSON assertion and extraction reuse existing engines', async () => {
  const server = await echoServer();
  try {
    const { orchestrator } = createOrchestrator(new FakeTransport());
    const result = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        `@variable wsUrl=${server.url}`,
        '@extract token from body.token',
        'GET {{wsUrl}}',
        'expect body.token == "ws-token-1"',
        '',
        '{"token":"ws-token-1"}',
      ].join('\n'),
      sourceId: 'ws-json.api',
      offset: 0,
    });
    assert.equal(result.outcome, 'success');
    assert.equal(result.assertionFailed, false);
    assert.equal(result.extraction?.extractedCount, 1);
    const token = result.extraction?.outcomes.find(
      (outcome) => outcome.rule.variableName === 'token',
    );
    assert.equal(token?.kind, 'extracted');
    const presentation = result.execution
      ? presentExecutionResult(result.execution)
      : undefined;
    assert.equal(presentation?.status, undefined);
    assert.match(presentation?.summary ?? '', /WebSocket received/u);
  } finally {
    await server.close();
  }
});

test('extracted WebSocket JSON is resolved by a later HTTP request', async () => {
  const server = await echoServer();
  try {
    const { orchestrator, transport } = createOrchestrator(new FakeTransport());
    const ws = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        `@variable wsUrl=${server.url}`,
        '@extract token from body.token',
        'GET {{wsUrl}}',
        '',
        '{"token":"ws-token-1"}',
      ].join('\n'),
      sourceId: 'ws-extract.api',
      offset: 0,
    });
    assert.equal(ws.outcome, 'success');
    const http = await orchestrator.runAtSourceLocation({
      text: 'GET https://example.test/users/{{token}}',
      sourceId: 'after-ws.api',
      offset: 0,
    });
    assert.equal(http.outcome, 'success');
    assert.equal(transport.requests.length, 1);
    assert.equal(transport.requests[0]?.url, 'https://example.test/users/ws-token-1');
  } finally {
    await server.close();
  }
});

test('@timeout on a WebSocket request wins over the host default', async () => {
  const server = await echoServer({ echo: false });
  try {
    const { orchestrator } = createOrchestrator(new FakeTransport(), {
      timeoutMs: 30_000,
    });
    const started = Date.now();
    const result = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        '@timeout 80',
        `@variable wsUrl=${server.url}`,
        'GET {{wsUrl}}',
        '',
        '{"type":"ping"}',
      ].join('\n'),
      sourceId: 'ws-timeout.api',
      offset: 0,
    });
    const elapsed = Date.now() - started;
    assert.equal(result.outcome, 'failed');
    assert.equal(result.execution?.success, false);
    if (result.execution && !result.execution.success) {
      assert.equal(result.execution.error.code, 'TIMEOUT');
    }
    assert.ok(elapsed < 5_000, `expected @timeout 80 to fire, waited ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

test('unresolved WebSocket variables produce a normal precondition failure', async () => {
  const { orchestrator, transport, notifications } = createOrchestrator(
    new FakeTransport(),
  );
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol websocket',
      'GET {{missingWsUrl}}',
      '',
      '{"type":"ping"}',
    ].join('\n'),
    sourceId: 'ws-unresolved.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'precondition-failed');
  assert.match(result.message ?? '', /unresolved variables: missingWsUrl/u);
  assert.equal(result.execution, undefined);
  assert.equal(transport.requests.length, 0);
  assert.match(notifications.messages.join('\n'), /unresolved variables/u);
});

test('WebSocket assertion failure is an assertion outcome', async () => {
  const server = await echoServer();
  try {
    const { orchestrator } = createOrchestrator(new FakeTransport());
    const result = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        `@variable wsUrl=${server.url}`,
        'GET {{wsUrl}}',
        'expect body.token == "nope"',
        '',
        '{"token":"ws-token-1"}',
      ].join('\n'),
      sourceId: 'ws-assert.api',
      offset: 0,
    });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.assertionFailed, true);
    assert.equal(result.execution?.success, true);
  } finally {
    await server.close();
  }
});

test('Authorization headers are applied on connect and masked in presentation', async () => {
  const server = await echoServer();
  try {
    const { orchestrator } = createOrchestrator(new FakeTransport());
    const result = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        `@variable wsUrl=${server.url}`,
        'GET {{wsUrl}}',
        'Authorization: Bearer super-secret-ws-token',
        '',
        '{"type":"ping"}',
      ].join('\n'),
      sourceId: 'ws-auth.api',
      offset: 0,
    });
    assert.equal(result.outcome, 'success');
    assert.ok(
      server.headers.some((value) => value.includes('super-secret-ws-token')),
    );
    const presentation = result.execution
      ? presentExecutionResult(result.execution)
      : undefined;
    const auth = presentation?.headers.find(
      (header) => header.name.toLowerCase() === 'authorization',
    );
    if (auth !== undefined) {
      assert.equal(auth.value, MASKED_HEADER_VALUE);
    }
    assert.doesNotMatch(
      JSON.stringify(presentation?.headers),
      /super-secret-ws-token/u,
    );
  } finally {
    await server.close();
  }
});

test('sensitive values in a WebSocket message are masked on MCP JSON', async () => {
  const server = await echoServer();
  try {
    const { orchestrator } = createOrchestrator(new FakeTransport());
    const result = await orchestrator.runAtSourceLocation({
      text: [
        '@protocol websocket',
        '@sensitive-variable token=sekrit-ws-token',
        `@variable wsUrl=${server.url}`,
        'GET {{wsUrl}}',
        '',
        '{"token":"{{token}}"}',
      ].join('\n'),
      sourceId: 'ws-secret.api',
      offset: 0,
    });
    assert.equal(result.outcome, 'success');
    const presentation = result.execution
      ? presentExecutionResult(result.execution)
      : undefined;
    const mcpPayload = redactForMcp({
      graphql: undefined,
      websocket: result.execution?.success
        ? result.execution.websocket
        : undefined,
      presentation: {
        websocket: presentation?.websocket,
        explanation: presentation?.explanation,
      },
    });
    assert.doesNotMatch(JSON.stringify(mcpPayload), /sekrit-ws-token/u);
  } finally {
    await server.close();
  }
});

test('mixed HTTP + GraphQL + WebSocket collection uses one runner', async () => {
  const server = await echoServer();
  try {
    const { orchestrator, transport } = createOrchestrator(new FakeTransport());
    const { collectionId, aggregate } = collectionAggregate({
      r1: requestRef('r1', 'file:///ws/rest.api', 'GET', 'https://example.test/users'),
      r2: requestRef(
        'r2',
        'file:///ws/gql.api',
        'POST',
        'https://example.test/graphql',
      ),
      r3: requestRef('r3', 'file:///ws/socket.api', 'GET', server.url),
    });
    const sources: Record<string, string> = {
      'file:///ws/rest.api': 'GET https://example.test/users',
      'file:///ws/gql.api': [
        '@protocol graphql',
        'POST https://example.test/graphql',
        '',
        '{ "query": "query { user { name } }" }',
      ].join('\n'),
      'file:///ws/socket.api': [
        '@protocol websocket',
        `@variable wsUrl=${server.url}`,
        'GET {{wsUrl}}',
        '',
        '{"type":"ping"}',
      ].join('\n'),
    };
    const reader: CollectionRunSourceReader = {
      async readText(filePath: string): Promise<string> {
        return sources[filePath] ?? '';
      },
    };
    const summary = await new CollectionRunnerService({
      executor: {
        runAtSourceLocation(source, options) {
          return orchestrator.runAtSourceLocation(source, options);
        },
      },
      sourceReader: reader,
    }).execute({
      plan: buildRunPlan({
        aggregate,
        target: { mode: CollectionRunModes.Collection, collectionId },
        failurePolicy: FailurePolicyKinds.ContinueOnError,
      }),
    });
    assert.equal(summary.results.length, 3);
    assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
    assert.equal(summary.results[1]?.outcome, RequestRunOutcomeKinds.Passed);
    assert.equal(summary.results[2]?.outcome, RequestRunOutcomeKinds.Passed);
    assert.equal(summary.results[0]?.statusCode, 200);
    assert.equal(summary.results[1]?.statusCode, 200);
    assert.equal(summary.results[2]?.statusCode, undefined);
    assert.equal(transport.requests.length, 2);
  } finally {
    await server.close();
  }
});

test('failed WebSocket request skips a dependent collection request', async () => {
  const { orchestrator } = createOrchestrator(new FakeTransport());
  const { collectionId, aggregate } = collectionAggregate({
    r1: requestRef('r1', 'file:///ws/echo.api', 'GET', 'ws://127.0.0.1:1'),
    r2: requestRef('r2', 'file:///ws/after.api', 'GET', 'https://example.test/users'),
  });
  const sources: Record<string, string> = {
    'file:///ws/echo.api': [
      '@name Echo',
      '@protocol websocket',
      '@variable wsUrl=ws://127.0.0.1:1',
      'GET {{wsUrl}}',
      '',
      '{"type":"ping"}',
    ].join('\n'),
    'file:///ws/after.api': [
      '@name After',
      '@depends-on Echo',
      'GET https://example.test/users',
    ].join('\n'),
  };
  const summary = await new CollectionRunnerService({
    executor: {
      runAtSourceLocation(source, options) {
        return orchestrator.runAtSourceLocation(source, options);
      },
    },
    sourceReader: {
      async readText(filePath: string): Promise<string> {
        return sources[filePath] ?? '';
      },
    },
  }).execute({
    plan: buildRunPlan({
      aggregate,
      target: { mode: CollectionRunModes.Collection, collectionId },
      failurePolicy: FailurePolicyKinds.StopOnFirstError,
    }),
  });
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Failed);
  assert.equal(summary.results[1]?.outcome, RequestRunOutcomeKinds.Skipped);
});

test('RequestStepRunner executes a WebSocket .api request', async () => {
  const server = await echoServer();
  try {
    const { orchestrator, transport } = createOrchestrator(new FakeTransport());
    const runner = new RequestStepRunner({
      executor: {
        runAtSourceLocation(source, options) {
          return orchestrator.runAtSourceLocation(source, options);
        },
      },
      sourceReader: {
        async readText(): Promise<string> {
          return [
            '@protocol websocket',
            `@variable wsUrl=${server.url}`,
            'GET {{wsUrl}}',
            '',
            '{"type":"ping"}',
          ].join('\n');
        },
      },
      scenarioVariableResolver: {
        resolveScenarioVariable: () => '',
        resolveStringTemplate: () => '',
      } as never,
      now: () => 1,
      sleep: async () => undefined,
    });
    const step: RequestStep = {
      id: 'S1',
      type: StepType.Request,
      name: 'Echo',
      requestId: 'req-1',
      requestFilePath: 'ws.api',
      requestOffset: 0,
      inputMappings: [],
    };
    const result = await runner.run(step, {
      runId: 'run-1',
      scenario: {
        id: 'sc',
        schemaVersion: ScenarioSchemaVersion,
        name: 'Scenario',
        variables: [],
        steps: [],
        connections: [],
        executionSettings: { failurePolicy: 'stop-on-first-error' },
        metadata: { createdAt: 't1', updatedAt: 't2' },
      },
      variables: new Map(),
      outputs: new Map(),
      signal: new AbortController().signal,
      logger: {
        info: () => undefined,
        warning: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
      timeline: [],
      startTime: 1,
    });
    assert.equal(result.stepResult.status, 'completed');
    assert.equal(transport.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('ScenarioEngine skips a dependent step after WebSocket failure', async () => {
  const { orchestrator } = createOrchestrator(new FakeTransport());
  const engine = new ScenarioEngine({
    executor: {
      runAtSourceLocation(source, options) {
        return orchestrator.runAtSourceLocation(source, options);
      },
    },
    sourceReader: {
      async readText(filePath: string): Promise<string> {
        if (filePath.includes('echo')) {
          return [
            '@protocol websocket',
            '@variable wsUrl=ws://127.0.0.1:1',
            'GET {{wsUrl}}',
            '',
            '{"type":"ping"}',
          ].join('\n');
        }
        return 'GET https://example.test/users';
      },
    },
    externalVariableResolver: {
      analyze: () => ({
        values: new Map(),
        errors: [],
      }),
      resolveRequest: () => ({
        success: true,
        request: undefined,
        values: new Map(),
      }),
    } as never,
    externalVariableDefinitions: [],
    fileExists: async () => true,
    logger: {
      info: () => undefined,
      warning: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
    now: () => 1,
    sleep: async () => undefined,
  });
  const result = await engine.runScenario(
    {
      id: 'sc-ws-skip',
      schemaVersion: ScenarioSchemaVersion,
      name: 'WebSocket skip',
      variables: [],
      steps: [
        {
          id: 'S1',
          type: StepType.Request,
          name: 'Echo',
          requestId: 'req-1',
          requestFilePath: 'echo.api',
          requestOffset: 0,
          inputMappings: [],
        },
        {
          id: 'S2',
          type: StepType.Request,
          name: 'After',
          requestId: 'req-2',
          requestFilePath: 'after.api',
          requestOffset: 0,
          inputMappings: [],
        },
      ],
      connections: [{ id: 'c1', fromStepId: 'S1', toStepId: 'S2' }],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    },
    { signal: new AbortController().signal },
  );
  assert.equal(result.run.stepResults[0]?.status, 'failed');
  assert.equal(result.run.stepResults[1]?.status, 'skipped');
});

test('RequestStepRunner records WebSocket connection failure', async () => {
  const { orchestrator } = createOrchestrator(new FakeTransport());
  const runner = new RequestStepRunner({
    executor: {
      runAtSourceLocation(source, options) {
        return orchestrator.runAtSourceLocation(source, options);
      },
    },
    sourceReader: {
      async readText(): Promise<string> {
        return [
          '@protocol websocket',
          '@variable wsUrl=ws://127.0.0.1:1',
          'GET {{wsUrl}}',
          '',
          '{"type":"ping"}',
        ].join('\n');
      },
    },
    scenarioVariableResolver: {
      resolveScenarioVariable: () => '',
      resolveStringTemplate: () => '',
    } as never,
    now: () => 1,
    sleep: async () => undefined,
  });
  const result = await runner.run(
    {
      id: 'S1',
      type: StepType.Request,
      name: 'Echo',
      requestId: 'req-1',
      requestFilePath: 'ws.api',
      requestOffset: 0,
      inputMappings: [],
    },
    {
      runId: 'run-1',
      scenario: {
        id: 'sc',
        schemaVersion: ScenarioSchemaVersion,
        name: 'Scenario',
        variables: [],
        steps: [],
        connections: [],
        executionSettings: { failurePolicy: 'stop-on-first-error' },
        metadata: { createdAt: 't1', updatedAt: 't2' },
      },
      variables: new Map(),
      outputs: new Map(),
      signal: new AbortController().signal,
      logger: {
        info: () => undefined,
        warning: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
      timeline: [],
      startTime: 1,
    },
  );
  assert.equal(result.stepResult.status, 'failed');
});
