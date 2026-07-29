import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ConditionStepRunner } from './condition-step-runner';
import { ScenarioSchemaVersion, ScenarioVariableScope, StepType } from '../../models';
import type { ConditionStep, Scenario, ConditionOperator } from '../../models';
import type { ScenarioExecutionContext } from '../execution-context';

describe('scenarios/execution/step-runners/condition-step-runner', () => {
  const logger = {
    info: () => undefined,
    warning: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  const makeNow = () => {
    let t = 1000;
    return () => {
      t += 1;
      return t;
    };
  };

  function makeScenario(): Scenario {
    return {
      id: 'sc',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        { id: 'v1', name: 'x', scope: ScenarioVariableScope.Scenario, sensitive: false },
      ],
      steps: [],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };
  }

  function makeContext(signal: AbortSignal, now: () => number): ScenarioExecutionContext {
    return {
      runId: 'run-1',
      scenario: makeScenario(),
      variables: new Map([['lhs', '10'], ['rhs', '2'], ['text', 'hello']]),
      outputs: new Map(),
      signal,
      logger,
      timeline: [],
      startTime: now(),
    };
  }

  test('chooses the true branch for numeric comparison', async () => {
    const now = makeNow();
    const runner = new ConditionStepRunner({
      now,
      scenarioVariableResolver: {
        resolveStringTemplate: (template: string) => {
          if (template.includes('lhs')) return '10';
          if (template.includes('rhs')) return '2';
          return '';
        },
      } as never,
    });

    const step: ConditionStep = {
      id: 'C',
      type: StepType.Condition,
      name: 'If',
      condition: {
        left: '{{scenario.lhs}}',
        operator: '>' as unknown as ConditionOperator,
        right: '{{scenario.rhs}}',
      },
      trueBranch: 'connTrue',
      falseBranch: 'connFalse',
    };

    const controller = new AbortController();
    const result = await runner.run(step, makeContext(controller.signal, now));
    assert.equal(result.stepResult.status, 'completed');
    assert.deepEqual(result.nextConnectionIds, ['connTrue']);
  });

  test('chooses the true branch for contains operator', async () => {
    const now = makeNow();
    const runner = new ConditionStepRunner({
      now,
      scenarioVariableResolver: {
        resolveStringTemplate: (template: string) => {
          if (template.includes('text')) return 'hello world';
          if (template.includes('needle')) return 'hello';
          return '';
        },
      } as never,
    });

    const step: ConditionStep = {
      id: 'C2',
      type: StepType.Condition,
      name: 'Contains',
      condition: {
        left: '{{scenario.text}}',
        operator: 'contains' as unknown as ConditionOperator,
        right: '{{scenario.needle}}',
      },
      trueBranch: 'connTrue',
      falseBranch: 'connFalse',
    };

    const controller = new AbortController();
    const result = await runner.run(step, makeContext(controller.signal, now));
    assert.equal(result.stepResult.status, 'completed');
    assert.deepEqual(result.nextConnectionIds, ['connTrue']);
  });

  test('returns failed when condition evaluation throws', async () => {
    const now = makeNow();
    const runner = new ConditionStepRunner({
      now,
      scenarioVariableResolver: {
        resolveStringTemplate: () => {
          throw new Error('boom');
        },
      } as never,
    });

    const step: ConditionStep = {
      id: 'C3',
      type: StepType.Condition,
      name: 'If',
      condition: {
        left: '{{scenario.lhs}}',
        operator: '==' as unknown as ConditionOperator,
        right: 'x',
      },
      trueBranch: 'connTrue',
      falseBranch: 'connFalse',
    };

    const controller = new AbortController();
    const result = await runner.run(step, makeContext(controller.signal, now));
    assert.equal(result.stepResult.status, 'failed');
    assert.equal(result.stepResult.error?.message, 'Condition evaluation failed.');
  });
});

