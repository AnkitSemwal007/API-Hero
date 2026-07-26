import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildDependencyGraph } from './graph-builder';
import type { RequestDependencyAnalysis } from './models';

function analysis(
  requestId: string,
  produces: readonly string[] = [],
  consumes: readonly string[] = [],
  dependsOnNames: readonly string[] = [],
): RequestDependencyAnalysis {
  return { requestId, produces, consumes, dependsOnNames };
}

describe('buildDependencyGraph', () => {
  test('creates an implicit edge from producer to consumer', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('login', ['accessToken']),
        analysis('products', [], ['accessToken']),
      ],
      labelByRequestId: new Map([
        ['login', 'Login'],
        ['products', 'Products'],
      ]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.nodes, ['login', 'products']);
    assert.deepEqual(result.graph.edges, [
      { fromRequestId: 'login', toRequestId: 'products', kind: 'implicit', variable: 'accessToken' },
    ]);
    assert.deepEqual(result.unresolvedConsumes, []);
  });

  test('creates an edge from every in-plan producer of a variable', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('a', ['token']),
        analysis('b', ['token']),
        analysis('c', [], ['token']),
      ],
      labelByRequestId: new Map([
        ['a', 'A'],
        ['b', 'B'],
        ['c', 'C'],
      ]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const edgesToC = result.graph.edges.filter((edge) => edge.toRequestId === 'c');
    assert.equal(edgesToC.length, 2);
    assert.deepEqual(
      edgesToC.map((edge) => edge.fromRequestId).sort(),
      ['a', 'b'],
    );
  });

  test('records unresolved consumes when no in-plan producer exists', () => {
    const result = buildDependencyGraph({
      analyses: [analysis('products', [], ['accessToken'])],
      labelByRequestId: new Map([['products', 'Products']]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.graph.edges.length, 0);
    assert.deepEqual(result.unresolvedConsumes, [
      { requestId: 'products', variable: 'accessToken' },
    ]);
  });

  test('resolves an explicit @depends-on name to a request id edge', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('login'),
        analysis('invoice', [], [], ['Login']),
      ],
      labelByRequestId: new Map([
        ['login', 'Login'],
        ['invoice', 'Invoice'],
      ]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.edges, [
      { fromRequestId: 'login', toRequestId: 'invoice', kind: 'explicit' },
    ]);
  });

  test('fails closed with AMBIGUOUS_DEPENDS_ON when multiple requests share a label', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('login1'),
        analysis('login2'),
        analysis('invoice', [], [], ['Login']),
      ],
      labelByRequestId: new Map([
        ['login1', 'Login'],
        ['login2', 'Login'],
        ['invoice', 'Invoice'],
      ]),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'AMBIGUOUS_DEPENDS_ON');
  });

  test('fails closed with UNKNOWN_DEPENDS_ON_TARGET when the label is not in the plan', () => {
    const result = buildDependencyGraph({
      analyses: [analysis('invoice', [], [], ['Ghost'])],
      labelByRequestId: new Map([['invoice', 'Invoice']]),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'UNKNOWN_DEPENDS_ON_TARGET');
  });

  test('ignores a self-referencing @depends-on name', () => {
    const result = buildDependencyGraph({
      analyses: [analysis('invoice', [], [], ['Invoice'])],
      labelByRequestId: new Map([['invoice', 'Invoice']]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.edges, []);
  });
});
