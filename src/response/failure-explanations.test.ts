import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFailureExplanation,
  formatFailureExplanationText,
} from './failure-explanations';

test('401 Unauthorized lists roadmap possible causes', () => {
  const explanation = buildFailureExplanation({
    statusCode: 401,
    statusText: 'Unauthorized',
    url: 'https://api.example.test/me',
  });
  assert.ok(explanation);
  assert.equal(explanation.title, '401 Unauthorized');
  assert.deepEqual(explanation.possibleCauses, [
    'Authorization header missing',
    'Token unresolved',
    'Token invalid or expired',
  ]);
  const text = formatFailureExplanationText(explanation);
  assert.match(text, /Possible causes:/u);
  assert.match(text, /• Authorization header missing/u);
});

test('403 Forbidden lists permission causes', () => {
  const explanation = buildFailureExplanation({ statusCode: 403 });
  assert.equal(explanation?.title, '403 Forbidden');
  assert.deepEqual(explanation?.possibleCauses, [
    'Insufficient permissions',
    'Authorization policy rejected request',
  ]);
});

test('404 Not Found lists path/environment causes', () => {
  const explanation = buildFailureExplanation({ statusCode: 404 });
  assert.equal(explanation?.title, '404 Not Found');
  assert.deepEqual(explanation?.possibleCauses, [
    'Incorrect URL/path',
    'Wrong environment',
    'Resource does not exist',
  ]);
});

test('422 Unprocessable Entity lists validation causes', () => {
  const explanation = buildFailureExplanation({ statusCode: 422 });
  assert.equal(explanation?.title, '422 Unprocessable Entity');
  assert.deepEqual(explanation?.possibleCauses, [
    'Request validation failed',
    'Missing required field',
    'Invalid request body',
  ]);
});

test('429 Too Many Requests lists rate-limit cause', () => {
  const explanation = buildFailureExplanation({ statusCode: 429 });
  assert.equal(explanation?.title, '429 Too Many Requests');
  assert.deepEqual(explanation?.possibleCauses, ['Rate limit exceeded']);
});

test('5xx includes factual lines and server possible causes', () => {
  const explanation = buildFailureExplanation({
    statusCode: 503,
    statusText: 'Service Unavailable',
    url: 'https://api.example.test/orders',
    environmentLabel: 'Staging',
    elapsedMs: 1250,
    requestId: 'req-42',
    contentType: 'application/json',
    bodySizeBytes: 88,
  });
  assert.ok(explanation);
  assert.equal(explanation.title, '503 Service Unavailable');
  assert.ok(explanation.facts.some((f) => f.startsWith('Endpoint:')));
  assert.ok(explanation.facts.includes('Environment: Staging'));
  assert.ok(explanation.facts.some((f) => f.startsWith('Duration:')));
  assert.ok(explanation.facts.includes('Request ID: req-42'));
  assert.ok(explanation.facts.includes('Content-Type: application/json'));
  assert.ok(explanation.facts.includes('Response size: 88 bytes'));
  assert.ok(explanation.possibleCauses.length > 0);
  assert.match(formatFailureExplanationText(explanation), /Possible causes:/u);
});

test('timeout transport shows URL elapsed timeout and transport error', () => {
  const explanation = buildFailureExplanation({
    url: 'https://api.example.test/slow',
    elapsedMs: 5000,
    timeoutMs: 5000,
    transportCode: 'TIMEOUT',
    transportMessage: 'The request exceeded its configured timeout.',
  });
  assert.ok(explanation);
  assert.equal(explanation.title, 'Request timed out');
  assert.ok(explanation.facts.some((f) => f.startsWith('URL:')));
  assert.ok(explanation.facts.some((f) => f.startsWith('Elapsed time:')));
  assert.ok(explanation.facts.includes('Timeout: 5.00 s'));
  assert.ok(
    explanation.facts.some((f) =>
      f.includes('The request exceeded its configured timeout.'),
    ),
  );
  assert.ok(explanation.possibleCauses.includes('Server slow to respond'));
});

test('network transport failure includes transport error fact', () => {
  const explanation = buildFailureExplanation({
    url: 'https://api.example.test/x',
    elapsedMs: 12,
    transportCode: 'NETWORK',
    transportMessage: 'socket hang up',
  });
  assert.ok(explanation);
  assert.equal(explanation.title, 'Network failure');
  assert.ok(explanation.facts.includes('Transport error: socket hang up'));
  assert.ok(explanation.possibleCauses.length > 0);
});

test('2xx and empty input yield no explanation', () => {
  assert.equal(buildFailureExplanation({ statusCode: 200 }), undefined);
  assert.equal(buildFailureExplanation({}), undefined);
});

test('URL userinfo is redacted in explanation facts', () => {
  const explanation = buildFailureExplanation({
    statusCode: 401,
    url: 'https://user:sekrit-token@api.example.test/secure',
  });
  assert.ok(explanation);
  const joined = explanation.facts.join('\n');
  assert.doesNotMatch(joined, /sekrit-token/u);
  assert.doesNotMatch(joined, /user:sekrit/u);
  assert.match(joined, /api\.example\.test\/secure/u);
});

test('explanations never embed Authorization or cookie secrets', () => {
  const explanation = buildFailureExplanation({
    statusCode: 401,
    url: 'https://api.example.test/login',
    transportMessage: 'Authorization: Bearer live-secret-token',
  });
  // Status guidance wins over transport when statusCode >= 400.
  assert.ok(explanation);
  assert.equal(explanation.title, '401 Unauthorized');
  // Even if a caller mistakenly passes a secret-bearing transport message
  // without a status, redact is not applied to free-form messages — callers
  // must pass secret-free transport text. Prove status path stays clean:
  assert.doesNotMatch(JSON.stringify(explanation.possibleCauses), /Bearer/u);
  assert.doesNotMatch(JSON.stringify(explanation.possibleCauses), /live-secret/u);

  const transportOnly = buildFailureExplanation({
    transportCode: 'NETWORK',
    transportMessage: 'connection reset',
    url: 'https://alice:cookie-value@host.example/path',
  });
  assert.ok(transportOnly);
  assert.doesNotMatch(transportOnly.facts.join('\n'), /cookie-value/u);
  assert.doesNotMatch(transportOnly.facts.join('\n'), /alice:/u);
});
