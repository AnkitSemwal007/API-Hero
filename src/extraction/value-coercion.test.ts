import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { coerceExtractionValue } from './value-coercion';

describe('coerceExtractionValue', () => {
  test('null and undefined become empty string', () => {
    assert.equal(coerceExtractionValue(null), '');
    assert.equal(coerceExtractionValue(undefined), '');
  });

  test('strings pass through', () => {
    assert.equal(coerceExtractionValue('token'), 'token');
    assert.equal(coerceExtractionValue(''), '');
  });

  test('numbers, booleans, and bigints stringify', () => {
    assert.equal(coerceExtractionValue(42), '42');
    assert.equal(coerceExtractionValue(true), 'true');
    assert.equal(coerceExtractionValue(false), 'false');
    assert.equal(coerceExtractionValue(10n), '10');
  });

  test('objects and arrays JSON.stringify', () => {
    assert.equal(coerceExtractionValue({ a: 1 }), '{"a":1}');
    assert.equal(coerceExtractionValue([1, 'x']), '[1,"x"]');
  });
});
