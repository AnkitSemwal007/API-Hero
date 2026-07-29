import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type Scenario,
  type StepUnion,
  type Connection,
} from '../models';
import { buildControlFlowGraph } from './control-flow-graph';

function delayStep(id: string, name: string): StepUnion {
  return {
    id,
    type: StepType.Delay,
    name,
    durationMs: 0,
  };
}

describe('scenarios/graph/control-flow-graph', () => {
  test('builds a DAG with a unique entry and stable topo order', () => {
    const steps = [delayStep('A', 'A'), delayStep('B', 'B'), delayStep('C', 'C')];
    const connections: Connection[] = [
      { id: 'cAB', fromStepId: 'A', toStepId: 'B' },
      { id: 'cAC', fromStepId: 'A', toStepId: 'C' },
    ];
    const scenario: Scenario = {
      id: 's1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'var-1',
          name: 'varA',
          scope: ScenarioVariableScope.Scenario,
          sensitive: false,
        },
      ],
      steps,
      connections,
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const graph = buildControlFlowGraph(scenario);
    assert.equal(graph.entryStepId, 'A');
    assert.deepEqual(graph.executionOrder, ['A', 'B', 'C']);
    assert.equal(graph.cycles.length, 0);
    assert.deepEqual([...graph.reachableFromEntry].sort(), ['A', 'B', 'C']);
  });

  test('detects control-flow cycles and reports an empty entry', () => {
    const steps = [delayStep('A', 'A'), delayStep('B', 'B'), delayStep('C', 'C')];
    const connections: Connection[] = [
      { id: 'cAB', fromStepId: 'A', toStepId: 'B' },
      { id: 'cBC', fromStepId: 'B', toStepId: 'C' },
      { id: 'cCA', fromStepId: 'C', toStepId: 'A' },
    ];
    const scenario: Scenario = {
      id: 's1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'var-1',
          name: 'varA',
          scope: ScenarioVariableScope.Scenario,
          sensitive: false,
        },
      ],
      steps,
      connections,
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const graph = buildControlFlowGraph(scenario);
    assert.equal(graph.entryStepId, undefined);
    assert.equal(graph.cycles.length > 0, true);
    assert.equal(graph.reachableFromEntry.size, 0);
    assert.deepEqual(new Set(graph.executionOrder), new Set(['A', 'B', 'C']));
  });
});

