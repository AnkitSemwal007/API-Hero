import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  leafKeyFromJsonPath,
  looksSensitiveForExtract,
  sanitizeVariableName,
} from './create-variable';

describe('create-variable helpers', () => {
  test('sanitizeVariableName', () => {
    assert.equal(sanitizeVariableName('access_token'), 'access_token');
    assert.equal(sanitizeVariableName('access-token'), 'access-token');
    assert.equal(sanitizeVariableName('1bad'), 'v_1bad');
    assert.equal(sanitizeVariableName(''), 'extracted');
    assert.equal(sanitizeVariableName('a b'), 'a_b');
  });

  test('looksSensitiveForExtract', () => {
    assert.equal(looksSensitiveForExtract('token', 'body.x'), true);
    assert.equal(looksSensitiveForExtract('id', 'body.access_token'), true);
    assert.equal(looksSensitiveForExtract('id', 'body.user.id'), false);
    assert.equal(looksSensitiveForExtract('Authorization', 'header'), true);
  });

  test('leafKeyFromJsonPath', () => {
    assert.equal(leafKeyFromJsonPath('body.access_token'), 'access_token');
    assert.equal(leafKeyFromJsonPath('body.items[2].name'), 'name');
    assert.equal(leafKeyFromJsonPath('body[0]'), '0');
    assert.equal(leafKeyFromJsonPath('body[0].id'), 'id');
    assert.equal(leafKeyFromJsonPath('body'), 'body');
  });
});
