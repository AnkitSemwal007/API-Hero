/**
 * Light unit tests for same-folder depend-on order alignment helpers.
 * Full VS Code mutation/notification paths are covered by integration.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { minimalReorderForConstraints } from '../../collections/minimal-dependency-reorder';

test('orchestration mapping: request ids → reorder result matches basename order intent', () => {
  // Consumer Orders added depends-on Login; sibling ids in folder order.
  const siblingIds = ['req_orders', 'req_login', 'req_products'];
  const idToBasename = new Map([
    ['req_orders', 'Orders.api'],
    ['req_login', 'Login.api'],
    ['req_products', 'Products.api'],
  ]);
  const reorder = minimalReorderForConstraints(siblingIds, [
    { beforeId: 'req_login', afterId: 'req_orders' },
  ]);
  assert.equal(reorder.changed, true);
  const basenames = reorder.order.map((id) => idToBasename.get(id));
  assert.deepEqual(basenames, ['Login.api', 'Orders.api', 'Products.api']);
});

test('cross-folder constraint omitted leaves same-folder order unchanged', () => {
  // Only same-folder constraints are passed to the pure helper (orchestration
  // filters cross-folder producers before calling).
  const siblingIds = ['req_orders', 'req_products'];
  const reorder = minimalReorderForConstraints(siblingIds, []);
  assert.equal(reorder.changed, false);
  assert.deepEqual(reorder.order, siblingIds);
});
