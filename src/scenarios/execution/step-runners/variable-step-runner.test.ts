import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { VariableStepRunner } from './variable-step-runner';
import { ScenarioSchemaVersion, ScenarioVariableScope, StepType } from '../../models';
import type { Scenario, VariableStep } from '../../models';
import type { ScenarioExecutionContext } from '../execution-context';

describe('scenarios/execution/step-runners/variable-step-runner', () => {
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
      variables: new Map(),
      outputs: new Map(),
      signal,
      logger,
      timeline: [],
      startTime: now(),
    };
  }

  test('assigns variables and resolves step outputs', async () => {
    const now = makeNow();
    const runner = new VariableStepRunner({
      now,
      scenarioVariableResolver: {
        resolveStringTemplate: (template: string) => {
          if (template.includes('scenario.input')) return 'resolvedA';
          if (template.includes('scenario.outExpr')) return 'resolvedOut1';
          return template;
        },
      } as never,
    });

    const step: VariableStep = {
      id: 'V1',
      type: StepType.Variable,
      name: 'Vars',
      assignments: [
        { name: 'varA', value: '{{scenario.input}}' },
        { name: 'varB', value: 'plainB' },
      ],
      outputs: [
        { name: 'out1', source: '{{scenario.outExpr}}', targetVariable: 'outVar' },
        { name: 'out2', source: 'staticValue' },
      ],
    };

    const controller = new AbortController();
    const context = makeContext(controller.signal, now);
    const result = await runner.run(step, context);

    assert.equal(result.stepResult.status, 'completed');
    assert.equal(result.stepResult.attempt, 1);
    assert.equal(context.variables.get('varA'), 'resolvedA');
    assert.equal(context.variables.get('varB'), 'plainB');
    assert.equal(context.variables.get('outVar'), 'resolvedOut1');

    const stepOutputs = context.outputs.get('V1');
    assert.notEqual(stepOutputs, undefined);
    assert.equal(stepOutputs?.get('out1'), 'resolvedOut1');
    assert.equal(stepOutputs?.get('out2'), 'staticValue');

    assert.deepEqual(result.stepResult.outputs, [
      { name: 'out1', value: 'resolvedOut1' },
      { name: 'out2', value: 'staticValue' },
    ]);
  });
});

