import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AstBuilder,
  type ApiHttpMethod,
  parseApiDocument,
  range,
  validateApiDocument,
} from '../parser';
import type { Request, RuntimeRequest } from '../models';
import {
  BuilderInvariantError,
  InvalidRuntimeStateError,
  RequestBuildError,
  buildRequest,
  buildRequests,
  buildSelectedRequest,
  RequestBuilderError,
  RuntimeDomainError,
} from './request-builder';

function parseValid(source: string, sourceId = 'requests.api') {
  const parsed = parseApiDocument(source, { sourceId });
  assert.deepEqual(parsed.diagnostics, []);
  const validation = validateApiDocument(parsed.ast);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.diagnostics, []);
  return parsed.ast;
}

test('builds GET, POST, PUT, PATCH, and DELETE requests in source order', () => {
  const document = parseValid([
    'GET /items',
    '###',
    'POST /items',
    '{}',
    '###',
    'PUT /items/1',
    '[]',
    '###',
    'PATCH /items/1',
    '{"enabled":true}',
    '###',
    'DELETE /items/1',
  ].join('\n'));

  const requests = buildRequests(document);

  assert.deepEqual(
    requests.map((request) => [request.method, request.url, request.bodyType]),
    [
      ['GET', '/items', 'none'],
      ['POST', '/items', 'json'],
      ['PUT', '/items/1', 'json'],
      ['PATCH', '/items/1', 'json'],
      ['DELETE', '/items/1', 'none'],
    ],
  );
  assert.deepEqual(
    requests.map((request) => request.id),
    [
      'requests.api#request-1',
      'requests.api#request-2',
      'requests.api#request-3',
      'requests.api#request-4',
      'requests.api#request-5',
    ],
  );
  assert.ok(Object.isFrozen(requests));
});

test('builds only a selected canonical request with its source-order identity', () => {
  const document = parseValid([
    'GET /first',
    '###',
    'POST /second',
  ].join('\n'));
  const selected = buildSelectedRequest(document, document.requests[1]!);

  assert.equal(selected.method, 'POST');
  assert.equal(selected.url, '/second');
  assert.equal(selected.id, 'requests.api#request-2');
  assert.throws(
    () => buildSelectedRequest(
      document,
      parseValid('GET /foreign').requests[0]!,
    ),
    BuilderInvariantError,
  );
});

test('normalizes runtime configuration without resolving placeholders', () => {
  const request = buildRequest(parseValid([
    '@connection {{connection}}',
    '@auth {{credential}}',
    '@timeout 2500',
    '@description Runtime-safe metadata',
    '@tag global',
    'GET https://{{host}}/users/{{userId}}?filter={{filter}}&x=1&x=&flag#part',
    '@name Get user',
    '@tag detail',
    'Accept: application/json',
    'X-Token: {{token}}',
  ].join('\n')));

  assert.equal(request.name, 'Get user');
  assert.equal(request.timeoutMs, 2500);
  assert.deepEqual(request.authentication, {
    kind: 'unresolved',
    reference: '{{credential}}',
    extensions: {},
  });
  assert.equal(request.configuration.connectionReference, '{{connection}}');
  assert.deepEqual(request.environment, {
    kind: 'unresolved',
    reference: '{{connection}}',
    extensions: {},
  });
  assert.deepEqual(request.cookies, []);
  assert.deepEqual(request.executionExtensions, {});
  assert.deepEqual(request.metadata, {
    sourceId: 'requests.api',
    declarationIndex: 0,
    description: 'Runtime-safe metadata',
    tags: ['global', 'detail'],
    extensions: {},
  });
  assert.deepEqual(request.headers, [
    { name: 'Accept', value: 'application/json' },
    { name: 'X-Token', value: '{{token}}' },
  ]);
  assert.deepEqual(request.queryParameters, [
    { name: 'filter', value: '{{filter}}' },
    { name: 'x', value: '1' },
    { name: 'x', value: '' },
    { name: 'flag' },
  ]);
  assert.deepEqual(request.pathParameters, [
    { name: 'userId', originalText: '{{userId}}' },
  ]);
  assert.deepEqual(
    request.variables.map((variable) => variable.originalText),
    [
      '{{connection}}',
      '{{credential}}',
      '{{host}}',
      '{{userId}}',
      '{{filter}}',
      '{{token}}',
    ],
  );
  assert.equal(
    request.url,
    'https://{{host}}/users/{{userId}}?filter={{filter}}&x=1&x=&flag#part',
  );
  assert.deepEqual(
    request.configuration.directives.map(({ name, value }) => [name, value]),
    [
      ['connection', '{{connection}}'],
      ['auth', '{{credential}}'],
      ['timeout', '2500'],
      ['description', 'Runtime-safe metadata'],
      ['tag', 'global'],
      ['name', 'Get user'],
      ['tag', 'detail'],
    ],
  );
});

test('preserves JSON source and creates a detached immutable JSON value', () => {
  const document = parseValid([
    'POST /items',
    'Content-Type: application/json',
    '{"name":"{{name}}","nested":{"items":[1,true,null]}}',
  ].join('\n'));
  const astBody = document.requests[0]?.body;
  const request = buildRequest(document);

  assert.equal(request.bodyType, 'json');
  assert.equal(
    request.body?.content,
    '{"name":"{{name}}","nested":{"items":[1,true,null]}}',
  );
  assert.equal(request.body?.type, 'json');
  if (request.body?.type !== 'json') {
    assert.fail('Expected JSON request body.');
  }
  assert.deepEqual(request.body.value, {
    name: '{{name}}',
    nested: { items: [1, true, null] },
  });
  assert.notEqual(request.body.value, astBody);
  assertDeepFrozen(request.body.value);
});

test('projects __proto__ JSON keys as own enumerable frozen data properties', () => {
  const source = [
    'POST /items',
    'Content-Type: application/json',
    '{"__proto__":{"polluted":true},"items":[1]}',
  ].join('\n');
  const document = parseValid(source);
  const request = buildRequest(document, validateApiDocument(document));

  assert.equal(request.body?.type, 'json');
  if (request.body?.type !== 'json') {
    assert.fail('Expected JSON request body.');
  }
  assert.equal(
    request.body.content,
    '{"__proto__":{"polluted":true},"items":[1]}',
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(request.body.value, '__proto__')?.enumerable,
    true,
  );
  assert.ok(Object.prototype.hasOwnProperty.call(request.body.value, '__proto__'));
  const protoValue = (request.body.value as { __proto__: { polluted: boolean } })['__proto__'];
  assert.deepEqual(protoValue, { polluted: true });
  assert.equal(Object.getPrototypeOf(request.body.value), Object.prototype);
  assert.equal(
    (request.body.value as { polluted?: boolean }).polluted,
    undefined,
  );
  assertDeepFrozen(protoValue);
  assert.throws(() => {
    (protoValue as { polluted: boolean }).polluted = false;
  }, TypeError);
  assertDeepFrozen(request.body.value);
});

test('classifies canonical text and form bodies without decoding data', () => {
  const textBuilder = new AstBuilder('text.api');
  const textBody = textBuilder.textBody({
    content: 'hello {{name}}',
    range: range(30, 44),
  });
  const textNode = textBuilder.request({
    method: 'POST',
    url: '/messages',
    body: textBody,
    range: range(0, 44),
  });
  const textDocument = textBuilder.document({
    requests: [textNode],
    range: range(0, 44),
  });
  const formBuilder = new AstBuilder('form.api');
  const contentType = formBuilder.header(
    'Content-Type',
    'application/x-www-form-urlencoded',
    { range: range(15, 63) },
  );
  const formBody = formBuilder.rawBody({
    content: 'name=Ada%20Lovelace&role=admin&role=&flag',
    range: range(64, 108),
  });
  const formNode = formBuilder.request({
    method: 'PUT',
    url: '/profiles',
    headers: [contentType],
    body: formBody,
    range: range(0, 108),
  });
  const formDocument = formBuilder.document({
    requests: [formNode],
    range: range(0, 108),
  });

  assert.equal(validateApiDocument(textDocument).valid, true);
  assert.equal(validateApiDocument(formDocument).valid, true);
  const text = buildRequest(textDocument);
  const form = buildRequest(formDocument);

  assert.deepEqual(text.body, {
    type: 'text',
    content: 'hello {{name}}',
  });
  assert.equal(form.body?.type, 'form');
  if (form.body?.type !== 'form') {
    assert.fail('Expected form request body.');
  }
  assert.deepEqual(form.body.fields, [
    { name: 'name', value: 'Ada%20Lovelace' },
    { name: 'role', value: 'admin' },
    { name: 'role', value: '' },
    { name: 'flag' },
  ]);
});

test('preserves raw bodies and normalizes insignificant request whitespace', () => {
  const builder = new AstBuilder('raw.api');
  const rawBody = builder.rawBody({
    content: '  opaque {{value}}\r\n',
    range: range(30, 50),
  });
  const header = builder.header(' X-Custom ', '  value  ', {
    range: range(10, 29),
  });
  const node = builder.request({
    method: 'PATCH',
    url: '  /items/{{id}}?encoded=a%20b  ',
    headers: [header],
    body: rawBody,
    range: range(0, 50),
  });
  const document = builder.document({ requests: [node], range: range(0, 50) });

  const request = buildRequest(document);

  assert.equal(request.url, '/items/{{id}}?encoded=a%20b');
  assert.deepEqual(request.headers, [{ name: 'X-Custom', value: 'value' }]);
  assert.deepEqual(request.queryParameters, [
    { name: 'encoded', value: 'a%20b' },
  ]);
  assert.deepEqual(request.body, {
    type: 'raw',
    content: '  opaque {{value}}\r\n',
  });
});

test('projects representable multipart AST bodies as unresolved placeholders', () => {
  const builder = new AstBuilder('multipart.api');
  const body = builder.multipartBody('--boundary\r\nraw', {
    range: range(20, 35),
  });
  const requestNode = builder.request({
    method: 'POST',
    url: '/upload',
    body,
    range: range(0, 35),
  });
  const document = builder.document({
    requests: [requestNode],
    range: range(0, 35),
  });

  assert.equal(validateApiDocument(document).valid, true);
  assert.deepEqual(buildRequest(document).body, {
    type: 'multipart',
    content: '--boundary\r\nraw',
    parts: [],
  });
});

test('rejects missing, ambiguous, and invalid build targets as precondition errors', () => {
  const empty = parseApiDocument('').ast;
  const multiple = parseValid('GET /one\n###\nGET /two');
  const invalidTimeout = parseApiDocument(
    'GET /slow\n@timeout 999999999999999999999',
  ).ast;
  const builder = new AstBuilder();
  const malformed = builder.request({
    method: '' as ApiHttpMethod,
    url: '',
    range: range(0, 0),
  });
  const malformedDocument = builder.document({
    requests: [malformed],
    range: range(0, 0),
  });

  assertBuilderError(() => buildRequest(empty), 'REQUEST_COUNT');
  assertBuilderError(() => buildRequest(multiple), 'REQUEST_COUNT');
  assertBuilderError(() => buildRequest(malformedDocument), 'INVALID_REQUEST');
  assert.equal(validateApiDocument(invalidTimeout).valid, false);
  assertBuilderError(
    () => buildRequest(invalidTimeout),
    'INVALID_DIRECTIVE',
  );
  assertBuilderError(
    () => buildRequest(invalidTimeout, validateApiDocument(invalidTimeout)),
    'INVALID_VALIDATION',
  );
});

test('exposes one coherent runtime error hierarchy', () => {
  const error = new BuilderInvariantError('INVALID_REQUEST', 'invalid');

  assert.ok(error instanceof BuilderInvariantError);
  assert.ok(error instanceof RequestBuilderError);
  assert.ok(error instanceof RequestBuildError);
  assert.ok(error instanceof RuntimeDomainError);
  assert.ok(new InvalidRuntimeStateError('unresolved') instanceof RuntimeDomainError);
});

test('preserves Request compatibility as an alias of RuntimeRequest', () => {
  const parsed = parseApiDocument('GET /compatibility');
  const validation = validateApiDocument(parsed.ast);
  assert.equal(validation.valid, true);
  const built = buildRequest(parsed.ast, validation);
  const runtime: RuntimeRequest = built;
  const legacy: Request = runtime;

  assert.equal(legacy, runtime);
  assert.equal(legacy.method, 'GET');
});

test('does not alias AST values and deeply freezes every produced value', () => {
  const document = parseValid([
    '@auth token',
    'POST /items/{{id}}?a=1&a=2',
    '@name Create',
    'X-Test: value',
    '{"nested":{"enabled":true}}',
  ].join('\n'));
  const request = buildRequest(document);

  assert.notEqual(request.headers, document.requests[0]?.headers);
  assert.notEqual(request.configuration.directives, document.directives);
  assertDeepFrozen(request);
  assert.throws(() => {
    (request.headers as { name: string; value: string }[]).push({
      name: 'Injected',
      value: 'true',
    });
  }, TypeError);
  assert.throws(() => {
    (request.metadata as { declarationIndex: number }).declarationIndex = 5;
  }, TypeError);
});

function assertBuilderError(
  action: () => unknown,
  code: RequestBuilderError['code'],
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof RequestBuilderError);
    assert.equal(error.code, code);
    return true;
  });
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    assertDeepFrozen(child);
  }
}
