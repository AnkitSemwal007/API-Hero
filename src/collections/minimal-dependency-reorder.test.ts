/**
 * Unit tests for {@link minimalReorderForConstraints}.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  minimalReorderForConstraints,
  type OrderConstraint,
} from './minimal-dependency-reorder';

test('Login before Orders — producer after consumer → move Login before', () => {
  const result = minimalReorderForConstraints(
    ['Orders', 'Login', 'Products'],
    [{ beforeId: 'Login', afterId: 'Orders' }],
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.order, ['Login', 'Orders', 'Products']);
});

test('Login before Orders — producer last → move Login before Orders', () => {
  const result = minimalReorderForConstraints(
    ['Orders', 'Products', 'Login'],
    [{ beforeId: 'Login', afterId: 'Orders' }],
  );
  assert.equal(result.changed, true);
  // Tie scores: prefer producer-before-consumer.
  assert.deepEqual(result.order, ['Login', 'Orders', 'Products']);
});

test('Login before Orders — already valid → unchanged', () => {
  const order = ['Login', 'Products', 'Orders', 'Profile'];
  const result = minimalReorderForConstraints(order, [
    { beforeId: 'Login', afterId: 'Orders' },
  ]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.order, order);
});

test('multiple constraints — satisfy all with minimal movement', () => {
  const result = minimalReorderForConstraints(
    ['C', 'A', 'B'],
    [
      { beforeId: 'A', afterId: 'B' },
      { beforeId: 'B', afterId: 'C' },
    ],
  );
  assert.equal(result.changed, true);
  const index = (id: string): number => result.order.indexOf(id);
  assert.ok(index('A') < index('B'));
  assert.ok(index('B') < index('C'));
  assert.deepEqual([...result.order].sort(), ['A', 'B', 'C']);
});

test('missing ids in constraints are ignored', () => {
  const order = ['Orders', 'Login'];
  const result = minimalReorderForConstraints(order, [
    { beforeId: 'Missing', afterId: 'Orders' },
    { beforeId: 'Login', afterId: 'Ghost' },
  ]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.order, order);
});

test('empty constraints → unchanged', () => {
  const order = ['A', 'B'];
  const result = minimalReorderForConstraints(order, []);
  assert.equal(result.changed, false);
  assert.deepEqual(result.order, order);
});

test('self-constraint ignored', () => {
  const order = ['A', 'B'];
  const result = minimalReorderForConstraints(order, [
    { beforeId: 'A', afterId: 'A' },
  ]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.order, order);
});

test('preserves relative order of unrelated items', () => {
  const result = minimalReorderForConstraints(
    ['Z', 'Orders', 'Y', 'Login', 'X'],
    [{ beforeId: 'Login', afterId: 'Orders' }],
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.order, ['Z', 'Login', 'Orders', 'Y', 'X']);
});

test('duplicate constraint entries still converge', () => {
  const constraints: OrderConstraint[] = [
    { beforeId: 'Login', afterId: 'Orders' },
    { beforeId: 'Login', afterId: 'Orders' },
  ];
  const result = minimalReorderForConstraints(
    ['Orders', 'Login'],
    constraints,
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.order, ['Login', 'Orders']);
});
