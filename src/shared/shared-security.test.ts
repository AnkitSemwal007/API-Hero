import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cloneDetached,
  deepFreeze,
  freezeDetachedBytes,
  parseParameters,
  queryPart,
  redactUrlUserinfo,
} from './index';

test('redactUrlUserinfo strips credentials from parseable URLs', () => {
  assert.equal(
    redactUrlUserinfo('https://alice:sekrit@example.test/path?x=1'),
    'https://***@example.test/path?x=1',
  );
  assert.equal(
    redactUrlUserinfo('https://example.test/ok'),
    'https://example.test/ok',
  );
  const fallback = redactUrlUserinfo('not a url //user:sekrit@host/path');
  assert.doesNotMatch(fallback, /sekrit/u);
  assert.match(fallback, /\*\*\*@/u);
});

test('freezeDetachedBytes seals a detached copy', () => {
  const source = new Uint8Array([1, 2, 3]);
  const frozen = freezeDetachedBytes(source);
  source[0] = 99;
  assert.equal(frozen.at(0), 1);
  assert.equal(frozen.byteLength, 3);
  assert.deepEqual([...frozen], [1, 2, 3]);
  assert.deepEqual(Array.from(frozen.copyOut()), [1, 2, 3]);
  assert.ok(Object.isFrozen(frozen));
});

test('deepFreeze freezes nested plain objects and arrays', () => {
  const value = cloneDetached({ a: { b: [1, { c: 2 }] }, d: 'x' });
  const frozen = deepFreeze(value);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(frozen.a));
  assert.ok(Object.isFrozen(frozen.a.b));
  assert.ok(Object.isFrozen(frozen.a.b[1]));
  assert.throws(() => {
    (frozen as { d: string }).d = 'y';
  });
});

test('parseParameters handles empty duplicates and unicode', () => {
  assert.deepEqual(parseParameters(undefined), []);
  assert.deepEqual(parseParameters(''), []);
  assert.deepEqual(parseParameters('a=1&a=2&flag'), [
    { name: 'a', value: '1' },
    { name: 'a', value: '2' },
    { name: 'flag' },
  ]);
  assert.deepEqual(parseParameters('名前=値&emoji=✅'), [
    { name: '名前', value: '値' },
    { name: 'emoji', value: '✅' },
  ]);
  assert.equal(queryPart('https://example.test/path?a=1&b=2#frag'), 'a=1&b=2');
  assert.equal(queryPart('https://example.test/path'), undefined);
});
