import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type ConditionOperator,
  type Scenario,
} from '../models';
import { validateScenario } from './scenario-validator';

describe('scenarios/validation/scenario-validator', () => {
  test('flags invalid condition operators', async () => {
    const conditionOperator = '===' as unknown as ConditionOperator;

    const scenario: Scenario = {
      id: 'sc-1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'vA',
          name: 'varA',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: 'go',
          sensitive: false,
        },
      ],
      steps: [
        {
          id: 'C',
          type: StepType.Condition,
          name: 'If',
          condition: {
            left: '{{scenario.varA}}',
            operator: conditionOperator,
            right: 'go',
          },
          trueBranch: 'connTrue',
          falseBranch: 'connFalse',
        },
        { id: 'T', type: StepType.Delay, name: 'Then', durationMs: 0 },
        { id: 'F', type: StepType.Delay, name: 'Else', durationMs: 0 },
      ],
      connections: [
        { id: 'connTrue', fromStepId: 'C', toStepId: 'T' },
        { id: 'connFalse', fromStepId: 'C', toStepId: 'F' },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const result = await validateScenario(scenario, {
      fileExists: async () => true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'INVALID_CONDITION_EXPRESSION'));
  });

  test('flags invalid retry policies', async () => {
    const scenario: Scenario = {
      id: 'sc-2',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [],
      steps: [
        {
          id: 'R',
          type: StepType.Request,
          name: 'Req',
          requestId: 'req-1',
          requestFilePath: '/tmp/req.api',
          requestOffset: 0,
          inputMappings: [],
          retryPolicy: {
            maxRetries: 1,
            delayMs: 0,
            continueOnFailure: true,
            stopOnFailure: true, // invalid: should be mutually exclusive
          },
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const result = await validateScenario(scenario, {
      fileExists: async () => true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'INVALID_RETRY_POLICY'));
  });

  test('flags missing request files', async () => {
    const scenario: Scenario = {
      id: 'sc-3',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [],
      steps: [
        {
          id: 'R',
          type: StepType.Request,
          name: 'Req',
          requestId: 'req-1',
          requestFilePath: '/tmp/missing.api',
          requestOffset: 0,
          inputMappings: [],
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const result = await validateScenario(scenario, {
      fileExists: async () => false,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'MISSING_REQUEST_FILE'));
  });

  test('flags dangling connections', async () => {
    const scenario: Scenario = {
      id: 'sc-4',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [],
      steps: [{ id: 'A', type: StepType.Delay, name: 'A', durationMs: 0 }],
      connections: [{ id: 'c1', fromStepId: 'A', toStepId: 'Missing' }],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const result = await validateScenario(scenario, {
      fileExists: async () => true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'DANGLING_CONNECTION'));
  });
});

