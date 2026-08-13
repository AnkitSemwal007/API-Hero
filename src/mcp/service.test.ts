/**
 * Unit tests for ApiHeroMcpService — injectable fakes, no live HTTP.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ApiFileParseCache,
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
  type ApiFileReader,
  type DiscoveredApiFile,
  type DiscoveredCollectionRoot,
  type WorkspaceScanResult,
  type WorkspaceScanner,
} from '../collections';
import {
  CollectionRunAlreadyActiveError,
  CollectionRunManager,
  CollectionRunnerService,
  CollectionRunStatuses,
  FailurePolicyKinds,
  RequestFailureCategories,
  RequestRunOutcomeKinds,
  buildRunPlan,
  createCollectionRunVariableContext,
  createRunIdentifier,
  freezeRunPlan,
  freezeRunSummary,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
  type RequestRunResult,
} from '../collection-runner';
import type { RunAtSourceLocationResult } from '../orchestration';
import type { VariableDefinition } from '../models';
import type { CollectionVariableStore } from '../variables';
import { DefaultVariableResolver } from '../variables';
import { ApiHeroMcpService } from './service';
import type { ApiHeroMcpServiceDeps } from './service';
import { MCP_SECRET_MASK, redactForMcp } from './redact';
import { projectRunSummary } from './dto';

interface MemoryFile {
  readonly relativePath: string;
  readonly workspaceRootPath: string;
  readonly text: string;
  readonly mtimeMs: number;
}

class MemoryWorkspace implements WorkspaceScanner, ApiFileReader {
  public constructor(
    private folders: { path: string; name: string }[],
    private files: Map<string, MemoryFile>,
    private collectionRoots: DiscoveredCollectionRoot[] = [],
  ) {}

  public scan(): WorkspaceScanResult {
    const apiFiles: DiscoveredApiFile[] = [];
    for (const [path, file] of this.files) {
      if (!file.relativePath.toLowerCase().endsWith('.api')) {
        continue;
      }
      apiFiles.push({
        path,
        relativePath: file.relativePath,
        workspaceRootPath: file.workspaceRootPath,
        mtimeMs: file.mtimeMs,
      });
    }
    return {
      folders: this.folders,
      apiFiles,
      collectionRoots: this.collectionRoots,
      issues: [],
    };
  }

  public readText(path: string): string {
    const file = this.files.get(path);
    if (file === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return file.text;
  }
}

class MemoryVariableStore implements CollectionVariableStore {
  public constructor(
    private readonly byRoot = new Map<string, readonly VariableDefinition[]>(),
  ) {}

  public async load(
    collectionRootPath: string,
  ): Promise<readonly VariableDefinition[]> {
    return this.byRoot.get(collectionRootPath) ?? [];
  }

  public async refresh(
    collectionRootPath: string,
  ): Promise<readonly VariableDefinition[]> {
    return this.load(collectionRootPath);
  }

  public async upsert(): Promise<void> {
    /* no-op fake store */
  }

  public set(
    rootPath: string,
    definitions: readonly VariableDefinition[],
  ): void {
    this.byRoot.set(rootPath, definitions);
  }
}

class FakeExecutor implements CollectionRequestExecutorPort {
  public next: RunAtSourceLocationResult = {
    outcome: 'success',
    durationMs: 12,
    statusCode: 200,
  };

  public calls: Array<{ sourceId: string; offset: number }> = [];
  public throwOnCall: Error | undefined;
  public onCall: (() => void) | undefined;

  public async runAtSourceLocation(
    source: { readonly sourceId: string; readonly offset: number },
  ): Promise<RunAtSourceLocationResult> {
    this.calls.push({ sourceId: source.sourceId, offset: source.offset });
    this.onCall?.();
    if (this.throwOnCall !== undefined) {
      throw this.throwOnCall;
    }
    return this.next;
  }
}

function createHarness(options?: {
  readonly empty?: boolean;
  readonly executor?: FakeExecutor;
  readonly analyzeAndEnrich?: ApiHeroMcpServiceDeps['analyzeAndEnrich'];
}) {
  const ws = '/ws';
  const collectionRoot = `${ws}/Collections/Demo`;
  const helloPath = `${collectionRoot}/hello.api`;
  const failPath = `${collectionRoot}/fail.api`;

  const memory = options?.empty
    ? new MemoryWorkspace([], new Map(), [])
    : new MemoryWorkspace(
        [{ path: ws, name: 'ws' }],
        new Map([
          [
            helloPath,
            {
              relativePath: 'Collections/Demo/hello.api',
              workspaceRootPath: ws,
              text: '@name Hello\n@auth bearer\nGET https://example.test/{{basePath}}/hello\n',
              mtimeMs: 1,
            },
          ],
          [
            failPath,
            {
              relativePath: 'Collections/Demo/fail.api',
              workspaceRootPath: ws,
              text: '@name FailCase\nGET https://example.test/fail\n',
              mtimeMs: 2,
            },
          ],
        ]),
        [
          {
            path: collectionRoot,
            name: 'Demo',
            workspaceRootPath: ws,
            relativePath: 'Collections/Demo',
          },
        ],
      );

  const discovery = new CollectionDiscoveryService({
    scanner: memory,
    reader: memory,
    repository: new InMemoryCollectionRepository(),
    parseCache: new ApiFileParseCache(),
  });
  const sourceReader: CollectionRunSourceReader = {
    readText: async (filePath) => memory.readText(filePath),
  };
  const executor = options?.executor ?? new FakeExecutor();
  const runManager = new CollectionRunManager();
  const runner = new CollectionRunnerService({
    executor,
    sourceReader,
    progress: runManager,
  });
  const variableStore = new MemoryVariableStore();
  variableStore.set(collectionRoot, [
    { name: 'basePath', value: 'v1', scope: 'collection', sensitive: false },
    {
      name: 'apiToken',
      value: 'super-secret-token',
      scope: 'collection',
      sensitive: true,
    },
  ]);
  const collectionRunContext = createCollectionRunVariableContext();
  let activeVars: readonly VariableDefinition[] = [];
  let analyzeAndEnrichCalls = 0;
  const defaultAnalyzeAndEnrich: ApiHeroMcpServiceDeps['analyzeAndEnrich'] =
    async (plan) => {
      analyzeAndEnrichCalls += 1;
      return { ok: true, plan };
    };

  const service = new ApiHeroMcpService({
    workspaceRoot: ws,
    discovery,
    runner,
    runManager,
    executorPort: executor,
    sourceReader,
    collectionVariableStore: variableStore,
    collectionRunContext,
    variableResolver: new DefaultVariableResolver(),
    getExternalVariableDefinitions: () => activeVars,
    fileExists: async () => true,
    getStaticVariableNames: () => new Set(activeVars.map((v) => v.name)),
    setActiveCollectionVariables: (variables) => {
      activeVars = variables;
    },
    preloadCollectionVariables: async (rootPath) => {
      try {
        return await variableStore.load(rootPath);
      } catch {
        return [];
      }
    },
    analyzeAndEnrich: options?.analyzeAndEnrich ?? defaultAnalyzeAndEnrich,
  });

  return {
    service,
    discovery,
    runManager,
    executor,
    collectionRoot,
    helloPath,
    failPath,
    getActiveVars: () => activeVars,
    getAnalyzeAndEnrichCalls: () => analyzeAndEnrichCalls,
  };
}

describe('ApiHeroMcpService', () => {
  test('1. listCollections returns discovered collections', async () => {
    const { service } = createHarness();
    const result = await service.listCollections();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.collections.length, 1);
    assert.equal(result.data.collections[0]?.name, 'Demo');
    assert.equal(result.data.collections[0]?.requestCount, 2);
  });

  test('2. getCollection returns folders, masked vars, auth metadata', async () => {
    const { service } = createHarness();
    const result = await service.getCollection('demo');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.name, 'Demo');
    assert.equal(result.data.variables.length, 2);
    const token = result.data.variables.find((v) => v.name === 'apiToken');
    assert.equal(token?.sensitive, true);
    assert.equal(token?.value, MCP_SECRET_MASK);
    assert.equal(token?.value.includes('super-secret'), false);
  });

  test('3. listRequests returns method/url/label', async () => {
    const { service } = createHarness();
    const result = await service.listRequests('Demo');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.requests.length, 2);
    const hello = result.data.requests.find((r) => r.label === 'Hello');
    assert.ok(hello);
    assert.equal(hello.method, 'GET');
    assert.match(hello.url, /example\.test/);
  });

  test('4. getRequest returns auth metadata and variable refs', async () => {
    const { service } = createHarness();
    const result = await service.getRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.auth.configured, true);
    assert.equal(result.data.auth.type, 'bearer');
    assert.ok(
      result.data.variableRefs.some((ref) => ref.name === 'basePath'),
    );
  });

  test('5. runRequest uses executor port and returns structured result', async () => {
    const { service, executor } = createHarness();
    const result = await service.runRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(executor.calls.length, 1);
    assert.equal(result.data.status, 'passed');
    assert.equal(result.data.httpStatus, 200);
  });

  test('6. runCollection executes via runner and returns summary', async () => {
    const { service, getAnalyzeAndEnrichCalls } = createHarness();
    const result = await service.runCollection('Demo');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.collection, 'Demo');
    assert.equal(result.data.total, 2);
    assert.ok(result.data.runId.length > 0);
    assert.equal(result.data.passed, 2);
    assert.equal(getAnalyzeAndEnrichCalls(), 1);
  });

  test('6b. runCollection maps analyzeAndEnrich failure to DEPENDENCY_ENRICH_FAILED', async () => {
    const message =
      'Dependency cycle detected: Login → Get User → Login';
    const { service } = createHarness({
      analyzeAndEnrich: async () => ({
        ok: false,
        code: 'DEPENDENCY_CYCLE',
        message,
      }),
    });
    const result = await service.runCollection('Demo');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'DEPENDENCY_ENRICH_FAILED');
    assert.equal(result.error.message, message);
  });

  test('7. getRun retrieves a prior run summary', async () => {
    const { service } = createHarness();
    const run = await service.runCollection('Demo');
    assert.equal(run.ok, true);
    if (!run.ok) return;
    const again = await service.getRun(run.data.runId);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(
      'runId' in again.data && again.data.runId,
      run.data.runId,
    );
  });

  test('8. failed request diagnostics are preserved', async () => {
    const executor = new FakeExecutor();
    executor.next = {
      outcome: 'failed',
      durationMs: 5,
      statusCode: 500,
      message: 'Server error',
      execution: {
        success: false,
        requestId: 'r1',
        request: { method: 'GET', url: 'https://example.test/fail' },
        error: {
          code: 'NETWORK',
          message: 'Server error',
          retryable: true,
        },
        timing: {
          startedAt: '2020-01-01T00:00:00.000Z',
          completedAt: '2020-01-01T00:00:00.005Z',
          durationMs: 5,
        },
      },
    };
    const { service } = createHarness({ executor });
    const result = await service.runRequest({
      collection: 'Demo',
      request: 'FailCase',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, 'failed');
    assert.equal(result.data.failureDiagnostics?.category, 'transport');
    assert.equal(result.data.failureDiagnostics?.httpRequestSent, true);
  });

  test('9. assertion failure includes expected/actual from presentation', async () => {
    const summary = freezeRunSummary({
      runId: 'run_assert',
      plan: freezeRunPlan({
        runId: 'run_assert',
        mode: 'collection',
        collectionId: 'c1',
        collectionName: 'Demo',
        failurePolicy: FailurePolicyKinds.ContinueOnError,
        requests: [],
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
      results: [
        {
          requestId: 'req1',
          ordinal: 0,
          label: 'Assert',
          outcome: RequestRunOutcomeKinds.Failed,
          statusCode: 200,
          assertionsPassed: 0,
          assertionsFailed: 1,
          assertionsTotal: 1,
          failureDiagnostics: {
            category: RequestFailureCategories.Assertion,
            reason: 'Assertion Failed',
            httpRequestSent: true,
            failedAtStage: 'assertions',
          },
          presentation: {
            success: true,
            requestId: 'req1',
            method: 'GET',
            requestUrl: 'https://example.test',
            headers: [],
            cookies: { available: false, setCookieHeaderCount: 0 },
            statistics: {
              durationMs: 1,
              startedAt: '2020-01-01T00:00:00.000Z',
              completedAt: '2020-01-01T00:00:00.001Z',
              headerCount: 0,
              redirected: false,
              redirectCount: 0,
            },
            summary: '200',
            assertions: {
              summary: {
                total: 1,
                passed: 0,
                failed: 1,
                skipped: 0,
                malformed: 0,
                passPercent: 0,
                durationMs: 0,
              },
              assertions: [
                {
                  text: 'expect status == 201',
                  outcome: 'failed',
                  failure: {
                    assertionText: 'expect status == 201',
                    expected: '201',
                    actual: '200',
                    reason: 'mismatch',
                  },
                },
              ],
            },
          },
        } satisfies RequestRunResult,
      ],
      statistics: {
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        cancelled: 0,
        durationMs: 1,
        averageResponseTimeMs: 1,
        assertionsPassed: 0,
        assertionsFailed: 1,
        assertionsTotal: 1,
        preconditionFailures: 0,
        transportFailures: 0,
        assertionFailures: 1,
        extractionFailures: 0,
        protocolFailures: 0,
      },
      completedAt: '2020-01-01T00:00:01.000Z',
      status: CollectionRunStatuses.Completed,
    });
    const projected = projectRunSummary(summary);
    assert.equal(projected.requests[0]?.assertions?.expected, '201');
    assert.equal(projected.requests[0]?.assertions?.actual, '200');
    assert.equal(
      projected.requests[0]?.failureDiagnostics?.category,
      'assertion',
    );
  });

  test('10. validation/precondition failure surfaces failedAtStage', async () => {
    const executor = new FakeExecutor();
    executor.next = {
      outcome: 'precondition-failed',
      message: 'Request validation failed.',
      preconditionStage: 'validate',
    };
    const { service } = createHarness({ executor });
    const result = await service.runRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, 'failed');
    assert.equal(result.data.failureDiagnostics?.category, 'precondition');
    assert.equal(result.data.failureDiagnostics?.failedAtStage, 'validate');
    assert.equal(result.data.failureDiagnostics?.httpRequestSent, false);
  });

  test('11. variable resolution failure is a precondition stage', async () => {
    const executor = new FakeExecutor();
    executor.next = {
      outcome: 'precondition-failed',
      message: 'Unresolved variable {{missing}}.',
      preconditionStage: 'variables',
    };
    const { service } = createHarness({ executor });
    const result = await service.runRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.failureDiagnostics?.failedAtStage, 'variables');
  });

  test('12. authentication failure is a precondition stage', async () => {
    const executor = new FakeExecutor();
    executor.next = {
      outcome: 'precondition-failed',
      message: 'Authentication secret is unavailable in headless MCP.',
      preconditionStage: 'authentication',
    };
    const { service } = createHarness({ executor });
    const result = await service.runRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.data.failureDiagnostics?.failedAtStage,
      'authentication',
    );
  });

  test('runRequest maps blocking extraction failure to failed', async () => {
    const executor = new FakeExecutor();
    executor.next = {
      outcome: 'success',
      durationMs: 3,
      statusCode: 200,
      extraction: {
        outcomes: [
          {
            rule: {
              id: 'e1',
              variableName: 'token',
              source: { kind: 'json-path', path: '$.accessToken' },
              targetScope: 'run',
              sensitive: true,
              required: true,
              enabled: true,
              when: { kind: 'always' },
            },
            kind: 'failed',
            reason: 'Path not found.',
          },
        ],
        extractedCount: 0,
        failedCount: 1,
        skippedCount: 0,
        malformedCount: 0,
      },
    };
    const { service } = createHarness({ executor });
    const result = await service.runRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, 'failed');
    assert.equal(result.data.failureDiagnostics?.category, 'extraction');
    assert.equal(result.data.failureDiagnostics?.failedAtStage, 'extraction');
  });

  test('runRequest primes collection variables during execution and clears after', async () => {
    const executor = new FakeExecutor();
    let seenDuringCall: readonly VariableDefinition[] = [];
    const harness = createHarness({ executor });
    executor.onCall = () => {
      seenDuringCall = harness.getActiveVars();
    };
    const result = await harness.service.runRequest({
      collection: 'Demo',
      request: 'Hello',
    });
    assert.equal(result.ok, true);
    assert.ok(seenDuringCall.some((variable) => variable.name === 'basePath'));
    assert.ok(seenDuringCall.some((variable) => variable.name === 'apiToken'));
    assert.equal(harness.getActiveVars().length, 0);
  });

  test('runRequest clears active collection variables after executor failure', async () => {
    const executor = new FakeExecutor();
    executor.throwOnCall = new Error('transport boom');
    const harness = createHarness({ executor });
    await assert.rejects(
      () =>
        harness.service.runRequest({
          collection: 'Demo',
          request: 'Hello',
        }),
      /transport boom/,
    );
    assert.equal(harness.getActiveVars().length, 0);
  });

  test('13. secret redaction strips bearer tokens from tool JSON', () => {
    const payload = {
      headers: [
        { name: 'Authorization', value: 'Bearer live-token-value-xyz' },
        { name: 'Accept', value: 'application/json' },
      ],
      body: 'Authorization: Bearer live-token-value-xyz',
      password: 'hunter2',
    };
    const redacted = redactForMcp(payload);
    const text = JSON.stringify(redacted);
    assert.equal(text.includes('live-token-value-xyz'), false);
    assert.equal(text.includes('hunter2'), false);
    assert.equal(redacted.password, MCP_SECRET_MASK);
  });

  test('14. empty workspace returns EMPTY_WORKSPACE', async () => {
    const { service } = createHarness({ empty: true });
    const result = await service.listCollections();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'EMPTY_WORKSPACE');
  });

  test('15. collection not found', async () => {
    const { service } = createHarness();
    const result = await service.getCollection('Missing');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'COLLECTION_NOT_FOUND');
  });

  test('16. request not found', async () => {
    const { service } = createHarness();
    const result = await service.getRequest({
      collection: 'Demo',
      request: 'Nope',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'REQUEST_NOT_FOUND');
  });

  test('17. concurrent/duplicate runs return RUN_ALREADY_ACTIVE', async () => {
    const { service, runManager, discovery } = createHarness();
    const aggregate = await discovery.refresh();
    const collection = Object.values(aggregate.collections)[0]!;
    const plan = buildRunPlan({
      aggregate,
      target: { mode: 'collection', collectionId: collection.id },
      failurePolicy: FailurePolicyKinds.ContinueOnError,
      runId: createRunIdentifier(1, () => 0.1),
    });
    runManager.begin({ plan });
    const result = await service.runCollection('Demo');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'RUN_ALREADY_ACTIVE');
    assert.match(result.error.message, /already active/i);
    assert.ok(CollectionRunAlreadyActiveError);
  });

  test('getRequestResult finds by label after a run', async () => {
    const { service } = createHarness();
    const run = await service.runCollection('Demo');
    assert.equal(run.ok, true);
    if (!run.ok) return;
    const one = await service.getRequestResult(run.data.runId, 'Hello');
    assert.equal(one.ok, true);
    if (!one.ok) return;
    assert.equal(one.data.label, 'Hello');
  });
});
