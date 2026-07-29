import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type Scenario,
  type StepUnion,
  type StepOutput,
} from '../models';
import { buildControlFlowGraph } from './control-flow-graph';
import { buildDataFlowGraph } from './data-flow-graph';

function variableStep(id: string, name: string, assignments: Record<string, string>): StepUnion {
  return {
    id,
    type: StepType.Variable,
    name,
    assignments: Object.entries(assignments).map(([k, v]) => ({ name: k, value: v })),
  };
}

function requestStep(
  id: string,
  name: string,
  outputs: readonly StepOutput[],
): StepUnion {
  return {
    id,
    type: StepType.Request,
    name,
    requestId: 'req-1',
    requestFilePath: '/tmp/req.api',
    requestOffset: 0,
    inputMappings: [],
    outputs,
  };
}

describe('scenarios/graph/data-flow-graph', () => {
  test('validates produced/consumed scenario variables with dominance', () => {
    const steps: StepUnion[] = [
      variableStep('S1', 'SetA', { varA: 'hello' }),
      variableStep('S2', 'SetB', { varB: '{{scenario.varA}}' }),
    ];
    const scenario: Scenario = {
      id: 'sc-1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        { id: 'vA', name: 'varA', scope: ScenarioVariableScope.Scenario, sensitive: false },
        { id: 'vB', name: 'varB', scope: ScenarioVariableScope.Scenario, sensitive: false },
      ],
      steps,
      connections: [{ id: 'c1', fromStepId: 'S1', toStepId: 'S2' }],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const controlFlow = buildControlFlowGraph(scenario);
    const result = buildDataFlowGraph(scenario, controlFlow);
    assert.deepEqual(result.errors, []);
    assert.notEqual(result.graph, undefined);

    const graph = result.graph!;
    const produced = graph.producedByStep.get('S1');
    assert.notEqual(produced, undefined);
    assert.deepEqual(produced, [{ kind: 'scenario', name: 'varA' }]);
  });

  test('reports UNKNOWN_OUTPUT_REFERENCE for missing step outputs', () => {
    const steps: StepUnion[] = [
      requestStep('R1', 'Req', [
        { name: 'token', source: 'status' },
      ]),
      variableStep('V1', 'UseToken', { varB: '{{Req.missing}}' }),
    ];
    const scenario: Scenario = {
      id: 'sc-2',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [{ id: 'vB', name: 'varB', scope: ScenarioVariableScope.Scenario, sensitive: false }],
      steps,
      connections: [{ id: 'c1', fromStepId: 'R1', toStepId: 'V1' }],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const controlFlow = buildControlFlowGraph(scenario);
    const result = buildDataFlowGraph(scenario, controlFlow);
    assert.equal(result.graph, undefined);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.code, 'UNKNOWN_OUTPUT_REFERENCE');
  });

  test('reports UNKNOWN_SCENARIO_VARIABLE for missing request input mapping vars', () => {
    const request = requestStep('R1', 'Req', [{ name: 'token', source: 'status' }]);
    const scenarioRequest = {
      ...request,
      inputMappings: [{ variable: 'missingVar', requestVariable: 'token' }],
    } as StepUnion;

    const steps: StepUnion[] = [
      scenarioRequest,
      variableStep('V1', 'Use', { varB: '{{scenario.varB}}' }),
    ];

    const scenario: Scenario = {
      id: 'sc-3',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [{ id: 'vB', name: 'varB', scope: ScenarioVariableScope.Scenario, sensitive: false }],
      steps,
      connections: [{ id: 'c1', fromStepId: 'R1', toStepId: 'V1' }],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const controlFlow = buildControlFlowGraph(scenario);
    const result = buildDataFlowGraph(scenario, controlFlow);
    assert.equal(result.graph, undefined);
    assert.equal(result.errors[0]!.code, 'UNKNOWN_SCENARIO_VARIABLE');
  });
});

