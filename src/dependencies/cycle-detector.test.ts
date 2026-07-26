import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { detectCycles } from './cycle-detector';
import type { DependencyGraph } from './models';

describe('detectCycles', () => {
  test('reports no cycle for a DAG', () => {
    const graph: DependencyGraph = {
      nodes: ['a', 'b', 'c'],
      edges: [
        { fromRequestId: 'a', toRequestId: 'b', kind: 'implicit', variable: 'x' },
        { fromRequestId: 'b', toRequestId: 'c', kind: 'implicit', variable: 'y' },
      ],
    };
    const result = detectCycles(graph);
    assert.equal(result.hasCycle, false);
    assert.deepEqual(result.cycles, []);
  });

  test('detects a simple two-node cycle', () => {
    const graph: DependencyGraph = {
      nodes: ['a', 'b'],
      edges: [
        { fromRequestId: 'a', toRequestId: 'b', kind: 'explicit' },
        { fromRequestId: 'b', toRequestId: 'a', kind: 'explicit' },
      ],
    };
    const result = detectCycles(graph);
    assert.equal(result.hasCycle, true);
    assert.equal(result.cycles.length, 1);
    assert.deepEqual([...result.cycles[0]!].sort(), ['a', 'a', 'b'].sort());
  });

  test('detects a multi-node cycle', () => {
    const graph: DependencyGraph = {
      nodes: ['a', 'b', 'c'],
      edges: [
        { fromRequestId: 'a', toRequestId: 'b', kind: 'implicit', variable: 'x' },
        { fromRequestId: 'b', toRequestId: 'c', kind: 'implicit', variable: 'y' },
        { fromRequestId: 'c', toRequestId: 'a', kind: 'implicit', variable: 'z' },
      ],
    };
    const result = detectCycles(graph);
    assert.equal(result.hasCycle, true);
    assert.equal(result.cycles.length, 1);
  });

  test('deduplicates the same cycle discovered from multiple entry points', () => {
    const graph: DependencyGraph = {
      nodes: ['a', 'b', 'd'],
      edges: [
        { fromRequestId: 'd', toRequestId: 'a', kind: 'implicit', variable: 'x' },
        { fromRequestId: 'a', toRequestId: 'b', kind: 'implicit', variable: 'y' },
        { fromRequestId: 'b', toRequestId: 'a', kind: 'implicit', variable: 'z' },
      ],
    };
    const result = detectCycles(graph);
    assert.equal(result.cycles.length, 1);
  });

  test('does not flag a diamond dependency (shared producer) as a cycle', () => {
    const graph: DependencyGraph = {
      nodes: ['login', 'products', 'invoice'],
      edges: [
        { fromRequestId: 'login', toRequestId: 'products', kind: 'implicit', variable: 'token' },
        { fromRequestId: 'login', toRequestId: 'invoice', kind: 'implicit', variable: 'token' },
        { fromRequestId: 'products', toRequestId: 'invoice', kind: 'explicit' },
      ],
    };
    const result = detectCycles(graph);
    assert.equal(result.hasCycle, false);
  });
});
