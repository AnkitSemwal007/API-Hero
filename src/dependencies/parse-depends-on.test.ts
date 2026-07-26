import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseDependsOnDirective,
  uniqueDependsOnNames,
} from './parse-depends-on';

describe('parseDependsOnDirective', () => {
  test('parses bare and qualified human refs', () => {
    const result = parseDependsOnDirective(
      'Login, Authentication/Login, New Request',
    );
    assert.deepEqual(result, {
      ok: true,
      names: ['Login', 'Authentication/Login', 'New Request'],
    });
  });

  test('strips @ from bare names', () => {
    const result = parseDependsOnDirective('@Login, @Products');
    assert.deepEqual(result, { ok: true, names: ['Login', 'Products'] });
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

  test('strips @ and preserves spaces in request names', () => {
    const result = parseDependsOnDirective('@New Request');
    assert.deepEqual(result, { ok: true, names: ['New Request'] });
  });

  test('parses request names that contain spaces without an @ prefix', () => {
    const result = parseDependsOnDirective('New Request, Other Request');
    assert.deepEqual(result, {
      ok: true,
      names: ['New Request', 'Other Request'],
    });
  });

  test('strips @ after whitespace and trims the remaining label', () => {
    const result = parseDependsOnDirective('  @ New Request  , Login ');
    assert.deepEqual(result, { ok: true, names: ['New Request', 'Login'] });
  });

  test('rejects an empty value', () => {
    const result = parseDependsOnDirective('   ');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /empty/u);
    }
  });

  test('rejects a bare @ as an empty name', () => {
    const result = parseDependsOnDirective('@');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /malformed/u);
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

  test('rejects malformed qualified tokens', () => {
    const result = parseDependsOnDirective('/Login');
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

