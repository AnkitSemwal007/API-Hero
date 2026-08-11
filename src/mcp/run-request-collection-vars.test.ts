/**
 * Regression: runRequest must prime collection variables via the shared
 * headless composition cache channel, clear active vars in finally, and not
 * leak into later scenario runs on a long-lived process.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { PROJECT_STORE_SCHEMA_VERSION } from '../project-store';
import {
  ScenarioSchemaVersion,
  ScenarioStorageService,
  StepType,
  scenariosRootPath,
  type Scenario,
} from '../scenarios';
import { COLLECTION_VARIABLES_SCHEMA_VERSION } from '../variables';
import { createHeadlessApiHeroRuntime } from '../headless';
import { ApiHeroMcpService } from './service';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

describe('runRequest collection variable wiring', () => {
  let root = '';
  let server: Server;
  let port = 0;
  let seenPaths: string[] = [];

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'apihero-req-vars-'));
    seenPaths = [];
    server = createServer((req, res) => {
      seenPaths.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    port = await listen(server);

    const collectionRoot = path.join(root, 'Collections', 'Demo');
    await mkdir(collectionRoot, { recursive: true });
    await writeFile(
      path.join(collectionRoot, 'hello.api'),
      `@name Hello\nGET {{baseUrl}}/{{basePath}}/hello\n`,
      'utf8',
    );
    await writeFile(
      path.join(collectionRoot, 'api-hero.variables.json'),
      `${JSON.stringify(
        {
          schemaVersion: COLLECTION_VARIABLES_SCHEMA_VERSION,
          variables: [
            {
              name: 'baseUrl',
              value: `http://127.0.0.1:${port}`,
              sensitive: false,
            },
            { name: 'basePath', value: 'v1', sensitive: false },
          ],
        },
        undefined,
        2,
      )}\n`,
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
          projectId: 'req-vars',
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
          variables: [],
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
    const ping: Scenario = {
      id: 'sc-ping',
      schemaVersion: ScenarioSchemaVersion,
      name: 'ping',
      variables: [],
      steps: [
        {
          id: 'R1',
          type: StepType.Request,
          name: 'Hello',
          requestId: 'pending:hello',
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
    const saved = await storage.save(
      ping,
      path.join(scenariosRoot, 'ping.scenario.json'),
    );
    assert.equal(saved.ok, true);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (root.length > 0) {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('runRequest resolves collection variables into the HTTP URL', async () => {
    seenPaths = [];
    const runtime = await createHeadlessApiHeroRuntime({ workspaceRoot: root });
    const service = ApiHeroMcpService.fromRuntime(runtime);
    const result = await service.runRequest({ request: 'Hello' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(
      result.data.status === 'passed' || result.data.status === 'success',
      `unexpected status ${result.data.status}: ${result.data.message ?? ''}`,
    );
    assert.ok(
      seenPaths.some((entry) => entry === '/v1/hello'),
      `expected /v1/hello, got ${JSON.stringify(seenPaths)}`,
    );
    assert.equal(runtime.getExternalVariableDefinitions().length, 0);
  });

  test('sequential runRequest then scenario clears leaked active vars', async () => {
    seenPaths = [];
    const runtime = await createHeadlessApiHeroRuntime({ workspaceRoot: root });
    const service = ApiHeroMcpService.fromRuntime(runtime);

    const first = await service.runRequest({ request: 'Hello' });
    assert.equal(first.ok, true);
    assert.equal(runtime.getExternalVariableDefinitions().length, 0);

    // Simulate a stale long-lived MCP process leak before scenario starts.
    runtime.setActiveCollectionVariables([
      {
        name: 'leakedFromPriorRequest',
        value: 'should-not-appear',
        scope: 'collection',
        sensitive: false,
      },
    ]);
    assert.ok(
      runtime
        .getExternalVariableDefinitions()
        .some((variable) => variable.name === 'leakedFromPriorRequest'),
    );

    const scenario = await service.runScenario({ scenario: 'ping' });
    assert.equal(scenario.ok, true);
    if (!scenario.ok) return;
    assert.notEqual(scenario.data.status, 'failed');
    assert.equal(
      scenario.data.variables.some(
        (variable) => variable.name === 'leakedFromPriorRequest',
      ),
      false,
    );
    assert.equal(
      runtime
        .getExternalVariableDefinitions()
        .some((variable) => variable.name === 'leakedFromPriorRequest'),
      false,
    );
  });

  test('failed runRequest still clears active collection variables', async () => {
    const collectionRoot = path.join(root, 'Collections', 'Demo');
    await writeFile(
      path.join(collectionRoot, 'boom.api'),
      `@name Boom\nGET {{baseUrl}}/{{basePath}}/missing-assert\nexpect status == 201\n`,
      'utf8',
    );

    const runtime = await createHeadlessApiHeroRuntime({ workspaceRoot: root });
    const service = ApiHeroMcpService.fromRuntime(runtime);
    const result = await service.runRequest({ request: 'Boom' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(result.data.status, 'passed');
    assert.notEqual(result.data.status, 'success');
    assert.equal(runtime.getExternalVariableDefinitions().length, 0);
  });
});
