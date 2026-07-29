import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { join } from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { ScenarioSchemaVersion, ScenarioVariableScope, StepType, type Scenario } from '../models';
import { ScenarioStorageService } from './scenario-storage';

describe('scenarios/storage/scenario-storage', () => {
  test('saves then loads a scenario', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-'));
    const filePath = join(root, 'a.scenario.json');

    const scenario: Scenario = {
      id: 'sid',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario A',
      variables: [
        { id: 'v1', name: 'varA', scope: ScenarioVariableScope.Scenario, sensitive: false },
      ],
      steps: [{ id: 'D1', type: StepType.Delay, name: 'Delay', durationMs: 0 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const service = new ScenarioStorageService();
    const saved = await service.save(scenario, filePath);
    assert.equal(saved.ok, true);

    const loaded = await service.load(filePath);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.scenario.name, 'Scenario A');
    assert.equal(loaded.scenario.schemaVersion, ScenarioSchemaVersion);
    assert.equal(loaded.scenario.id, 'sid');
  });

  test('rejects invalid schemaVersion on load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-b-'));
    const filePath = join(root, 'bad.scenario.json');

    await writeFile(
      filePath,
      JSON.stringify(
        {
          schemaVersion: '0.0.0',
          steps: [],
          connections: [],
          variables: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    const service = new ScenarioStorageService();
    const loaded = await service.load(filePath);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error.code, 'INVALID_SCHEMA_VERSION');
  });

  test('discovers valid scenarios recursively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-hero-scenarios-c-'));
    const nested = join(root, 'nested');
    await mkdir(nested, { recursive: true });

    await writeFile(
      join(root, 'a.scenario.json'),
      JSON.stringify(
        {
          schemaVersion: ScenarioSchemaVersion,
          id: 'sidA',
          name: 'A',
          variables: [],
          steps: [{ id: 'D1', type: StepType.Delay, name: 'Delay', durationMs: 0 }],
          connections: [],
          executionSettings: { failurePolicy: 'stop-on-first-error' },
          metadata: { createdAt: 't1', updatedAt: 't2' },
        },
        null,
        2,
      ),
      'utf8',
    );

    await writeFile(
      join(nested, 'b.scenario.json'),
      JSON.stringify(
        {
          schemaVersion: ScenarioSchemaVersion,
          id: 'sidB',
          name: 'B',
          variables: [],
          steps: [{ id: 'D2', type: StepType.Delay, name: 'Delay', durationMs: 0 }],
          connections: [],
          executionSettings: { failurePolicy: 'stop-on-first-error' },
          metadata: { createdAt: 't1', updatedAt: 't2' },
        },
        null,
        2,
      ),
      'utf8',
    );

    // invalid schema, still discoverable as file but not as scenario
    await writeFile(
      join(root, 'invalid.scenario.json'),
      JSON.stringify({ schemaVersion: '0.0.0', steps: [], connections: [], variables: [] }, null, 2),
      'utf8',
    );

    const service = new ScenarioStorageService();
    const discovered = await service.discover(root);

    assert.equal(discovered.ok, true);
    assert.equal(discovered.scenarios.length, 2);
    assert.equal(discovered.files.length, 3);
  });
});

