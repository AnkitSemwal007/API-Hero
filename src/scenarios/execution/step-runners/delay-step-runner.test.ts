import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DelayStepRunner } from './delay-step-runner';
import { ScenarioSchemaVersion, ScenarioVariableScope, StepType } from '../../models';
import type { DelayStep, Scenario } from '../../models';
import type { ScenarioExecutionContext } from '../execution-context';

describe('scenarios/execution/step-runners/delay-step-runner', () => {
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

  test('returns completed when not cancelled', async () => {
    const now = makeNow();
    const runner = new DelayStepRunner({
      now,
      sleep: async () => undefined,
    });

    const step: DelayStep = { id: 'D', type: StepType.Delay, name: 'Delay', durationMs: 10 };
    const controller = new AbortController();
    const context = makeContext(controller.signal, now);

    const result = await runner.run(step, context);
    assert.equal(result.stepResult.status, 'completed');
    assert.equal(result.stepResult.attempt, 1);
  });

  test('returns cancelled when aborted before run', async () => {
    const now = makeNow();
    const runner = new DelayStepRunner({
      now,
      sleep: async () => undefined,
    });

    const step: DelayStep = { id: 'D', type: StepType.Delay, name: 'Delay', durationMs: 10 };
    const controller = new AbortController();
    controller.abort();
    const context = makeContext(controller.signal, now);

    const result = await runner.run(step, context);
    assert.equal(result.stepResult.status, 'cancelled');
    assert.equal(result.stepResult.attempt, 0);
    assert.equal(result.stepResult.durationMs, 0);
  });

  test('returns cancelled when aborted during sleep', async () => {
    const now = makeNow();
    const runner = new DelayStepRunner({
      now,
      sleep: (ms: number, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(), ms);
          const onAbort = (): void => {
            clearTimeout(t);
            reject(new Error('aborted'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }),
    });

    const step: DelayStep = { id: 'D', type: StepType.Delay, name: 'Delay', durationMs: 50 };
    const controller = new AbortController();
    const context = makeContext(controller.signal, now);

    setTimeout(() => controller.abort(), 5);
    const result = await runner.run(step, context);

    assert.equal(result.stepResult.status, 'cancelled');
    assert.equal(result.stepResult.attempt, 0);
  });
});

