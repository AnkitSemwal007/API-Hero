import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTH_SECRET_KEY_PREFIX,
  authenticationSecretKey,
  LEGACY_AUTH_SECRET_KEY_PREFIX,
  legacyAuthenticationSecretKey,
} from '../constants';

test('authenticationSecretKey uses the canonical apiHero.auth.profile prefix', () => {
  assert.equal(
    authenticationSecretKey('team/profile', 'token'),
    'apiHero.auth.profile.team%2Fprofile.token',
  );
  assert.ok(
    authenticationSecretKey('id', 'field').startsWith(AUTH_SECRET_KEY_PREFIX),
  );
});

test('legacyAuthenticationSecretKey preserves the apiRunner.auth.profile prefix', () => {
  assert.equal(
    legacyAuthenticationSecretKey('team/profile', 'token'),
    'apiRunner.auth.profile.team%2Fprofile.token',
  );
  assert.ok(
    legacyAuthenticationSecretKey('id', 'field').startsWith(
      LEGACY_AUTH_SECRET_KEY_PREFIX,
    ),
  );
});
