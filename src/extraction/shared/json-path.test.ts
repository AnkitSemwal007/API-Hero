import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveJsonPath, isExtractableJsonPath } from './json-path';

describe('resolveJsonPath', () => {
  test('resolves nested paths, indexes, and length', () => {
    const root = {
      user: { name: 'John', id: 1 },
      data: { items: [{ name: 'a' }, { name: 'b' }] },
      orders: [1, 2, 3],
    };
    assert.deepEqual(resolveJsonPath(root, 'user.id'), {
      found: true,
      value: 1,
    });
    assert.deepEqual(resolveJsonPath(root, 'data.items[0].name'), {
      found: true,
      value: 'a',
    });
    assert.deepEqual(resolveJsonPath(root, 'orders.length'), {
      found: true,
      value: 3,
    });
    assert.equal(resolveJsonPath(root, 'missing.path').found, false);
  });

  test('strips leading body. prefix', () => {
    const root = { access_token: 't', nested: { id: 2 } };
    assert.deepEqual(resolveJsonPath(root, 'body.access_token'), {
      found: true,
      value: 't',
    });
    assert.deepEqual(resolveJsonPath(root, 'body.nested.id'), {
      found: true,
      value: 2,
    });
  });

  test('resolves array roots and nested array indexes', () => {
    const root = [{ id: 1 }, { id: 2, tags: ['a', 'b'] }];
    assert.deepEqual(resolveJsonPath(root, '[1].id'), {
      found: true,
      value: 2,
    });
    assert.deepEqual(resolveJsonPath(root, '[1].tags[0]'), {
      found: true,
      value: 'a',
    });
    assert.deepEqual(resolveJsonPath(root, 'length'), {
      found: true,
      value: 2,
    });
  });

  test('resolves primitives at root and empty path', () => {
    assert.deepEqual(resolveJsonPath('hello', ''), {
      found: true,
      value: 'hello',
    });
    assert.deepEqual(resolveJsonPath(42, undefined), {
      found: true,
      value: 42,
    });
    assert.deepEqual(resolveJsonPath(null, ''), {
      found: true,
      value: null,
    });
  });

  test('missing paths, out of bounds, and invalid segments', () => {
    const root = { items: [1], user: { name: 'a' } };
    assert.equal(resolveJsonPath(root, 'items[3]').found, false);
    assert.equal(resolveJsonPath(root, 'user.missing').found, false);
    assert.equal(resolveJsonPath(root, 'user[0]').found, false);
    assert.equal(resolveJsonPath(root, 'items.name').found, false);
    assert.equal(resolveJsonPath(root, '@@@').found, false);
  });

  test('does not support quoted bracket keys (documented limitation)', () => {
    const root = { 'weird-key': 1 };
    assert.equal(resolveJsonPath(root, "['weird-key']").found, false);
    assert.equal(resolveJsonPath(root, '["weird-key"]').found, false);
  });

  test('cannot traverse beyond .length', () => {
    assert.equal(resolveJsonPath([1, 2], 'length.x').found, false);
    assert.equal(resolveJsonPath({ a: 1 }, 'length').found, false);
  });

  test('strips leading body prefix for array-root bodies (body[0], body[0].id)', () => {
    const root = [{ id: 'x' }, { id: 'y' }];
    assert.deepEqual(resolveJsonPath(root, 'body[0]'), {
      found: true,
      value: { id: 'x' },
    });
    assert.deepEqual(resolveJsonPath(root, 'body[0].id'), {
      found: true,
      value: 'x',
    });
    assert.deepEqual(resolveJsonPath(root, 'body[1].id'), {
      found: true,
      value: 'y',
    });
  });
});

describe('isExtractableJsonPath', () => {
  test('accepts identifier properties, indexes, and body prefix', () => {
    assert.equal(isExtractableJsonPath('body'), true);
    assert.equal(isExtractableJsonPath('body.access_token'), true);
    assert.equal(isExtractableJsonPath('body.items[0].id'), true);
    assert.equal(isExtractableJsonPath('body.foo-bar'), true);
    assert.equal(isExtractableJsonPath(''), true);
  });

  test('rejects non-identifier property segments', () => {
    assert.equal(isExtractableJsonPath('body.invalid key'), false);
    assert.equal(isExtractableJsonPath('body.123abc'), false);
    assert.equal(isExtractableJsonPath('body.["x"]'), false);
    assert.equal(isExtractableJsonPath('body.@@@'), false);
  });

  test('accepts array-root body paths (body[0], body[0].id)', () => {
    assert.equal(isExtractableJsonPath('body[0]'), true);
    assert.equal(isExtractableJsonPath('body[0].id'), true);
    assert.equal(isExtractableJsonPath('body[12].nested[3].name'), true);
  });
});
