/**
 * Focused tests for apihero_run_scenario — temp workspace + fake executor.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  ApiFileParseCache,
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
  NodeApiFileReader,
  NodeWorkspaceScanner,
} from '../collections';
import {
  CollectionRunManager,
  CollectionRunnerService,
  createCollectionRunVariableContext,
  type CollectionRequestExecutorPort,
} from '../collection-runner';
import type { RunAtSourceLocationResult } from '../orchestration';
import {
  ScenarioSchemaVersion,
  ScenarioStorageService,
  ScenarioVariableScope,
  StepType,
  scenariosRootPath,
  type Scenario,
} from '../scenarios';
import { DefaultVariableResolver, MASKED_VARIABLE_VALUE } from '../variables';
import { MCP_SECRET_MASK } from './redact';
import { ApiHeroMcpService } from './service';
import { registerApiHeroMcpTools } from './tools';

class FakeExecutor implements CollectionRequestExecutorPort {
  public next: RunAtSourceLocationResult = {
    outcome: 'success',
    durationMs: 5,
    statusCode: 200,
  };
  public failOnce = false;
  private calls = 0;

  public async runAtSourceLocation(): Promise<RunAtSourceLocationResult> {
    this.calls += 1;
    if (this.failOnce && this.calls === 1) {
      return { outcome: 'failed', durationMs: 3, message: 'upstream failed' };
    }
    return this.next;
  }
}

async function writeWorkspace(root: string): Promise<{
  readonly loginPath: string;
  readonly getUserPath: string;
}> {
  const collectionRoot = path.join(root, 'Collections', 'Demo');
  await mkdir(collectionRoot, { recursive: true });
  const loginPath = path.join(collectionRoot, 'login.api');
  const getUserPath = path.join(collectionRoot, 'get-user.api');
  await writeFile(
    loginPath,
    '@name Login\nGET https://example.test/login\n',
    'utf8',
  );
  await writeFile(
    getUserPath,
    '@name Get User\nGET https://example.test/user\n',
    'utf8',
  );

  const scenariosRoot = scenariosRootPath(root);
  await mkdir(scenariosRoot, { recursive: true });

  const storage = new ScenarioStorageService();
  const checkout: Scenario = {
    id: 'sc-checkout',
    schemaVersion: ScenarioSchemaVersion,
    name: 'checkout',
    variables: [
      {
        id: 'v-token',
        name: 'apiToken',
        scope: ScenarioVariableScope.Scenario,
        defaultValue: 'sekrit-token-value',
        sensitive: true,
      },
      {
        id: 'v-auth',
        name: 'authHeader',
        scope: ScenarioVariableScope.Scenario,
        defaultValue: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def',
        sensitive: false,
      },
    ],
    steps: [
      {
        id: 'R1',
        type: StepType.Request,
        name: 'Login',
        requestId: 'login-req',
        requestFilePath: loginPath,
        requestOffset: 0,
        requestRef: 'Login',
        inputMappings: [],
        outputs: [],
      },
      {
        id: 'R2',
        type: StepType.Request,
        name: 'Get User',
        requestId: 'get-user-req',
        requestFilePath: getUserPath,
        requestOffset: 0,
        requestRef: 'Get User',
        inputMappings: [],
        outputs: [],
      },
    ],
    connections: [
      { id: 'c1', fromStepId: 'R1', toStepId: 'R2' },
    ],
    executionSettings: { failurePolicy: 'stop-on-first-error' },
    metadata: { createdAt: 't1', updatedAt: 't2' },
  };
  const saved = await storage.save(
    checkout,
    path.join(scenariosRoot, 'checkout.scenario.json'),
  );
  assert.equal(saved.ok, true, 'scenario save should succeed');

  return { loginPath, getUserPath };
}

function createService(
  workspaceRoot: string,
  executor: CollectionRequestExecutorPort,
): ApiHeroMcpService {
  const discovery = new CollectionDiscoveryService({
    scanner: new NodeWorkspaceScanner({ workspaceRoot }),
    reader: new NodeApiFileReader(),
    repository: new InMemoryCollectionRepository(),
    parseCache: new ApiFileParseCache(),
  });
  const sourceReader = {
    readText: async (filePath: string) => {
      const { promises: fs } = await import('node:fs');
      return fs.readFile(filePath, 'utf8');
    },
  };
  const runManager = new CollectionRunManager();
  const runner = new CollectionRunnerService({
    executor,
    sourceReader,
    progress: runManager,
  });
  const collectionRunContext = createCollectionRunVariableContext();

  return new ApiHeroMcpService({
    workspaceRoot,
    discovery,
    runner,
    runManager,
    executorPort: executor,
    sourceReader,
    collectionVariableStore: {
      load: async () => [],
      refresh: async () => [],
      upsert: async () => undefined,
    },
    collectionRunContext,
    variableResolver: new DefaultVariableResolver(),
    getExternalVariableDefinitions: () => [],
    fileExists: async (filePath) => {
      const { promises: fs } = await import('node:fs');
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    getStaticVariableNames: () => new Set(),
    setActiveCollectionVariables: () => undefined,
    preloadCollectionVariables: async () => [],
    analyzeAndEnrich: async (plan) => ({ ok: true, plan }),
  });
}

describe('apihero_run_scenario', () => {
  let workspaceRoot = '';
  let executor: FakeExecutor;
  let service: ApiHeroMcpService;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'apihero-mcp-scenario-'));
    await writeWorkspace(workspaceRoot);
    executor = new FakeExecutor();
    service = createService(workspaceRoot, executor);
  });

  after(async () => {
    if (workspaceRoot.length > 0) {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('does not register apihero_run_scenario; collection tools remain', () => {
    const registered: string[] = [];
    const server = {
      registerTool: (name: string) => {
        registered.push(name);
      },
    };
    registerApiHeroMcpTools(server as never, service);
    assert.equal(registered.includes('apihero_run_scenario'), false);
    assert.ok(registered.includes('apihero_run_collection'));
  });

  test('missing scenario returns SCENARIO_NOT_FOUND', async () => {
    const result = await service.runScenario({ scenario: 'does-not-exist' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'SCENARIO_NOT_FOUND');
    assert.match(result.error.message, /does-not-exist/);
  });

  test('successful multi-step scenario returns completed report', async () => {
    executor.next = { outcome: 'success', durationMs: 4, statusCode: 200 };
    executor.failOnce = false;
    const result = await service.runScenario({ scenario: 'checkout' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, 'completed');
    assert.equal(result.data.scenarioName, 'checkout');
    assert.equal(result.data.statistics.total, 2);
    assert.equal(result.data.statistics.completed, 2);
    assert.equal(result.data.steps.length, 2);
    assert.equal(result.data.steps[0]?.status, 'completed');
    assert.equal(result.data.steps[1]?.status, 'completed');
  });

  test('failed step marks scenario failed and skips downstream', async () => {
    executor.failOnce = true;
    executor.next = { outcome: 'success', durationMs: 4, statusCode: 200 };
    // Reset call counter via new executor instance wired into a fresh service
    const failExecutor = new FakeExecutor();
    failExecutor.failOnce = true;
    const failService = createService(workspaceRoot, failExecutor);
    const result = await failService.runScenario({ scenario: 'checkout' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, 'failed');
    const login = result.data.steps.find((s) => s.stepId === 'R1');
    const getUser = result.data.steps.find((s) => s.stepId === 'R2');
    assert.equal(login?.status, 'failed');
    assert.equal(getUser?.status, 'skipped');
  });

  test('sensitive scenario variables are masked in the report', async () => {
    executor.failOnce = false;
    const result = await service.runScenario({ scenario: 'checkout' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const token = result.data.variables.find((v) => v.name === 'apiToken');
    assert.ok(token);
    assert.equal(token!.sensitive, true);
    assert.equal(token!.value, MASKED_VARIABLE_VALUE);
    assert.equal(token!.displayValue, MASKED_VARIABLE_VALUE);
    assert.doesNotMatch(JSON.stringify(result.data), /sekrit-token-value/);
  });

  test('Authorization / Bearer strings are redactForMcp masked', async () => {
    executor.failOnce = false;
    const result = await service.runScenario({ scenario: 'checkout' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const auth = result.data.variables.find((v) => v.name === 'authHeader');
    assert.ok(auth);
    // mcpOk → redactForMcp masks Bearer token material (keeps "Bearer " prefix)
    assert.match(auth!.value, /^Bearer\s+/u);
    assert.ok(auth!.value.includes(MCP_SECRET_MASK));
    assert.doesNotMatch(JSON.stringify(result.data), /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/u);
  });

  test('optional inputs override known variable defaults', async () => {
    executor.failOnce = false;
    const result = await service.runScenario({
      scenario: 'checkout',
      inputs: {
        authHeader: 'plain-override',
        unknownKey: 'ignored',
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const auth = result.data.variables.find((v) => v.name === 'authHeader');
    assert.ok(auth);
    assert.equal(auth!.value, 'plain-override');
  });

  test('runCollection still works (regression)', async () => {
    const result = await service.runCollection('Demo');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.collection, 'Demo');
    assert.ok(result.data.total >= 1);
  });

  test('concurrent scenario run returns RUN_ALREADY_ACTIVE', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowExecutor: CollectionRequestExecutorPort = {
      async runAtSourceLocation(): Promise<RunAtSourceLocationResult> {
        await gate;
        return { outcome: 'success', durationMs: 1, statusCode: 200 };
      },
    };
    const slowService = createService(workspaceRoot, slowExecutor);
    const first = slowService.runScenario({ scenario: 'checkout' });
    // Yield so first acquires the MCP lock before the second call.
    await new Promise((r) => setTimeout(r, 20));
    const second = await slowService.runScenario({ scenario: 'checkout' });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.error.code, 'RUN_ALREADY_ACTIVE');
    }
    release();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
  });

  test('unbound request step returns SCENARIO_UNBOUND with MCP guidance', async () => {
    const storage = new ScenarioStorageService();
    const scenariosRoot = scenariosRootPath(workspaceRoot);
    const unboundScenario: Scenario = {
      id: 'sc-unbound',
      schemaVersion: ScenarioSchemaVersion,
      name: 'unbound-demo',
      variables: [],
      steps: [
        {
          id: 'R1',
          type: StepType.Request,
          name: 'Ghost',
          requestId: 'pending:Ghost',
          requestFilePath: '',
          requestOffset: 0,
          requestRef: 'GhostDoesNotExist',
          inputMappings: [],
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't', updatedAt: 't' },
    };
    const saved = await storage.save(
      unboundScenario,
      path.join(scenariosRoot, 'unbound-demo.scenario.json'),
    );
    assert.equal(saved.ok, true);
    const result = await service.runScenario({ scenario: 'unbound-demo' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'SCENARIO_UNBOUND');
    assert.match(result.error.message, /requestRef/u);
    assert.doesNotMatch(result.error.message, /Scenario Editor/u);
  });
});
