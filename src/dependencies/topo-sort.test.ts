import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { topoSort } from './topo-sort';

describe('topoSort', () => {
  test('keeps original order when there are no edges', () => {
    const result = topoSort({ nodes: ['a', 'b', 'c'], edges: [] });
    assert.deepEqual(result.order, ['a', 'b', 'c']);
    assert.equal(result.reordered, false);
  });

  test('reorders to satisfy a producer -> consumer edge', () => {
    const result = topoSort({
      nodes: ['products', 'login'],
      edges: [
        { fromRequestId: 'login', toRequestId: 'products', kind: 'implicit', variable: 'token' },
      ],
    });
    assert.deepEqual(result.order, ['login', 'products']);
    assert.equal(result.reordered, true);
  });

  test('breaks ties by original membership ordinal', () => {
    const result = topoSort({
      nodes: ['c', 'b', 'a'],
      edges: [],
    });
    // No edges constrain order, so Kahn's ready-queue processes nodes in the
    // supplied (original) order — stability, not alphabetical order.
    assert.deepEqual(result.order, ['c', 'b', 'a']);
    assert.equal(result.reordered, false);
  });

  test('produces a valid total order for a diamond dependency', () => {
    const result = topoSort({
      nodes: ['login', 'products', 'inventory', 'invoice'],
      edges: [
        { fromRequestId: 'login', toRequestId: 'products', kind: 'implicit', variable: 'token' },
        { fromRequestId: 'login', toRequestId: 'inventory', kind: 'implicit', variable: 'token' },
        { fromRequestId: 'products', toRequestId: 'invoice', kind: 'explicit' },
        { fromRequestId: 'inventory', toRequestId: 'invoice', kind: 'explicit' },
      ],
    });
    assert.equal(result.order.indexOf('login'), 0);
    assert.equal(result.order.indexOf('invoice'), 3);
    assert.ok(result.order.indexOf('products') < result.order.indexOf('invoice'));
    assert.ok(result.order.indexOf('inventory') < result.order.indexOf('invoice'));
  });

  test('appends unscheduled (cyclic) nodes rather than dropping them', () => {
    const result = topoSort({
      nodes: ['a', 'b'],
      edges: [
        { fromRequestId: 'a', toRequestId: 'b', kind: 'explicit' },
        { fromRequestId: 'b', toRequestId: 'a', kind: 'explicit' },
      ],
    });
    assert.equal(result.order.length, 2);
    assert.deepEqual([...result.order].sort(), ['a', 'b']);
  });
});
