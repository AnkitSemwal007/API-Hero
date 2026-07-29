import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeScenario } from './scenario-serializer';
import { ScenarioSchemaVersion, ScenarioVariableScope, StepType, type Scenario } from '../models';

describe('scenarios/serialization/scenario-serializer', () => {
  test('serializes schemaVersion first and sorts steps/connections by id', () => {
    const scenario: Scenario = {
      id: 'sc-1',
      schemaVersion: '0.0.0', // serializer overrides to current version
      name: 'Scenario',
      variables: [
        { id: 'v1', name: 'varA', scope: ScenarioVariableScope.Scenario, sensitive: false },
      ],
      steps: [
        { id: 'S2', type: StepType.Delay, name: 'Two', durationMs: 0 },
        { id: 'S1', type: StepType.Delay, name: 'One', durationMs: 0 },
      ],
      connections: [
        { id: 'c2', fromStepId: 'S1', toStepId: 'S2' },
        { id: 'c1', fromStepId: 'S2', toStepId: 'S1' },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const text = serializeScenario(scenario);
    assert.ok(text.endsWith('\n'));
    assert.match(text, /^\{\n {2}"schemaVersion": "1\.0\.0",/u);

    const parsed = JSON.parse(text) as {
      readonly schemaVersion: string;
      readonly steps: readonly { readonly id: string }[];
      readonly connections: readonly { readonly id: string }[];
    };

    assert.equal(parsed.schemaVersion, ScenarioSchemaVersion);
    assert.deepEqual(
      parsed.steps.map((s) => s.id),
      ['S1', 'S2'],
    );
    assert.deepEqual(
      parsed.connections.map((c) => c.id),
      ['c1', 'c2'],
    );
  });
});

