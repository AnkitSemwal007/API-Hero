import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveJsonPath } from './json-path';

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
});
