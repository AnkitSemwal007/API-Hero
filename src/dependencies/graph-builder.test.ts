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

  test('resolves an explicit @depends-on bare name to a request id edge', () => {
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

  test('resolves qualified Folder/Name when bare names collide across folders', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('login1'),
        analysis('login2'),
        analysis('invoice', [], [], ['Authentication/Login']),
      ],
      labelByRequestId: new Map([
        ['login1', 'Login'],
        ['login2', 'Login'],
        ['invoice', 'Invoice'],
      ]),
      folderPathByRequestId: new Map([
        ['login1', 'Authentication'],
        ['login2', 'Admin'],
        ['invoice', ''],
      ]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.edges, [
      { fromRequestId: 'login1', toRequestId: 'invoice', kind: 'explicit' },
    ]);
  });

  test('resolves unique bare names even when other names are duplicated', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('login1'),
        analysis('login2'),
        analysis('cart'),
        analysis('invoice', [], [], ['Cart']),
      ],
      labelByRequestId: new Map([
        ['login1', 'Login'],
        ['login2', 'Login'],
        ['cart', 'Cart'],
        ['invoice', 'Invoice'],
      ]),
      folderPathByRequestId: new Map([
        ['login1', 'Authentication'],
        ['login2', 'Admin'],
        ['cart', ''],
        ['invoice', ''],
      ]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.edges, [
      { fromRequestId: 'cart', toRequestId: 'invoice', kind: 'explicit' },
    ]);
  });

  test('resolves @depends-on targets whose @name labels contain spaces', () => {
    const result = buildDependencyGraph({
      analyses: [
        analysis('new-request'),
        analysis('invoice', [], [], ['New Request']),
      ],
      labelByRequestId: new Map([
        ['new-request', 'New Request'],
        ['invoice', 'Invoice'],
      ]),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.edges, [
      {
        fromRequestId: 'new-request',
        toRequestId: 'invoice',
        kind: 'explicit',
      },
    ]);
  });

  test('fails closed with AMBIGUOUS_DEPENDS_ON when multiple requests share a bare label', () => {
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
      folderPathByRequestId: new Map([
        ['login1', 'Authentication'],
        ['login2', 'Admin'],
        ['invoice', ''],
      ]),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'AMBIGUOUS_DEPENDS_ON');
    assert.match(result.message, /Authentication\/Login/u);
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

