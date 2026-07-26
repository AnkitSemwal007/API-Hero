import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseRequestKey, requestKeyFor } from './request-key';

describe('requestKeyFor', () => {
  test('formats sourceId and index', () => {
    assert.equal(
      requestKeyFor('file:///workspace/demo.api', 0),
      'request:file:///workspace/demo.api#0',
    );
    assert.equal(requestKeyFor('demo.api', 2), 'request:demo.api#2');
  });

  test('parseRequestKey round-trips', () => {
    assert.deepEqual(parseRequestKey(requestKeyFor('demo.api', 2)), {
      sourceId: 'demo.api',
      index: 2,
    });
    assert.equal(parseRequestKey('not-a-key'), undefined);
    assert.equal(parseRequestKey('request:only'), undefined);
  });
});
