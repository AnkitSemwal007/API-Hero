import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDefaultExtractorRegistry } from './registry';

describe('createDefaultExtractorRegistry', () => {
  test('returns extractors for json-path, header, and status', () => {
    const registry = createDefaultExtractorRegistry();
    assert.equal(registry.get('json-path')?.kind, 'json-path');
    assert.equal(registry.get('header')?.kind, 'header');
    assert.equal(registry.get('status')?.kind, 'status');
  });
});
