import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RequestStepRunner } from './request-step-runner';
import {
  ScenarioSchemaVersion,
  StepType,
  type RequestStep,
  type Scenario,
  type RetryPolicy,
  type StepOutput,
} from '../../models';
import type { ScenarioExecutionContext } from '../execution-context';
import type { RunAtSourceLocationResult } from '../../../orchestration';

describe('scenarios/execution/step-runners/request-step-runner', () => {
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

  const makeSleep = (): ((ms: number, signal: AbortSignal) => Promise<void>) => {
    return async () => undefined;
  };

  const createScenario = (): Scenario => ({
    id: 'sc',
    schemaVersion: ScenarioSchemaVersion,
    name: 'Scenario',
    variables: [],
    steps: [],
    connections: [],
    executionSettings: { failurePolicy: 'stop-on-first-error' },
    metadata: { createdAt: 't1', updatedAt: 't2' },
  });

  function createContext(signal: AbortSignal): ScenarioExecutionContext {
    return {
      runId: 'run-1',
      scenario: createScenario(),
      variables: new Map<string, string>(),
      outputs: new Map<string, Map<string, string>>(),
      signal,
      logger,
      timeline: [],
      startTime: 1234,
    };
  }

  const stepBase: Omit<RequestStep, 'retryPolicy' | 'outputs'> = {
    id: 'S1',
    type: StepType.Request,
    name: 'Req',
    requestId: 'req-1',
    requestFilePath: '/tmp/req.api',
    requestOffset: 0,
    inputMappings: [{ variable: 'token', requestVariable: 'token' }],
  };

  test('returns cancelled when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const runner = new RequestStepRunner({
      executor: { runAtSourceLocation: async () => ({ outcome: 'success' }) },
      sourceReader: { readText: async () => '' },
      scenarioVariableResolver: {} as never,
      now: makeNow(),
      sleep: makeSleep(),
    });

    const result = await runner.run(stepBase as RequestStep, createContext(controller.signal));
    assert.equal(result.stepResult.status, 'cancelled');
    assert.equal(result.stepResult.attempt, 0);
  });

  test('retries failed requests and resolves expression outputs', async () => {
    const retryPolicy: RetryPolicy = {
      maxRetries: 1,
      delayMs: 0,
      continueOnFailure: true,
      stopOnFailure: false,
    };

    const outputs: readonly StepOutput[] = [
      { name: 'out1', source: '{{scenario.expr}}', targetVariable: 'outVar' },
    ];

    let calls = 0;
    let lastRequestText = '';
    const runner = new RequestStepRunner({
      executor: {
        runAtSourceLocation: async ({ text }) => {
          lastRequestText = text;
          calls += 1;
          return calls === 1
            ? ({ outcome: 'failed' } as RunAtSourceLocationResult)
            : ({ outcome: 'success' } as RunAtSourceLocationResult);
        },
      },
      sourceReader: { readText: async () => 'token={{token}}' },
      scenarioVariableResolver: {
        resolveScenarioVariable: (name: string): string => {
          assert.equal(name, 'token');
          return 'T0';
        },
        resolveStringTemplate: () => 'OUT_RESOLVED',
      } as never,
      now: makeNow(),
      sleep: makeSleep(),
    });

    const result = await runner.run(
      {
        ...stepBase,
        retryPolicy,
        outputs,
      } as RequestStep,
      createContext(new AbortController().signal),
    );

    assert.equal(calls, 2);
    assert.equal(lastRequestText, 'token=T0');
    assert.equal(result.stepResult.status, 'completed');
    assert.equal(result.stepResult.attempt, 2);
    assert.deepEqual(result.stepResult.outputs, [{ name: 'out1', value: 'OUT_RESOLVED' }]);
    assert.equal(
      (result.stepResult.requestResult as RunAtSourceLocationResult | undefined)?.outcome,
      'success',
    );
  });

  test('returns skipped on precondition-failed', async () => {
    const runner = new RequestStepRunner({
      executor: {
        runAtSourceLocation: async () =>
          ({ outcome: 'precondition-failed' }) as RunAtSourceLocationResult,
      },
      sourceReader: { readText: async () => '' },
      scenarioVariableResolver: {
        resolveScenarioVariable: () => 'X',
        resolveStringTemplate: () => '',
      } as never,
      now: makeNow(),
      sleep: makeSleep(),
    });

    const result = await runner.run(
      {
        ...stepBase,
        retryPolicy: undefined,
        outputs: [],
      } as RequestStep,
      createContext(new AbortController().signal),
    );

    assert.equal(result.stepResult.status, 'skipped');
    assert.equal(result.stepResult.attempt, 1);
    assert.ok(result.stepResult.error?.message.includes('precondition'));
  });
});

