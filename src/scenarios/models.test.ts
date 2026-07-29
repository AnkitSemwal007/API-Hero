import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createConnectionId,
  createScenarioId,
  createScenarioRunId,
  createStepId,
  freezeScenario,
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
} from './models';
import type { Scenario } from './models';

describe('scenarios/models', () => {
  test('creates UUID-like identifiers', () => {
    const scenarioId = createScenarioId();
    const stepId = createStepId();
    const connectionId = createConnectionId();
    const runId = createScenarioRunId();

    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
    assert.match(scenarioId, uuidLike);
    assert.match(stepId, uuidLike);
    assert.match(connectionId, uuidLike);
    assert.match(runId, uuidLike);
  });

  test('freezeScenario deep-freezes the entire structure', () => {
    const scenario: Scenario = {
      id: 'scenario-1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'var-1',
          name: 'varA',
          scope: ScenarioVariableScope.Scenario,
          sensitive: false,
        },
      ],
      steps: [
        {
          id: 'step-1',
          type: StepType.Delay,
          name: 'Delay',
          durationMs: 0,
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const frozen = freezeScenario(scenario);

    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (frozen as any).name = 'changed';
    });

    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (frozen.variables as any).push({
        id: 'var-2',
        name: 'varB',
        scope: ScenarioVariableScope.Scenario,
        sensitive: false,
      });
    });
  });
});

