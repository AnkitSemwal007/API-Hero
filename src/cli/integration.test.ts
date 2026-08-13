/**
 * CLI integration — temp workspace, local HTTP, no vscode.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { WebSocketServer } from 'ws';

import { PROJECT_STORE_SCHEMA_VERSION } from '../project-store';
import {
  ScenarioSchemaVersion,
  ScenarioStorageService,
  ScenarioVariableScope,
  StepType,
  scenariosRootPath,
  type Scenario,
} from '../scenarios';
import {
  EXIT_CONFIG,
  EXIT_EXECUTION_FAILURE,
  EXIT_SUCCESS,
  EXIT_USAGE,
} from './exit-codes';
import { parseCliArgs } from './parse-args';
import { executeCliRun } from './run';
import { main } from './main';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

describe('cli integration', () => {
  let root = '';
  let server: Server;
  let port = 0;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'apihero-cli-'));
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/fail') {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('bad');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    port = await listen(server);

    const collectionRoot = path.join(root, 'Collections', 'Demo');
    await mkdir(collectionRoot, { recursive: true });
    const helloPath = path.join(collectionRoot, 'hello.api');
    const failPath = path.join(collectionRoot, 'fail.api');
    await writeFile(
      helloPath,
      `@name Hello\nGET {{baseUrl}}/ok\n`,
      'utf8',
    );
    await writeFile(
      failPath,
      `@name FailCase\nGET {{baseUrl}}/fail\nexpect status == 201\n`,
      'utf8',
    );

    const apihero = path.join(root, '.apihero');
    await mkdir(path.join(apihero, 'environments'), { recursive: true });
    await mkdir(path.join(apihero, 'auth'), { recursive: true });
    await writeFile(
      path.join(apihero, 'config.json'),
      `${JSON.stringify(
        {
          schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
          projectId: 'cli-test',
          collectionsDirectory: 'Collections',
        },
        undefined,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      path.join(apihero, 'workspace.json'),
      `${JSON.stringify(
        {
          schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
          activeEnvironmentId: 'env-local',
          variables: [],
        },
        undefined,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      path.join(apihero, 'environments', 'local.json'),
      `${JSON.stringify(
        {
          id: 'env-local',
          name: 'local',
          variables: [
            { name: 'baseUrl', value: `http://127.0.0.1:${port}` },
          ],
        },
        undefined,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      path.join(apihero, 'auth', 'profiles.json'),
      `${JSON.stringify(
        {
          schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
          profiles: [],
        },
        undefined,
        2,
      )}\n`,
      'utf8',
    );

    const scenariosRoot = scenariosRootPath(root);
    await mkdir(scenariosRoot, { recursive: true });
    const storage = new ScenarioStorageService();

    // Use pending ids so resolveScenarioRequestSteps rebinds catalog offsets.
    const checkout: Scenario = {
      id: 'sc-checkout',
      schemaVersion: ScenarioSchemaVersion,
      name: 'checkout',
      variables: [],
      steps: [
        {
          id: 'R1',
          type: StepType.Request,
          name: 'Login',
          requestId: 'pending:login',
          requestFilePath: '',
          requestOffset: 0,
          requestRef: 'FailCase',
          inputMappings: [],
          outputs: [],
        },
        {
          id: 'R2',
          type: StepType.Request,
          name: 'Payment',
          requestId: 'pending:pay',
          requestFilePath: '',
          requestOffset: 0,
          requestRef: 'Hello',
          inputMappings: [],
          outputs: [],
        },
      ],
      connections: [{ id: 'c1', fromStepId: 'R1', toStepId: 'R2' }],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };
    const savedCheckout = await storage.save(
      checkout,
      path.join(scenariosRoot, 'checkout.scenario.json'),
    );
    assert.equal(savedCheckout.ok, true);

    const okFlow: Scenario = {
      id: 'sc-ok',
      schemaVersion: ScenarioSchemaVersion,
      name: 'ok-flow',
      variables: [
        {
          id: 'v1',
          name: 'secretToken',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: 'super-secret-cli-token',
          sensitive: true,
        },
      ],
      steps: [
        {
          id: 'R1',
          type: StepType.Request,
          name: 'Login',
          requestId: 'pending:login',
          requestFilePath: '',
          requestOffset: 0,
          requestRef: 'Hello',
          inputMappings: [],
          outputs: [],
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };
    const savedOk = await storage.save(
      okFlow,
      path.join(scenariosRoot, 'ok.scenario.json'),
    );
    assert.equal(savedOk.ok, true);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  test('usage errors exit 2', async () => {
    assert.equal(await main(['run', 'request']), EXIT_USAGE);
    assert.equal(await main(['run', 'nope', 'x']), EXIT_USAGE);
  });

  test('help exits 0', async () => {
    assert.equal(await main(['--help']), 0);
    assert.equal(await main(['run', '--help']), 0);
  });

  test('unknown collection → 3', async () => {
    const parsed = parseCliArgs([
      'run',
      'collection',
      'Missing',
      '--workspace',
      root,
    ]);
    assert.equal(parsed.kind, 'run');
    if (parsed.kind !== 'run') return;
    const result = await executeCliRun(parsed);
    assert.equal(result.exitCode, EXIT_CONFIG);
  });

  test('unknown environment → 3', async () => {
    const parsed = parseCliArgs([
      'run',
      'request',
      'Hello',
      '--workspace',
      root,
      '--environment',
      'staging',
    ]);
    assert.equal(parsed.kind, 'run');
    if (parsed.kind !== 'run') return;
    const result = await executeCliRun(parsed);
    assert.equal(result.exitCode, EXIT_CONFIG);
    assert.match(result.stderr + result.stdout, /Unknown environment "staging"/);
  });

  test('valid environment loads from ProjectStore', async () => {
    const parsed = parseCliArgs([
      'run',
      'request',
      'Hello',
      '--workspace',
      root,
      '--environment',
      'local',
      '--json',
    ]);
    assert.equal(parsed.kind, 'run');
    if (parsed.kind !== 'run') return;
    const result = await executeCliRun(parsed);
    assert.equal(result.exitCode, EXIT_SUCCESS);
    const envelope = JSON.parse(result.stdout) as { ok: boolean };
    assert.equal(envelope.ok, true);
  });

  test('request success → 0; assertion failure → 1', async () => {
    const ok = await executeCliRun({
      kind: 'run',
      targetType: 'request',
      target: 'Hello',
      workspace: root,
      json: true,
      quiet: false,
      verbose: false,
    });
    assert.equal(ok.exitCode, EXIT_SUCCESS);

    const fail = await executeCliRun({
      kind: 'run',
      targetType: 'request',
      target: 'FailCase',
      workspace: root,
      json: false,
      quiet: false,
      verbose: false,
    });
    assert.equal(fail.exitCode, EXIT_EXECUTION_FAILURE);
    assert.match(fail.stdout, /FAILED/);
  });

  test('scenario failure skips dependents; secrets redacted', async () => {
    const failed = await executeCliRun({
      kind: 'run',
      targetType: 'scenario',
      target: 'checkout',
      workspace: root,
      json: false,
      quiet: false,
      verbose: false,
    });
    assert.equal(failed.exitCode, EXIT_EXECUTION_FAILURE);
    assert.match(failed.stdout, /FAILED/);
    assert.match(failed.stdout, /Login/);
    assert.match(failed.stdout, /Payment|○|skipped/i);

    const ok = await executeCliRun({
      kind: 'run',
      targetType: 'scenario',
      target: 'ok-flow',
      workspace: root,
      json: true,
      quiet: false,
      verbose: false,
    });
    assert.equal(ok.exitCode, EXIT_SUCCESS);
    assert.equal(ok.stdout.includes('super-secret-cli-token'), false);
  });

  test('WebSocket uses existing run request/collection/scenario commands', async () => {
    const httpServer: Server = createServer();
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (socket) => {
      socket.on('message', (data, isBinary) => {
        if (!isBinary) {
          socket.send(data.toString());
        }
      });
    });
    const silent: Server = createServer();
    const silentWss = new WebSocketServer({ server: silent });
    silentWss.on('connection', (socket) => {
      socket.on('message', () => undefined);
    });
    const wsPort = await listen(httpServer);
    const silentPort = await listen(silent);
    try {
      const socketsRoot = path.join(root, 'Collections', 'Sockets');
      await mkdir(socketsRoot, { recursive: true });
      await writeFile(
        path.join(socketsRoot, 'echo.api'),
        [
          '@name EchoWs',
          '@protocol websocket',
          `@variable wsUrl=ws://127.0.0.1:${wsPort}`,
          'GET {{wsUrl}}',
          'Authorization: Bearer super-secret-ws-cli',
          '',
          '{"type":"ping"}',
          '',
          'expect body.type == "ping"',
        ].join('\n'),
        'utf8',
      );
      const hangRoot = path.join(root, 'Collections', 'Hang');
      await mkdir(hangRoot, { recursive: true });
      await writeFile(
        path.join(hangRoot, 'hang.api'),
        [
          '@name HangWs',
          '@protocol websocket',
          '@timeout 80',
          `@variable wsUrl=ws://127.0.0.1:${silentPort}`,
          'GET {{wsUrl}}',
          '',
          '{"type":"ping"}',
        ].join('\n'),
        'utf8',
      );

      assert.equal(
        parseCliArgs(['run', 'request', 'EchoWs', '--websocket']).kind,
        'error',
      );

      const json = await executeCliRun({
        kind: 'run',
        targetType: 'request',
        target: 'EchoWs',
        workspace: root,
        json: true,
        quiet: false,
        verbose: false,
      });
      assert.equal(json.exitCode, EXIT_SUCCESS);
      assert.doesNotMatch(json.stdout, /super-secret-ws-cli/u);
      assert.doesNotMatch(json.stdout, /"httpStatus":\s*0/u);
      const envelope = JSON.parse(json.stdout) as {
        ok: boolean;
        data?: {
          httpStatus?: number;
          response?: { summary?: string; status?: { code?: number } };
        };
      };
      assert.equal(envelope.ok, true);
      assert.equal(envelope.data?.httpStatus, undefined);
      assert.equal(envelope.data?.response?.status, undefined);
      assert.match(envelope.data?.response?.summary ?? '', /WebSocket received/u);

      const human = await executeCliRun({
        kind: 'run',
        targetType: 'request',
        target: 'EchoWs',
        workspace: root,
        json: false,
        quiet: false,
        verbose: false,
      });
      assert.equal(human.exitCode, EXIT_SUCCESS);
      assert.match(human.stdout, /PASSED/u);
      assert.doesNotMatch(human.stdout, /super-secret-ws-cli/u);

      const quiet = await executeCliRun({
        kind: 'run',
        targetType: 'request',
        target: 'EchoWs',
        workspace: root,
        json: false,
        quiet: true,
        verbose: false,
      });
      assert.equal(quiet.exitCode, EXIT_SUCCESS);
      assert.match(quiet.stdout, /PASSED/u);

      const verbose = await executeCliRun({
        kind: 'run',
        targetType: 'request',
        target: 'EchoWs',
        workspace: root,
        json: false,
        quiet: false,
        verbose: true,
      });
      assert.equal(verbose.exitCode, EXIT_SUCCESS);
      assert.doesNotMatch(
        `${verbose.stdout}${verbose.stderr}`,
        /super-secret-ws-cli/u,
      );

      const collection = await executeCliRun({
        kind: 'run',
        targetType: 'collection',
        target: 'Sockets',
        workspace: root,
        json: true,
        quiet: false,
        verbose: false,
      });
      assert.equal(collection.exitCode, EXIT_SUCCESS);
      const collectionEnvelope = JSON.parse(collection.stdout) as {
        ok: boolean;
        data?: { passed?: number; failed?: number };
      };
      assert.equal(collectionEnvelope.ok, true);
      assert.equal(collectionEnvelope.data?.passed, 1);
      assert.equal(collectionEnvelope.data?.failed, 0);

      const timeout = await executeCliRun({
        kind: 'run',
        targetType: 'request',
        target: 'HangWs',
        workspace: root,
        json: true,
        quiet: false,
        verbose: false,
      });
      assert.equal(timeout.exitCode, EXIT_EXECUTION_FAILURE);

      const scenariosRoot = scenariosRootPath(root);
      const storage = new ScenarioStorageService();
      const wsFlow: Scenario = {
        id: 'sc-ws',
        schemaVersion: ScenarioSchemaVersion,
        name: 'ws-flow',
        variables: [],
        steps: [
          {
            id: 'R1',
            type: StepType.Request,
            name: 'Echo',
            requestId: 'pending:echo',
            requestFilePath: '',
            requestOffset: 0,
            requestRef: 'EchoWs',
            inputMappings: [],
            outputs: [],
          },
        ],
        connections: [],
        executionSettings: { failurePolicy: 'stop-on-first-error' },
        metadata: { createdAt: 't1', updatedAt: 't2' },
      };
      const saved = await storage.save(
        wsFlow,
        path.join(scenariosRoot, 'ws.scenario.json'),
      );
      assert.equal(saved.ok, true);
      const scenario = await executeCliRun({
        kind: 'run',
        targetType: 'scenario',
        target: 'ws-flow',
        workspace: root,
        json: true,
        quiet: false,
        verbose: false,
      });
      assert.equal(scenario.exitCode, EXIT_SUCCESS);
      assert.doesNotMatch(scenario.stdout, /super-secret-ws-cli/u);
    } finally {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        silentWss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        silent.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('headless composition runs without vscode module', async () => {
    const { createHeadlessApiHeroRuntime } = await import('../headless/index.js');
    const runtime = await createHeadlessApiHeroRuntime({
      workspaceRoot: root,
    });
    assert.ok(runtime.environmentManager);
    assert.equal(
      Object.keys(require.cache).some((key) => /[/\\]vscode[/\\]|[/\\]vscode\.js$/u.test(key)),
      false,
    );
  });
});
