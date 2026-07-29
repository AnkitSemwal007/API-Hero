import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type Scenario,
  type StepOutput,
  type StepUnion,
} from '../models';
import { createScenarioVariableResolver } from './scenario-variable-resolver';

describe('scenarios/variables/scenario-variable-resolver', () => {
  const createContext = () => ({
    variables: new Map<string, string>(),
    outputs: new Map<string, Map<string, string>>(),
  });

  test('resolves scenario variable defaults and template convenience', () => {
    const externalVariableResolver = {
      analyze: () => ({
        values: new Map<string, { value: string }>(),
        errors: [],
      }),
      resolveRequest: () => ({
        success: true,
        request: undefined,
        values: new Map(),
      }),
    } as never;

    const scenario: Scenario = {
      id: 'sc-1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'vA',
          name: 'varA',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: 'A0',
          sensitive: false,
        },
        { id: 'vB', name: 'varB', scope: ScenarioVariableScope.Scenario, sensitive: false },
      ],
      steps: [],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const resolver = createScenarioVariableResolver({
      scenario,
      externalVariableResolver,
      externalVariableDefinitions: [],
    });

    const context = createContext();
    assert.equal(resolver.resolveScenarioVariable('varA', context), 'A0');
    assert.equal(resolver.resolveStringTemplate('{{varA}}', context), 'A0');

    assert.throws(() => resolver.resolveScenarioVariable('varB', context));
  });

  test('resolves output references from context.outputs', () => {
    const externalVariableResolver = {
      analyze: () => ({
        values: new Map<string, { value: string }>(),
        errors: [],
      }),
      resolveRequest: () => ({
        success: true,
        request: undefined,
        values: new Map(),
      }),
    } as never;

    const outputs: StepOutput[] = [{ name: 'out', source: 'status' }];
    const requestStep: StepUnion = {
      id: 'R1',
      type: StepType.Request,
      name: 'Req',
      requestId: 'req-1',
      requestFilePath: '/tmp/req.api',
      requestOffset: 0,
      inputMappings: [],
      outputs,
    };

    const scenario: Scenario = {
      id: 'sc-2',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [],
      steps: [requestStep],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const resolver = createScenarioVariableResolver({
      scenario,
      externalVariableResolver,
      externalVariableDefinitions: [],
    });

    const context = createContext();
    context.outputs.set('R1', new Map<string, string>([['out', 'O1']]));

    assert.equal(resolver.resolveStringTemplate('{{Req.out}}', context), 'O1');
    assert.throws(() => resolver.resolveStringTemplate('{{Req.missing}}', context));
  });

  test('delegates unknown placeholders to external analysis when available', () => {
    const externalVariableResolver = {
      analyze: () => ({
        values: new Map<string, { value: string }>([['$uuid', { value: 'U1' }]]),
        errors: [],
      }),
      resolveRequest: () => ({
        success: true,
        request: undefined,
        values: new Map(),
      }),
    } as never;

    const scenario: Scenario = {
      id: 'sc-3',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [],
      steps: [],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const resolver = createScenarioVariableResolver({
      scenario,
      externalVariableResolver,
      externalVariableDefinitions: [],
    });

    const context = createContext();
    assert.equal(resolver.resolveStringTemplate('{{$uuid}}', context), 'U1');
    assert.equal(resolver.resolveStringTemplate('{{doesNotExist}}', context), '');
  });
});

