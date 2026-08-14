import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_GRAPHQL_REQUEST_URL,
  DEFAULT_HTTP_REQUEST_URL,
  DEFAULT_WEBSOCKET_REQUEST_URL,
  isStockProtocolDefaultUrl,
} from './protocol-defaults';

test('isStockProtocolDefaultUrl matches empty and stock protocol URLs only', () => {
  assert.equal(isStockProtocolDefaultUrl(''), true);
  assert.equal(isStockProtocolDefaultUrl('  '), true);
  assert.equal(isStockProtocolDefaultUrl(DEFAULT_HTTP_REQUEST_URL), true);
  assert.equal(isStockProtocolDefaultUrl(DEFAULT_GRAPHQL_REQUEST_URL), true);
  assert.equal(isStockProtocolDefaultUrl(DEFAULT_WEBSOCKET_REQUEST_URL), true);
  assert.equal(isStockProtocolDefaultUrl('https://example.test/custom'), false);
  assert.equal(isStockProtocolDefaultUrl('wss://prod.example/socket'), false);
});
