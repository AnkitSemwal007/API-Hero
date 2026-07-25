import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryRunVariableStore } from './run-variable-store';

test('set and get return run-scoped VariableValue', () => {
  const store = new InMemoryRunVariableStore();
  store.set('token', 'abc');

  assert.deepEqual(store.get('token'), {
    name: 'token',
    value: 'abc',
    scope: 'run',
    sensitive: false,
  });
  assert.equal(store.get('missing'), undefined);
});

test('set overwrites an existing name', () => {
  const store = new InMemoryRunVariableStore();
  store.set('host', 'first');
  store.set('host', 'second');

  assert.equal(store.get('host')?.value, 'second');
  assert.equal(store.toDefinitions().length, 1);
});

test('sensitive flag defaults false and can be set true', () => {
  const store = new InMemoryRunVariableStore();
  store.set('plain', 'x');
  store.set('secret', 'y', true);

  assert.equal(store.get('plain')?.sensitive, false);
  assert.equal(store.get('secret')?.sensitive, true);
});

test('toDefinitions uses scope run for every entry', () => {
  const store = new InMemoryRunVariableStore();
  store.set('a', '1');
  store.set('b', '2', true);

  const definitions = store.toDefinitions();
  assert.deepEqual(definitions, [
    { name: 'a', value: '1', scope: 'run', sensitive: false },
    { name: 'b', value: '2', scope: 'run', sensitive: true },
  ]);
});

test('clear removes all entries', () => {
  const store = new InMemoryRunVariableStore();
  store.set('a', '1');
  store.set('b', '2');
  store.clear();

  assert.equal(store.get('a'), undefined);
  assert.equal(store.toDefinitions().length, 0);
  assert.equal(store.snapshot().size, 0);
});

test('snapshot is detached from later store mutations', () => {
  const store = new InMemoryRunVariableStore();
  store.set('host', 'before');

  const snap = store.snapshot();
  store.set('host', 'after');
  store.set('extra', 'x');
  store.clear();

  assert.equal(snap.size, 1);
  assert.deepEqual(snap.get('host'), {
    name: 'host',
    value: 'before',
    scope: 'run',
    sensitive: false,
  });
  assert.equal(snap.get('extra'), undefined);
});
