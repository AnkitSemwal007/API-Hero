import assert from 'node:assert/strict';
import { test } from 'node:test';

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
  RequestFailureCategories,
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
import { redactForMcp } from '../mcp/redact';
import { presentExecutionResult } from '../response';
import { RequestStepRunner } from '../scenarios/execution/step-runners/request-step-runner';
import { StepType, ScenarioSchemaVersion, type RequestStep } from '../scenarios/models';
import { SECRET_SCRUB_MASK } from '../shared';
import { MASKED_VARIABLE_VALUE, extractDocumentVariables } from '../variables';
import {
  ExecutionOrchestrator,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatus,
  type ExecutionStatusPresenter,
} from './execution-orchestrator';

const GRAPHQL_DATA: HttpTransportResponse = {
  statusCode: 200,
  statusText: 'OK',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: new TextEncoder().encode('{"data":{"user":{"name":"Ada"}}}'),
  finalUrl: 'https://example.test/graphql',
  redirected: false,
  redirectCount: 0,
};

class FakeTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];

  public constructor(
    private readonly handler: (
      request: HttpTransportRequest,
    ) => Promise<HttpTransportResponse> = async () => GRAPHQL_DATA,
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

function createOrchestrator(transport: FakeTransport) {
  const status = new FakeStatus();
  const viewer = new FakeViewer();
  const notifications = new FakeNotifications();
  const progress = new FakeProgress();
  const orchestrator = new ExecutionOrchestrator(
    new DefaultRequestExecutor(transport),
    viewer,
    status,
    progress,
    notifications,
    () => ({}),
    undefined,
    undefined,
    (document) => ({
      definitions: extractDocumentVariables(document).definitions,
    }),
  );
  return { orchestrator, viewer, notifications, status, transport };
}

function graphqlSource(extra: readonly string[] = []): string {
  return [
    '@protocol graphql',
    '@name GetUser',
    ...extra,
    'POST https://example.test/graphql',
    'Content-Type: application/json',
    '',
    '{',
    '  "query": "query GetUser($id: ID!) { user(id: $id) { name } }",',
    '  "variables": { "id": "{{userId}}" },',
    '  "operationName": "GetUser"',
    '}',
  ].join('\n');
}

test('missing protocol is HTTP: REST 4xx without assertions remains success', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    statusCode: 404,
    statusText: 'Not Found',
    body: new TextEncoder().encode('{"error":"missing"}'),
  }));
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: 'GET https://example.test/missing',
    sourceId: 'rest-404.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  assert.equal(result.graphqlFailed, undefined);
  assert.equal(result.statusCode, 404);
  assert.equal(transport.requests.length, 1);
  if (result.execution?.success) {
    assert.equal(result.execution.graphql, undefined);
  }
});

test('explicit @protocol http is HTTP', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol http',
      'POST https://example.test/graphql',
      'Content-Type: application/json',
      '',
      '{"query":"query { user { name } }"}',
    ].join('\n'),
    sourceId: 'http-protocol.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  assert.equal(result.graphqlFailed, undefined);
  if (result.execution?.success) {
    assert.equal(result.execution.graphql, undefined);
  }
});

test('GraphQL query 200 data envelope is orchestrator success', async () => {
  const transport = new FakeTransport();
  const { orchestrator, status } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      '@variable userId=ada',
      graphqlSource().split('\n').slice(2).join('\n'),
    ].join('\n'),
    sourceId: 'gql-success.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  assert.equal(result.graphqlFailed, undefined);
  assert.equal(status.updates.at(-1)?.kind, 'success');
  const payload = JSON.parse(
    new TextDecoder().decode(transport.requests[0]!.body!),
  ) as { query: string; operationName: string; variables: { id: string } };
  assert.match(payload.query, /query GetUser/u);
  assert.equal(payload.operationName, 'GetUser');
  assert.equal(payload.variables.id, 'ada');
});

test('GraphQL mutation document goes through orchestrator and DefaultRequestExecutor', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      'Content-Type: application/json',
      '',
      '{ "query": "mutation UpdateUser($id: ID!) { updateUser(id: $id) { id } }" }',
    ].join('\n'),
    sourceId: 'gql-mutation.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  const payload = JSON.parse(
    new TextDecoder().decode(transport.requests[0]!.body!),
  ) as { query: string };
  assert.match(payload.query, /mutation UpdateUser/u);
});

test('GraphQL variables are substituted by DefaultVariableResolver', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      '@variable userId=resolved-user-id',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query Q($id: ID!) { user(id: $id) { name } }", "variables": { "id": "{{userId}}" } }',
    ].join('\n'),
    sourceId: 'gql-vars.api',
    offset: 0,
  });
  const raw = new TextDecoder().decode(transport.requests[0]!.body!);
  assert.match(raw, /resolved-user-id/u);
  assert.doesNotMatch(raw, /\{\{userId\}\}/u);
});

test('GraphQL HTTP non-success fails the orchestrator outcome', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    statusCode: 500,
    statusText: 'Error',
    body: new TextEncoder().encode('{"data":null}'),
  }));
  const { orchestrator, status } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query { user { name } }" }',
    ].join('\n'),
    sourceId: 'gql-500.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.graphqlFailed, true);
  assert.equal(result.statusCode, 500);
  assert.equal(status.updates.at(-1)?.kind, 'failed');
});

test('GraphQL HTTP 200 with errors is graphqlFailed', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    body: new TextEncoder().encode('{"errors":[{"message":"nope"}]}'),
  }));
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query { user { name } }" }',
    ].join('\n'),
    sourceId: 'gql-errors.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.graphqlFailed, true);
  if (result.execution?.success) {
    assert.equal(result.execution.graphql?.hasErrors, true);
  }
});

test('GraphQL HTTP 200 with non-array errors is graphqlFailed', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    body: new TextEncoder().encode('{"errors":"nope"}'),
  }));
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query { user { name } }" }',
    ].join('\n'),
    sourceId: 'gql-bad-errors.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.graphqlFailed, true);
  if (result.execution?.success) {
    assert.equal(result.execution.graphql?.validEnvelope, false);
  }
});

test('GraphQL HTTP 200 data and errors fails; data remains for extraction', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    body: new TextEncoder().encode(
      '{"data":{"user":{"name":"Ada"}},"errors":[{"message":"partial"}]}',
    ),
  }));
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query { user { name } }" }',
    ].join('\n'),
    sourceId: 'gql-partial.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.graphqlFailed, true);
  if (result.execution?.success) {
    assert.equal(
      (result.execution.response.body.json as { data: { user: { name: string } } })
        .data.user.name,
      'Ada',
    );
    assert.equal(result.execution.graphql?.hasData, true);
    assert.equal(result.execution.graphql?.hasErrors, true);
  }
});

test('GraphQL error messages are scrubbed with existing secret masking', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signaturevaluexx';
  const token = 'sekrit-token-value';
  const apiKey = 'sk-live-not-a-jwt-or-bearer-key';
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    body: new TextEncoder().encode(
      JSON.stringify({
        errors: [
          {
            message: `Unauthorized Bearer ${token} jwt ${jwt} key ${apiKey}`,
          },
          {
            message: 'Cannot query field "foo" on type "Query"',
          },
        ],
      }),
    ),
  }));
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      `@sensitive-variable token=${token}`,
      `@sensitive-variable apiKey=${apiKey}`,
      'POST https://example.test/graphql',
      `Authorization: Bearer ${token}`,
      'X-Api-Key: {{apiKey}}',
      '',
      '{ "query": "query Q($token: String, $apiKey: String) { q }", "variables": { "token": "{{token}}", "apiKey": "{{apiKey}}" } }',
    ].join('\n'),
    sourceId: 'gql-redact.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.execution?.success, true);
  const envelope =
    result.execution?.success === true ? result.execution.graphql : undefined;
  const joined = envelope?.errorMessages.join('\n') ?? '';
  assert.match(joined, /Cannot query field "foo" on type "Query"/u);
  assert.doesNotMatch(joined, new RegExp(token, 'u'));
  assert.doesNotMatch(joined, new RegExp(apiKey, 'u'));
  assert.doesNotMatch(joined, /eyJhbGciOiJIUzI1NiJ9/u);
  assert.match(joined, new RegExp(SECRET_SCRUB_MASK, 'u'));

  const presentation = result.execution
    ? presentExecutionResult(result.execution)
    : undefined;
  const errorSurfaces = JSON.stringify({
    errorMessages: envelope?.errorMessages,
    explanation: presentation?.explanation,
    graphql: presentation?.graphql,
  });
  assert.doesNotMatch(errorSurfaces, new RegExp(token, 'u'));
  assert.doesNotMatch(errorSurfaces, new RegExp(apiKey, 'u'));
  assert.doesNotMatch(errorSurfaces, /eyJhbGciOiJIUzI1NiJ9/u);
  assert.match(
    presentation?.explanation?.facts.join('\n') ?? '',
    /Cannot query field "foo" on type "Query"/u,
  );

  const mcpPayload = redactForMcp({
    graphql: envelope,
    explanation: presentation?.explanation,
    graphqlPresentation: presentation?.graphql,
  });
  assert.doesNotMatch(JSON.stringify(mcpPayload), new RegExp(token, 'u'));
  assert.doesNotMatch(JSON.stringify(mcpPayload), new RegExp(apiKey, 'u'));
  assert.doesNotMatch(JSON.stringify(mcpPayload), /eyJhbGciOiJIUzI1NiJ9/u);
});

test('unknown @protocol is a validation error and never calls transport', async () => {
  const transport = new FakeTransport();
  const { orchestrator, notifications } = createOrchestrator(transport);
  const mqtt = await orchestrator.runAtSourceLocation({
    text: ['@protocol mqtt', 'GET https://example.test/users'].join('\n'),
    sourceId: 'mqtt.api',
    offset: 0,
  });
  assert.equal(mqtt.outcome, 'precondition-failed');
  assert.equal(transport.requests.length, 0);
  assert.match(notifications.messages.join('\n'), /protocol/iu);

  const grpc = await orchestrator.runAtSourceLocation({
    text: ['@protocol grpc', 'GET https://example.test/users'].join('\n'),
    sourceId: 'grpc.api',
    offset: 0,
  });
  assert.equal(grpc.outcome, 'precondition-failed');
  assert.equal(transport.requests.length, 0);
});

test('invalid GraphQL body fails before transport', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      'POST https://example.test/graphql',
      '',
      '{ "foo": 1 }',
    ].join('\n'),
    sourceId: 'gql-invalid.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(transport.requests.length, 0);
  if (result.execution && !result.execution.success) {
    assert.equal(result.execution.error.code, 'UNSUPPORTED_BODY');
  }
});

test('collection containing a GraphQL request executes via the orchestrator port', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const collectionId = 'collection:ws';
  const requestRef: RequestReference = {
    id: 'r1',
    collectionId,
    folderId: undefined,
    filePath: 'file:///ws/gql.api',
    requestIndex: 0,
    method: 'POST',
    url: 'https://example.test/graphql',
    display: { label: 'GetUser' },
    range: {
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 4, line: 0, column: 4 },
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
    '@protocol graphql',
    'POST https://example.test/graphql',
    '',
    '{ "query": "query { user { name } }" }',
  ].join('\n');
  const reader: CollectionRunSourceReader = {
    async readText(): Promise<string> {
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
  const summary = await new CollectionRunnerService({
    executor: port,
    sourceReader: reader,
  }).execute({ plan });
  assert.equal(summary.statistics.passed, 1);
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Passed);
  assert.equal(transport.requests.length, 1);
});

test('mapOrchestratorResult classifies GraphQL errors as Protocol Error', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    body: new TextEncoder().encode('{"errors":[{"message":"nope"}]}'),
  }));
  const { orchestrator } = createOrchestrator(transport);
  const collectionId = 'collection:ws';
  const requestRef: RequestReference = {
    id: 'r1',
    collectionId,
    folderId: undefined,
    filePath: 'file:///ws/gql.api',
    requestIndex: 0,
    method: 'POST',
    url: 'https://example.test/graphql',
    display: { label: 'GetUser' },
    range: {
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 4, line: 0, column: 4 },
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
  const summary = await new CollectionRunnerService({
    executor: {
      runAtSourceLocation(source, options) {
        return orchestrator.runAtSourceLocation(source, options);
      },
    },
    sourceReader: {
      async readText(): Promise<string> {
        return [
          '@protocol graphql',
          'POST https://example.test/graphql',
          '',
          '{ "query": "query { user { name } }" }',
        ].join('\n');
      },
    },
  }).execute({
    plan: buildRunPlan({
      aggregate,
      target: { mode: CollectionRunModes.Collection, collectionId },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
    }),
  });
  assert.equal(summary.results[0]?.outcome, RequestRunOutcomeKinds.Failed);
  assert.equal(
    summary.results[0]?.failureDiagnostics?.category,
    RequestFailureCategories.Protocol,
  );
  assert.match(summary.results[0]?.message ?? '', /Protocol Error/u);
  assert.doesNotMatch(summary.results[0]?.message ?? '', /GraphQL Errors/u);
  assert.match(summary.results[0]?.failureDiagnostics?.reason ?? '', /nope/u);
});

test('GraphQL HTTP 503 is retried like REST; HTTP 200 GraphQL errors are not', async () => {
  const collectionId = 'collection:ws';
  const requestRef: RequestReference = {
    id: 'r1',
    collectionId,
    folderId: undefined,
    filePath: 'file:///ws/gql.api',
    requestIndex: 0,
    method: 'POST',
    url: 'https://example.test/graphql',
    display: { label: 'GetUser' },
    range: {
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 4, line: 0, column: 4 },
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
  const source = [
    '@protocol graphql',
    'POST https://example.test/graphql',
    '',
    '{ "query": "query { user { name } }" }',
  ].join('\n');
  const reader: CollectionRunSourceReader = {
    async readText(): Promise<string> {
      return source;
    },
  };

  let status503Calls = 0;
  const retryTransport = new FakeTransport(async () => {
    status503Calls += 1;
    if (status503Calls === 1) {
      return {
        ...GRAPHQL_DATA,
        statusCode: 503,
        statusText: 'Service Unavailable',
        body: new TextEncoder().encode('{"errors":[{"message":"unavailable"}]}'),
      };
    }
    return GRAPHQL_DATA;
  });
  const { orchestrator: retryOrchestrator } = createOrchestrator(retryTransport);
  const retried = await new CollectionRunnerService({
    executor: {
      runAtSourceLocation(runSource, options) {
        return retryOrchestrator.runAtSourceLocation(runSource, options);
      },
    },
    sourceReader: reader,
  }).execute({
    plan: buildRunPlan({
      aggregate,
      target: { mode: CollectionRunModes.Collection, collectionId },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
      runOptions: {
        retry: { enabled: true, maxRetries: 1, delayMs: 0, backoff: 'fixed' },
      },
    }),
  });
  assert.equal(retryTransport.requests.length, 2);
  assert.equal(retried.results[0]?.outcome, RequestRunOutcomeKinds.Passed);

  const errorsTransport = new FakeTransport(async () => ({
    ...GRAPHQL_DATA,
    body: new TextEncoder().encode('{"errors":[{"message":"nope"}]}'),
  }));
  const { orchestrator: errorsOrchestrator } = createOrchestrator(errorsTransport);
  const notRetried = await new CollectionRunnerService({
    executor: {
      runAtSourceLocation(runSource, options) {
        return errorsOrchestrator.runAtSourceLocation(runSource, options);
      },
    },
    sourceReader: reader,
  }).execute({
    plan: buildRunPlan({
      aggregate,
      target: { mode: CollectionRunModes.Collection, collectionId },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
      runOptions: {
        retry: { enabled: true, maxRetries: 2, delayMs: 0, backoff: 'fixed' },
      },
    }),
  });
  assert.equal(errorsTransport.requests.length, 1);
  assert.equal(notRetried.results[0]?.outcome, RequestRunOutcomeKinds.Failed);
  assert.equal(
    notRetried.results[0]?.failureDiagnostics?.category,
    RequestFailureCategories.Protocol,
  );
});

test('RequestStepRunner delegates GraphQL .api execution to the orchestrator port', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const runner = new RequestStepRunner({
    executor: {
      runAtSourceLocation(source, options) {
        return orchestrator.runAtSourceLocation(source, options);
      },
    },
    sourceReader: {
      async readText(): Promise<string> {
        return [
          '@protocol graphql',
          'POST https://example.test/graphql',
          '',
          '{ "query": "query { user { name } }" }',
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
    name: 'Gql',
    requestId: 'req-1',
    requestFilePath: 'gql.api',
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
  assert.equal(transport.requests.length, 1);
});

test('sensitive GraphQL variables are masked in presentation and MCP paths', async () => {
  const transport = new FakeTransport();
  const { orchestrator } = createOrchestrator(transport);
  const result = await orchestrator.runAtSourceLocation({
    text: [
      '@protocol graphql',
      '@sensitive-variable token=sekrit-token-value',
      'POST https://example.test/graphql',
      '',
      '{ "query": "query Q($token: String!) { q }", "variables": { "token": "{{token}}" } }',
    ].join('\n'),
    sourceId: 'gql-secret.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  const sensitive = result.resolvedVariables?.find((entry) => entry.name === 'token');
  assert.equal(sensitive?.sensitive, true);
  assert.equal(sensitive?.displayValue, MASKED_VARIABLE_VALUE);
  assert.doesNotMatch(JSON.stringify(result.resolvedVariables), /sekrit-token-value/u);

  const rawBody = new TextDecoder().decode(transport.requests[0]!.body!);
  assert.match(rawBody, /sekrit-token-value/u);

  const presentation = result.execution
    ? presentExecutionResult(result.execution)
    : undefined;
  const mcpPayload = redactForMcp({
    variables: { token: 'sekrit-token-value' },
    body: rawBody,
    presentation,
    graphql: result.execution?.success ? result.execution.graphql : undefined,
  });
  assert.doesNotMatch(JSON.stringify(mcpPayload), /sekrit-token-value/u);
});
