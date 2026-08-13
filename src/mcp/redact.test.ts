/**
 * Redaction unit coverage for MCP defense-in-depth helpers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MASKED_HEADER_VALUE } from '../response/presentation';
import {
  MCP_SECRET_MASK,
  isSensitiveKey,
  maskVariableIfSensitive,
  redactForMcp,
  redactRequestUrl,
} from './redact';

test('redactRequestUrl strips userinfo', () => {
  const redacted = redactRequestUrl('https://alice:sekrit@example.test/path');
  assert.equal(redacted.includes('sekrit'), false);
  assert.equal(redacted.includes('alice'), false);
  assert.match(redacted, /example\.test\/path/);
});

test('isSensitiveKey detects auth-like names', () => {
  assert.equal(isSensitiveKey('Authorization'), true);
  assert.equal(isSensitiveKey('api_key'), true);
  assert.equal(isSensitiveKey('Accept'), false);
});

test('maskVariableIfSensitive masks flagged and name-hinted values', () => {
  assert.equal(
    maskVariableIfSensitive('token', 'abc', true),
    MCP_SECRET_MASK,
  );
  assert.equal(maskVariableIfSensitive('host', 'example.test', false), 'example.test');
});

test('redactForMcp masks Authorization header values', () => {
  const out = redactForMcp({
    headers: [{ name: 'Authorization', value: 'Bearer secret-token-value' }],
  });
  assert.equal(out.headers[0]?.value, MASKED_HEADER_VALUE);
  assert.equal(JSON.stringify(out).includes('secret-token-value'), false);
});

test('redactForMcp masks token fields inside GraphQL variables JSON', () => {
  const out = redactForMcp({
    variables: { token: 'sekrit-token-value' },
    body: '{"query":"query Q($token: String!) { q }","variables":{"token":"sekrit-token-value"}}',
  });
  assert.doesNotMatch(JSON.stringify(out), /sekrit-token-value/u);
  assert.equal(out.variables.token, MCP_SECRET_MASK);
});

test('redactForMcp masks JWT and password fields inside JSON body strings', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MX0.signature';
  const out = redactForMcp({
    response: {
      body: {
        raw: JSON.stringify({
          accessToken: jwt,
          refreshToken: jwt,
          password: 'emilyspass',
          username: 'emilys',
        }),
        pretty: JSON.stringify(
          {
            accessToken: jwt,
            password: 'emilyspass',
            username: 'emilys',
          },
          null,
          2,
        ),
      },
    },
  });
  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes(jwt), false);
  assert.equal(serialized.includes('emilyspass'), false);
  assert.equal(serialized.includes('emilys'), true);
  assert.equal(serialized.includes(MCP_SECRET_MASK), true);
});

test('redactForMcp masks token-like assertion expected/actual values', () => {
  const token = 'tok_test_abcdefghijklmnopqrstuvwxyz012345';
  const out = redactForMcp({
    assertions: { expected: token, actual: 'Bearer abcdefghijklmnop' },
  });
  assert.equal(out.assertions.expected, MCP_SECRET_MASK);
  assert.match(out.assertions.actual, new RegExp(MCP_SECRET_MASK));
  assert.equal(JSON.stringify(out).includes(token), false);
});
