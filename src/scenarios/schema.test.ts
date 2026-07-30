import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseScenarioDocument } from './schema';
import { serializeScenario } from './serialization/scenario-serializer';
import { ScenarioSchemaVersion, StepType } from './models';

describe('scenarios/schema', () => {
  test('parses a minimal valid scenario', () => {
    const text = JSON.stringify({
      schemaVersion: ScenarioSchemaVersion,
      id: 'sc-1',
      name: 'Demo',
      variables: [],
      steps: [
        {
          id: 'd1',
          type: StepType.Delay,
          name: 'Wait',
          durationMs: 0,
        },
      ],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    });
    const result = parseScenarioDocument(text);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.scenario.name, 'Demo');
      assert.equal(result.scenario.steps.length, 1);
    }
  });

  test('accepts condition expression strings', () => {
    const text = JSON.stringify({
      schemaVersion: ScenarioSchemaVersion,
      id: 'sc-2',
      name: 'Cond',
      variables: [],
      steps: [
        {
          id: 'c1',
          type: StepType.Condition,
          name: 'If',
          expression: 'statusCode == 200 && {{ok}} == true',
          trueBranch: 't',
          falseBranch: 'f',
        },
        { id: 'd1', type: StepType.Delay, name: 'Then', durationMs: 0 },
        { id: 'd2', type: StepType.Delay, name: 'Else', durationMs: 0 },
      ],
      connections: [
        { id: 't', fromStepId: 'c1', toStepId: 'd1' },
        { id: 'f', fromStepId: 'c1', toStepId: 'd2' },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    });
    const result = parseScenarioDocument(text);
    assert.equal(result.ok, true);
  });

  test('retains step retryPolicy, outputs, and connection.condition', () => {
    const text = JSON.stringify({
      schemaVersion: ScenarioSchemaVersion,
      id: 'sc-retain',
      name: 'Retain',
      variables: [],
      steps: [
        {
          id: 'r1',
          type: StepType.Request,
          name: 'Req',
          requestId: 'req-1',
          requestFilePath: 'a.api',
          requestOffset: 0,
          inputMappings: [],
          retryPolicy: {
            maxRetries: 2,
            delayMs: 100,
            continueOnFailure: false,
            stopOnFailure: true,
          },
          outputs: [
            { name: 'status', source: 'status' },
            {
              name: 'token',
              source: 'body.token',
              targetVariable: 'authToken',
            },
          ],
        },
        { id: 'd1', type: StepType.Delay, name: 'Next', durationMs: 0 },
      ],
      connections: [
        {
          id: 'c1',
          fromStepId: 'r1',
          toStepId: 'd1',
          condition: {
            left: '{{status}}',
            operator: '==',
            right: '200',
          },
        },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    });
    const result = parseScenarioDocument(text);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const step = result.scenario.steps[0];
    assert.ok(step);
    assert.deepEqual(step.retryPolicy, {
      maxRetries: 2,
      delayMs: 100,
      continueOnFailure: false,
      stopOnFailure: true,
    });
    assert.deepEqual(step.outputs, [
      { name: 'status', source: 'status' },
      { name: 'token', source: 'body.token', targetVariable: 'authToken' },
    ]);
    assert.deepEqual(result.scenario.connections[0]?.condition, {
      left: '{{status}}',
      operator: '==',
      right: '200',
    });
  });

  test('save → load → save round-trip preserves retryPolicy, outputs, connection.condition', () => {
    const original = {
      schemaVersion: ScenarioSchemaVersion,
      id: 'sc-roundtrip',
      name: 'RoundTrip',
      variables: [],
      steps: [
        {
          id: 'r1',
          type: StepType.Request,
          name: 'Req',
          requestId: 'req-1',
          requestFilePath: 'a.api',
          requestOffset: 0,
          inputMappings: [],
          retryPolicy: {
            maxRetries: 1,
            delayMs: 50,
            continueOnFailure: true,
            stopOnFailure: false,
          },
          outputs: [{ name: 'body', source: 'body' }],
        },
        { id: 'd1', type: StepType.Delay, name: 'Done', durationMs: 0 },
      ],
      connections: [
        {
          id: 'c1',
          fromStepId: 'r1',
          toStepId: 'd1',
          condition: { left: 'a', operator: '!=', right: 'b' },
        },
      ],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const firstParse = parseScenarioDocument(JSON.stringify(original));
    assert.equal(firstParse.ok, true);
    if (!firstParse.ok) return;

    const savedOnce = serializeScenario(firstParse.scenario);
    const secondParse = parseScenarioDocument(savedOnce);
    assert.equal(secondParse.ok, true);
    if (!secondParse.ok) return;

    const savedTwice = serializeScenario(secondParse.scenario);
    assert.deepEqual(JSON.parse(savedOnce), JSON.parse(savedTwice));

    const step = secondParse.scenario.steps.find((s) => s.id === 'r1');
    const originalStep = original.steps[0];
    const originalConnection = original.connections[0];
    assert.ok(step);
    assert.ok(originalStep);
    assert.ok(originalConnection);
    assert.deepEqual(step.retryPolicy, originalStep.retryPolicy);
    assert.deepEqual(step.outputs, originalStep.outputs);
    assert.deepEqual(
      secondParse.scenario.connections[0]?.condition,
      originalConnection.condition,
    );
  });

  test('rejects invalid retryPolicy when present', () => {
    const result = parseScenarioDocument(
      JSON.stringify({
        schemaVersion: ScenarioSchemaVersion,
        id: 'sc-bad-retry',
        name: 'BadRetry',
        variables: [],
        steps: [
          {
            id: 'd1',
            type: StepType.Delay,
            name: 'Wait',
            durationMs: 0,
            retryPolicy: {
              maxRetries: 1,
              delayMs: 0,
              continueOnFailure: true,
              stopOnFailure: true,
            },
          },
        ],
        connections: [],
        executionSettings: { failurePolicy: 'stop-on-first-error' },
        metadata: { createdAt: 't1', updatedAt: 't2' },
      }),
    );
    assert.equal(result.ok, false);
  });

  test('rejects invalid connection.condition when present', () => {
    const result = parseScenarioDocument(
      JSON.stringify({
        schemaVersion: ScenarioSchemaVersion,
        id: 'sc-bad-conn',
        name: 'BadConn',
        variables: [],
        steps: [
          { id: 'd1', type: StepType.Delay, name: 'A', durationMs: 0 },
          { id: 'd2', type: StepType.Delay, name: 'B', durationMs: 0 },
        ],
        connections: [
          {
            id: 'c1',
            fromStepId: 'd1',
            toStepId: 'd2',
            condition: { left: 'a', operator: '===', right: 'b' },
          },
        ],
        executionSettings: { failurePolicy: 'stop-on-first-error' },
        metadata: { createdAt: 't1', updatedAt: 't2' },
      }),
    );
    assert.equal(result.ok, false);
  });

  test('rejects unsupported schemaVersion', () => {
    const result = parseScenarioDocument(
      JSON.stringify({
        schemaVersion: '0.0.1',
        id: 'x',
        name: 'x',
        variables: [],
        steps: [{ id: 'd', type: 'delay', name: 'D', durationMs: 0 }],
        connections: [],
      }),
    );
    assert.equal(result.ok, false);
  });

  test('rejects invalid requestRef tokens', () => {
    const result = parseScenarioDocument(
      JSON.stringify({
        schemaVersion: ScenarioSchemaVersion,
        id: 'sc-3',
        name: 'BadRef',
        variables: [],
        steps: [
          {
            id: 'r1',
            type: StepType.Request,
            name: 'Req',
            requestRef: '/Login',
            requestId: 'x',
            requestFilePath: '',
            requestOffset: 0,
            inputMappings: [],
          },
        ],
        connections: [],
        executionSettings: { failurePolicy: 'stop-on-first-error' },
        metadata: { createdAt: 't1', updatedAt: 't2' },
      }),
    );
    assert.equal(result.ok, false);
  });

  test('preserves optional metadata.tags on parse and serialize', () => {
    const text = JSON.stringify({
      schemaVersion: ScenarioSchemaVersion,
      id: 'sc-tags',
      name: 'Tagged',
      variables: [],
      steps: [{ id: 'd1', type: StepType.Delay, name: 'Start', durationMs: 0 }],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: {
        createdAt: 't1',
        updatedAt: 't2',
        tags: ['auth', ' token ', ''],
      },
    });
    const parsed = parseScenarioDocument(text);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.scenario.metadata.tags, ['auth', 'token']);
    const again = parseScenarioDocument(serializeScenario(parsed.scenario));
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.deepEqual(again.scenario.metadata.tags, ['auth', 'token']);
    }
  });
});
