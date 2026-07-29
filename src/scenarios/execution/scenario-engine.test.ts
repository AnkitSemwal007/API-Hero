import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioEventEmitter,
  ScenarioEventType,
} from '../events/scenario-events';
import {
  ScenarioEngine,
} from './scenario-engine';
import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type Scenario,
  type RetryPolicy,
} from '../models';

describe('scenarios/execution/scenario-engine', () => {
  const logger = {
    info: () => undefined,
    warning: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  const makeSleep = (): ((ms: number, signal: AbortSignal) => Promise<void>) => {
    return (ms, signal) =>
      new Promise((resolve, reject) => {
        if (ms <= 0) {
          resolve();
          return;
        }
        const t = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = (): void => {
          clearTimeout(t);
          reject(new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
  };

  const makeNow = () => {
    let t = 1000;
    return () => {
      t += 1;
      return t;
    };
  };

  const makeExternalVariableResolver = () =>
    ({
      analyze: () => ({
        values: new Map<string, { value: string }>(),
        errors: [],
      }),
      resolveRequest: () => ({
        success: true,
        request: undefined,
        values: new Map(),
      }),
    }) as never;

  test('activates only the chosen branch for condition steps', async () => {
    const scenario: Scenario = {
      id: 'sc-1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'vA',
          name: 'varA',
          scope: ScenarioVariableScope.Scenario,
          sensitive: false,
        },
      ],
      steps: [
        {
          id: 'V1',
          type: StepType.Variable,
          name: 'SetA',
          assignments: [{ name: 'varA', value: 'go' }],
        },
        {
          id: 'C1',
          type: StepType.Condition,
          name: 'IfGo',
          condition: { left: '{{scenario.varA}}', operator: '==', right: 'go' },
          trueBranch: 'connT',
          falseBranch: 'connF',
        },
        { id: 'DT', type: StepType.Delay, name: 'TrueDelay', durationMs: 0 },
        { id: 'DF', type: StepType.Delay, name: 'FalseDelay', durationMs: 0 },
      ],
      connections: [
        { id: 'c1', fromStepId: 'V1', toStepId: 'C1' },
        { id: 'connT', fromStepId: 'C1', toStepId: 'DT' },
        { id: 'connF', fromStepId: 'C1', toStepId: 'DF' },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const eventEmitter = new ScenarioEventEmitter();
    const skipped: string[] = [];
    eventEmitter.onStepSkipped((e) => skipped.push(e.stepId));

    const engine = new ScenarioEngine({
      executor: { runAtSourceLocation: async () => ({ outcome: 'success' }) },
      sourceReader: { readText: async () => '' },
      externalVariableResolver: makeExternalVariableResolver(),
      externalVariableDefinitions: [],
      fileExists: async () => true,
      logger,
      eventEmitter,
      now: makeNow(),
      sleep: makeSleep(),
    });

    const result = await engine.runScenario(scenario, { signal: new AbortController().signal });
    assert.equal(result.run.status, 'completed');
    assert.equal(result.run.variables.get('varA'), 'go');

    const trueDelay = result.run.stepResults.find((s) => s.stepId === 'DT');
    const falseDelay = result.run.stepResults.find((s) => s.stepId === 'DF');
    assert.equal(trueDelay?.status, 'completed');
    assert.equal(falseDelay?.status, 'skipped');
    assert.ok(skipped.includes('DF'));
  });

  test('retries request steps according to retry policy', async () => {
    const retryPolicy: RetryPolicy = {
      maxRetries: 1,
      delayMs: 0,
      continueOnFailure: true,
      stopOnFailure: false,
    };

    const scenario: Scenario = {
      id: 'sc-2',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'vToken',
          name: 'token',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: 'T0',
          sensitive: false,
        },
      ],
      steps: [
        {
          id: 'R1',
          type: StepType.Request,
          name: 'Req',
          requestId: 'req-1',
          requestFilePath: '/tmp/req.api',
          requestOffset: 0,
          inputMappings: [{ variable: 'token', requestVariable: 'token' }],
          retryPolicy,
          outputs: [],
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    let calls = 0;
    const events: { readonly type: string; readonly payload: unknown }[] = [];

    const eventEmitter = new ScenarioEventEmitter();
    eventEmitter.onStepRetried((e) => events.push({ type: ScenarioEventType.StepRetried, payload: e }));

    const engine = new ScenarioEngine({
      executor: {
        runAtSourceLocation: async () => {
          calls += 1;
          return calls === 1 ? { outcome: 'failed' } : { outcome: 'success' };
        },
      },
      sourceReader: { readText: async () => 'token={{token}}' },
      externalVariableResolver: makeExternalVariableResolver(),
      externalVariableDefinitions: [],
      fileExists: async () => true,
      logger,
      eventEmitter,
      now: makeNow(),
      sleep: makeSleep(),
    });

    const result = await engine.runScenario(scenario, { signal: new AbortController().signal });
    assert.equal(result.run.status, 'completed');
    assert.equal(calls, 2);

    const retried = events.filter((e) => e.type === ScenarioEventType.StepRetried);
    assert.equal(retried.length, 1);
    const stepResult = result.run.stepResults[0]!;
    assert.equal(stepResult.status, 'completed');
    assert.equal(stepResult.attempt, 2);
  });

  test('sets run status cancelled when aborting during delay', async () => {
    const abort = new AbortController();
    const sleep = makeSleep();

    const scenario: Scenario = {
      id: 'sc-3',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [],
      steps: [{ id: 'D1', type: StepType.Delay, name: 'Wait', durationMs: 50 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const engine = new ScenarioEngine({
      executor: { runAtSourceLocation: async () => ({ outcome: 'success' }) },
      sourceReader: { readText: async () => '' },
      externalVariableResolver: makeExternalVariableResolver(),
      externalVariableDefinitions: [],
      fileExists: async () => true,
      logger,
      now: makeNow(),
      sleep: async (ms: number, signal: AbortSignal) => {
        const p = sleep(ms, signal);
        setTimeout(() => abort.abort(), 5);
        return p;
      },
    });

    const resultPromise = engine.runScenario(scenario, { signal: abort.signal });
    const result = await resultPromise;
    assert.equal(result.run.status, 'cancelled');

    const step = result.run.stepResults[0]!;
    assert.equal(step.status, 'cancelled');
  });
});

