import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseDependsOnDirective,
  uniqueDependsOnNames,
} from './parse-depends-on';

describe('parseDependsOnDirective', () => {
  test('parses a single name', () => {
    const result = parseDependsOnDirective('Login');
    assert.deepEqual(result, { ok: true, names: ['Login'] });
  });

  test('parses a comma-separated list and trims whitespace', () => {
    const result = parseDependsOnDirective('Login,  Products ,Cart');
    assert.deepEqual(result, {
      ok: true,
      names: ['Login', 'Products', 'Cart'],
    });
  });

  test('preserves duplicate names in order', () => {
    const result = parseDependsOnDirective('Login, Login, Products');
    assert.deepEqual(result, {
      ok: true,
      names: ['Login', 'Login', 'Products'],
    });
  });

  test('rejects an empty value', () => {
    const result = parseDependsOnDirective('   ');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /empty/u);
    }
  });

  test('rejects a malformed list with an empty segment', () => {
    const result = parseDependsOnDirective('Login, , Products');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /malformed/u);
    }
  });

  test('rejects a trailing comma', () => {
    const result = parseDependsOnDirective('Login,');
    assert.equal(result.ok, false);
  });
});

describe('uniqueDependsOnNames', () => {
  test('deduplicates while preserving first-seen order', () => {
    assert.deepEqual(
      uniqueDependsOnNames(['Login', 'Products', 'Login']),
      ['Login', 'Products'],
    );
  });

  test('returns an empty array for an empty input', () => {
    assert.deepEqual(uniqueDependsOnNames([]), []);
  });
});
