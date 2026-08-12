import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapPostmanRequest, collectScriptDiagnostics } from './map-request';

test('maps headers, query params, and JSON body', () => {
  const result = mapPostmanRequest({
    name: 'Create user',
    path: '/item/0/request',
    request: {
      method: 'POST',
      header: [
        { key: 'X-Request-Id', value: 'abc' },
        { key: 'Authorization', value: 'Bearer secret-token' },
      ],
      url: {
        raw: '{{BASE_URL}}/users?active=true&token=secret',
        query: [
          { key: 'active', value: 'true' },
          { key: 'token', value: 'secret' },
        ],
      },
      body: {
        mode: 'raw',
        raw: '{"name":"Ada","password":"nope"}',
        options: { raw: { language: 'json' } },
      },
    },
  });
  assert.equal(result.method, 'POST');
  assert.match(result.content, /POST \{\{BASE_URL\}\}\/users/);
  assert.match(result.content, /active=true/);
  assert.match(result.content, /X-Request-Id: abc/);
  assert.doesNotMatch(result.content, /Bearer secret-token/);
  assert.doesNotMatch(result.content, /"password":"nope"/);
  assert.match(result.content, /"name": "Ada"/);
});

test('maps form-urlencoded and form-data bodies', () => {
  const form = mapPostmanRequest({
    name: 'Form',
    path: '/item/0/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/form',
      body: {
        mode: 'urlencoded',
        urlencoded: [
          { key: 'a', value: '1' },
          { key: 'password', value: 'secret' },
        ],
      },
    },
  });
  assert.match(form.content, /application\/x-www-form-urlencoded/);
  assert.match(form.content, /a=1/);
  assert.doesNotMatch(form.content, /password=secret/);

  const multipart = mapPostmanRequest({
    name: 'Multi',
    path: '/item/1/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/upload',
      body: {
        mode: 'formdata',
        formdata: [
          { key: 'file', type: 'file', src: '/tmp/x.bin' },
          { key: 'note', value: 'hello' },
        ],
      },
    },
  });
  assert.match(multipart.content, /multipart\/form-data|boundary/u);
  assert.ok(
    multipart.diagnostics.some(
      (item) => item.code === 'postman-unsupported-body',
    ),
  );
});

test('preserves {{VAR}} in URL and document variables', () => {
  const result = mapPostmanRequest({
    name: 'Vars',
    path: '/item/0/request',
    documentVariables: [
      { name: 'userId', value: '{{USER_ID}}', sensitive: false },
    ],
    request: {
      method: 'GET',
      url: '{{BASE_URL}}/users/{{userId}}',
    },
  });
  assert.match(result.content, /\{\{BASE_URL\}\}\/users\/\{\{userId\}\}/);
  assert.match(result.content, /@variable userId=\{\{USER_ID\}\}/);
});

test('collectScriptDiagnostics reports prerequest and test', () => {
  const diags = collectScriptDiagnostics(
    [
      { listen: 'prerequest', script: { exec: ['1'] } },
      { listen: 'test', script: { exec: ['2'] } },
      { listen: 'prerequest', disabled: true, script: { exec: ['3'] } },
    ],
    '/event',
    'Collection',
  );
  assert.equal(diags.length, 2);
  assert.ok(diags.every((item) => item.code === 'postman-unsupported-script'));
});

test('path variables convert :id to {{id}}', () => {
  const result = mapPostmanRequest({
    name: 'By id',
    path: '/item/0/request',
    request: {
      method: 'GET',
      url: {
        host: ['{{BASE_URL}}'],
        path: ['users', ':id'],
        variable: [{ key: 'id', value: '1' }],
      },
    },
  });
  assert.match(result.content, /\{\{id\}\}/);
});

test('scrubs GraphQL and raw/text bodies before serialize', () => {
  const gql = mapPostmanRequest({
    name: 'GQL',
    path: '/item/0/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/graphql',
      body: {
        mode: 'graphql',
        graphql: {
          query: 'query { me }',
          variables: { password: 'nope', keep: 1 },
        },
      },
    },
  });
  assert.doesNotMatch(gql.content, /"password":\s*"nope"/);
  assert.match(gql.content, /"keep"/);
  assert.ok(
    gql.diagnostics.some((item) => item.code === 'postman-unsupported-graphql'),
  );

  const raw = mapPostmanRequest({
    name: 'Raw',
    path: '/item/1/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/echo',
      body: {
        mode: 'raw',
        raw: 'Authorization: Bearer tok_live_abc123',
        options: { raw: { language: 'text' } },
      },
    },
  });
  assert.doesNotMatch(raw.content, /tok_live_abc123/);
});

test('masks request description and caps document variables', () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    name: `v${index}`,
    value: `val${index}`,
    sensitive: false,
  }));
  const result = mapPostmanRequest({
    name: 'Desc',
    path: '/item/0/request',
    description: 'Uses Bearer secret-token-value here',
    documentVariables: many,
    request: {
      method: 'GET',
      url: '{{BASE_URL}}/x',
    },
  });
  assert.doesNotMatch(result.content, /secret-token-value/);
  const varLines = result.content
    .split('\n')
    .filter((line) => line.startsWith('@variable '));
  assert.equal(varLines.length, 80);
});
