import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type Scenario,
} from '../models';
import {
  findUnboundRequestSteps,
  formatUnboundRequestGuidance,
  isUnboundRequestStep,
} from './scenario-request-binding';

function requestScenario(
  overrides: Partial<{
    requestId: string;
    requestRef: string;
    requestFilePath: string;
    requestOffset: number;
  }> = {},
): Scenario {
  return {
    id: 'sid',
    schemaVersion: ScenarioSchemaVersion,
    name: 'Demo',
    variables: [],
    steps: [
      {
        id: 'R1',
        type: StepType.Request,
        name: 'Login',
        requestId: overrides.requestId ?? 'pending:Login',
        requestFilePath: overrides.requestFilePath ?? '',
        requestOffset: overrides.requestOffset ?? 0,
        requestRef: overrides.requestRef ?? 'Login',
        inputMappings: [],
      },
    ],
    connections: [],
    executionSettings: { failurePolicy: 'stop-on-first-error' },
    metadata: { createdAt: 't1', updatedAt: 't2' },
  };
}

describe('scenario-request-binding', () => {
  test('pending requestId is unbound', () => {
    const scenario = requestScenario();
    const step = scenario.steps[0];
    assert.ok(step && step.type === StepType.Request);
    assert.equal(isUnboundRequestStep(step), true);
    assert.equal(findUnboundRequestSteps(scenario).length, 1);
  });

  test('bound file path clears unbound when catalog empty', () => {
    const scenario = requestScenario({
      requestId: 'req-1',
      requestFilePath: '/workspace/api.api',
      requestOffset: 12,
    });
    const step = scenario.steps[0];
    assert.ok(step && step.type === StepType.Request);
    assert.equal(isUnboundRequestStep(step, []), false);
  });

  test('empty filePath is unbound even with non-pending requestId', () => {
    const scenario = requestScenario({
      requestId: 'req-handwritten',
      requestFilePath: '',
      requestRef: '',
    });
    const step = scenario.steps[0];
    assert.ok(step && step.type === StepType.Request);
    assert.equal(isUnboundRequestStep(step, []), true);
  });

  test('unknown requestRef with catalog is unbound', () => {
    const scenario = requestScenario({
      requestId: 'req-1',
      requestFilePath: '',
      requestRef: 'Missing',
    });
    const step = scenario.steps[0];
    assert.ok(step && step.type === StepType.Request);
    assert.equal(
      isUnboundRequestStep(step, [
        {
          requestId: 'other',
          name: 'Login',
          folderPath: '',
          filePath: '/a.api',
          requestOffset: 0,
        },
      ]),
      true,
    );
  });

  test('catalog-resolvable requestRef with empty path is bound', () => {
    const scenario = requestScenario({
      requestId: 'req-1',
      requestFilePath: '',
      requestRef: 'Login',
    });
    const step = scenario.steps[0];
    assert.ok(step && step.type === StepType.Request);
    assert.equal(
      isUnboundRequestStep(step, [
        {
          requestId: 'req-1',
          name: 'Login',
          folderPath: '',
          filePath: '/a.api',
          requestOffset: 0,
        },
      ]),
      false,
    );
  });

  test('formatUnboundRequestGuidance names steps', () => {
    const msg = formatUnboundRequestGuidance([
      { stepId: 'R1', name: 'Login', requestRef: 'Login' },
    ]);
    assert.match(msg, /Bind 1 request step/u);
    assert.match(msg, /Login/u);
    assert.match(msg, /Choose Request/u);
  });

  test('non-request steps are ignored', () => {
    const scenario: Scenario = {
      id: 'sid',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Demo',
      variables: [
        {
          id: 'v1',
          name: 'x',
          scope: ScenarioVariableScope.Scenario,
          sensitive: false,
        },
      ],
      steps: [{ id: 'D1', type: StepType.Delay, name: 'Start', durationMs: 0 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };
    assert.equal(findUnboundRequestSteps(scenario).length, 0);
  });
});
