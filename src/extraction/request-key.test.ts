import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { requestKeyFor } from './request-key';

describe('requestKeyFor', () => {
  test('formats sourceId and index', () => {
    assert.equal(
      requestKeyFor('file:///workspace/demo.api', 0),
      'request:file:///workspace/demo.api#0',
    );
    assert.equal(requestKeyFor('demo.api', 2), 'request:demo.api#2');
  });
});
