import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  AuthenticatedRequest,
  RuntimeHeader,
  RuntimeVariableResolution,
  VariableValue,
} from '../models';
import { MASKED_HEADER_VALUE } from '../response/presentation';
import { MASKED_VARIABLE_VALUE } from '../variables';
import { generateCurl } from './curl-generator';
import { posixSingleQuote } from './shell-escape';

function resolution(
  overrides: Partial<RuntimeVariableResolution> = {},
): RuntimeVariableResolution {
  return {
    kind: 'resolved',
    presentationUrl: 'https://example.test/users',
    sensitiveVariableNames: [],
    sensitiveHeaderNames: [],
    sensitiveQueryParameterNames: [],
    ...overrides,
  };
}

function authenticated(
  overrides: Partial<AuthenticatedRequest> & {
    readonly method?: AuthenticatedRequest['method'];
    readonly url?: string;
    readonly headers?: readonly RuntimeHeader[];
  } = {},
): AuthenticatedRequest {
  const {
    method = 'GET',
    url = 'https://example.test/users',
    headers = [],
    ...rest
  } = overrides;
  return {
    id: 'req-1',
    method,
    url,
    headers,
    queryParameters: [],
    pathParameters: [],
    cookies: [],
    bodyType: 'none',
    authentication: {
      kind: 'resolved',
      scheme: 'none',
      material: {},
      extensions: {},
    },
    variables: [],
    environment: { kind: 'none', extensions: {} },
    metadata: {
      declarationIndex: 0,
      tags: [],
      extensions: {},
    },
    configuration: { directives: [], extensions: {} },
    redirectPolicy: { mode: 'follow' },
    ssl: { verifyCertificates: true, extensions: {} },
    executionExtensions: {},
    resolution: resolution({ presentationUrl: url }),
    authenticationStage: 'authenticated',
    ...rest,
  };
}

const NO_VALUES = new Map<string, VariableValue>();

test('posixSingleQuote escapes single quotes', () => {
  assert.equal(posixSingleQuote('plain'), `'plain'`);
  assert.equal(posixSingleQuote(`it's`), `'it'\\''s'`);
  assert.equal(posixSingleQuote(`a'b'c`), `'a'\\''b'\\''c'`);
  assert.equal(posixSingleQuote(''), `''`);
});

test('generateCurl requires values when redactSecrets is enabled', () => {
  assert.throws(
    () => generateCurl(authenticated()),
    /options\.values is required/,
  );
});

test('generateCurl builds a basic GET', () => {
  const curl = generateCurl(
    authenticated({
      url: 'https://example.test/users',
      resolution: resolution({
        presentationUrl: 'https://example.test/users',
      }),
    }),
    { values: NO_VALUES },
  );
  assert.equal(curl, `curl 'https://example.test/users'`);
});

test('generateCurl includes query params from presentation URL', () => {
  const curl = generateCurl(
    authenticated({
      url: 'https://example.test/users?page=1&q=ada',
      resolution: resolution({
        presentationUrl: 'https://example.test/users?page=1&q=ada',
      }),
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, /page=1/);
  assert.match(curl, /q=ada/);
});

test('generateCurl includes headers', () => {
  const curl = generateCurl(
    authenticated({
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Trace', value: 'abc' },
      ],
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, /-H 'Accept: application\/json'/);
  assert.match(curl, /-H 'X-Trace: abc'/);
});

test('generateCurl serializes JSON body for POST', () => {
  const curl = generateCurl(
    authenticated({
      method: 'POST',
      bodyType: 'json',
      body: {
        type: 'json',
        content: '{"name":"Ada"}',
        value: { name: 'Ada' },
      },
      headers: [{ name: 'Content-Type', value: 'application/json' }],
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, /-X 'POST'/);
  assert.match(curl, /--data-raw '\{"name":"Ada"\}'/);
});

test('generateCurl supports PUT and PATCH bodies', () => {
  for (const method of ['PUT', 'PATCH'] as const) {
    const curl = generateCurl(
      authenticated({
        method,
        bodyType: 'text',
        body: { type: 'text', content: 'hello' },
      }),
      { values: NO_VALUES },
    );
    assert.match(curl, new RegExp(`-X '${method}'`));
    assert.match(curl, /--data-raw 'hello'/);
  }
});

test('generateCurl uses resolved URL (variables already applied)', () => {
  const curl = generateCurl(
    authenticated({
      url: 'https://api.example.test/v1/items',
      resolution: resolution({
        presentationUrl: 'https://api.example.test/v1/items',
      }),
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, /https:\/\/api\.example\.test\/v1\/items/);
  assert.doesNotMatch(curl, /\{\{/);
});

test('generateCurl redacts bearer Authorization by default', () => {
  const curl = generateCurl(
    authenticated({
      headers: [
        { name: 'Authorization', value: 'Bearer super-secret-token' },
      ],
      authentication: {
        kind: 'resolved',
        scheme: 'bearer',
        material: {},
        extensions: { profileId: 'p1' },
      },
      resolution: resolution({
        sensitiveHeaderNames: ['authorization'],
      }),
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, new RegExp(`Authorization: ${MASKED_HEADER_VALUE}`));
  assert.doesNotMatch(curl, /super-secret-token/);
});

test('generateCurl uses -u for basic auth and redacts credentials', () => {
  const curl = generateCurl(
    authenticated({
      headers: [
        { name: 'Authorization', value: 'Basic dXNlcjpwYXNz' },
      ],
      authentication: {
        kind: 'resolved',
        scheme: 'basic',
        material: {},
        extensions: { profileId: 'basic-1' },
      },
      resolution: resolution({
        sensitiveHeaderNames: ['authorization'],
      }),
    }),
    { values: NO_VALUES },
  );
  assert.match(
    curl,
    new RegExp(`-u '${MASKED_VARIABLE_VALUE}:${MASKED_VARIABLE_VALUE}'`),
  );
  assert.doesNotMatch(curl, /Authorization/);
  assert.doesNotMatch(curl, /dXNlcjpwYXNz/);
});

test('generateCurl redacts apiKey header values', () => {
  const curl = generateCurl(
    authenticated({
      headers: [{ name: 'X-Api-Key', value: 'key-live-123' }],
      authentication: {
        kind: 'resolved',
        scheme: 'apiKey',
        material: {},
        extensions: { profileId: 'key-1' },
      },
      resolution: resolution({
        sensitiveHeaderNames: ['x-api-key'],
      }),
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, new RegExp(`X-Api-Key: ${MASKED_HEADER_VALUE}`));
  assert.doesNotMatch(curl, /key-live-123/);
});

test('generateCurl redacts well-known API key headers without auth metadata', () => {
  const curl = generateCurl(
    authenticated({
      headers: [
        { name: 'X-Api-Key', value: 'hardcoded-key' },
        { name: 'X-Auth-Token', value: 'hardcoded-token' },
      ],
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, new RegExp(`X-Api-Key: ${MASKED_HEADER_VALUE}`));
  assert.match(curl, new RegExp(`X-Auth-Token: ${MASKED_HEADER_VALUE}`));
  assert.doesNotMatch(curl, /hardcoded-key|hardcoded-token/);
});

test('generateCurl uses presentationUrl for sensitive query params', () => {
  const curl = generateCurl(
    authenticated({
      url: 'https://example.test/search?api_key=live-secret&q=hi',
      authentication: {
        kind: 'resolved',
        scheme: 'apiKey',
        material: {},
        extensions: { profileId: 'key-q' },
      },
      resolution: resolution({
        presentationUrl:
          `https://example.test/search?api_key=${MASKED_VARIABLE_VALUE}&q=hi`,
        sensitiveQueryParameterNames: ['api_key'],
      }),
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, new RegExp(`api_key=${MASKED_VARIABLE_VALUE}`));
  assert.doesNotMatch(curl, /live-secret/);
  assert.match(curl, /q=hi/);
});

test('generateCurl redacts sensitive variable values in body', () => {
  const values = new Map<string, VariableValue>([
    [
      'password',
      {
        name: 'password',
        value: 'hunter2',
        scope: 'environment',
        sensitive: true,
      },
    ],
  ]);
  const curl = generateCurl(
    authenticated({
      method: 'POST',
      bodyType: 'json',
      body: {
        type: 'json',
        content: '{"password":"hunter2"}',
        value: { password: 'hunter2' },
      },
      resolution: resolution({
        sensitiveVariableNames: ['password'],
      }),
    }),
    { values },
  );
  assert.match(curl, new RegExp(`"password":"${MASKED_VARIABLE_VALUE}"`));
  assert.doesNotMatch(curl, /hunter2/);
});

test('generateCurl shell-escapes quotes in URL and headers', () => {
  const curl = generateCurl(
    authenticated({
      url: `https://example.test/it's`,
      resolution: resolution({
        presentationUrl: `https://example.test/it's`,
      }),
      headers: [{ name: 'X-Name', value: `O'Brien` }],
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, /example\.test\/it'\\''s/);
  assert.match(curl, /O'\\''Brien/);
});

test('generateCurl skips unsupported binary and non-empty multipart bodies', () => {
  const binary = generateCurl(
    authenticated({
      method: 'POST',
      bodyType: 'binary',
      body: { type: 'binary', content: 'file.bin' },
    }),
    { values: NO_VALUES },
  );
  assert.doesNotMatch(binary, /--data/);

  const multipart = generateCurl(
    authenticated({
      method: 'POST',
      bodyType: 'multipart',
      body: {
        type: 'multipart',
        content: 'part',
        parts: [{ headers: [], extensions: {} }],
      },
    }),
    { values: NO_VALUES },
  );
  assert.doesNotMatch(multipart, /--data/);
});

test('generateCurl none auth leaves headers unchanged when not sensitive', () => {
  const curl = generateCurl(
    authenticated({
      headers: [{ name: 'Accept', value: 'text/plain' }],
      authentication: {
        kind: 'resolved',
        scheme: 'none',
        material: {},
        extensions: {},
      },
    }),
    { values: NO_VALUES },
  );
  assert.match(curl, /-H 'Accept: text\/plain'/);
});
