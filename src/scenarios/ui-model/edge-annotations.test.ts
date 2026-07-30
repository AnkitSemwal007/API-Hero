import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioSchemaVersion,
  StepType,
  type Scenario,
} from '../models';
import { buildScenarioEdgeAnnotations } from './edge-annotations';

describe('scenarios/ui-model/edge-annotations', () => {
  test('labels condition true/false branches and variable handoff', () => {
    const scenario: Scenario = {
      id: 's1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Demo',
      variables: [],
      steps: [
        {
          id: 'V1',
          type: StepType.Variable,
          name: 'Map Token',
          assignments: [{ name: 'token', value: 'x' }],
        },
        {
          id: 'R1',
          type: StepType.Request,
          name: 'Next',
          requestId: 'pending:Next',
          requestFilePath: '',
          requestOffset: 0,
          requestRef: 'Next',
          inputMappings: [],
        },
        {
          id: 'C1',
          type: StepType.Condition,
          name: 'Ok?',
          expression: 'statusCode == 200',
          trueBranch: 'ct',
          falseBranch: 'cf',
        },
        { id: 'D1', type: StepType.Delay, name: 'Ok', durationMs: 0 },
        { id: 'D2', type: StepType.Delay, name: 'Fail', durationMs: 0 },
      ],
      connections: [
        { id: 'c1', fromStepId: 'V1', toStepId: 'R1' },
        { id: 'ct', fromStepId: 'C1', toStepId: 'D1' },
        { id: 'cf', fromStepId: 'C1', toStepId: 'D2' },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const annotations = buildScenarioEdgeAnnotations(scenario);
    assert.equal(
      annotations.find((a) => a.connectionId === 'ct')?.label,
      'True',
    );
    assert.equal(
      annotations.find((a) => a.connectionId === 'cf')?.label,
      'False',
    );
    assert.equal(
      annotations.find((a) => a.connectionId === 'c1')?.label,
      'token → next',
    );
  });
});
