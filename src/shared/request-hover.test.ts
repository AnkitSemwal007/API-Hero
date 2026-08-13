import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatRequestHover, sanitizeHoverLabel } from './request-hover';

test('sanitizeHoverLabel strips query strings, userinfo, and tokens', () => {
  assert.equal(
    sanitizeHoverLabel('/users/1?access_token=super-secret-token'),
    '/users/1',
  );
  assert.equal(
    sanitizeHoverLabel('/users/1#access_token=super-secret-token'),
    '/users/1',
  );
  assert.equal(
    sanitizeHoverLabel('https://user:pass@example.com/v1'),
    'https://***@example.com/v1',
  );
  assert.doesNotMatch(
    sanitizeHoverLabel('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb'),
    /eyJhbGci/u,
  );
});

test('formatRequestHover sanitizes unlabeled method+url names', () => {
  const hover = formatRequestHover({
    method: 'GET',
    url: '/users/1?token=abc',
    name: 'GET /users/1?token=abc',
    protocol: 'http',
  });
  assert.equal(hover.title, 'GET /users/1');
  assert.match(hover.body, /Name: GET \/users\/1/u);
  assert.doesNotMatch(hover.body, /token=abc/u);
});
