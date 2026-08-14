import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  serializePlaceholderRequest,
  serializeRequestDocument,
  type RequestSourceDocument,
} from './index';

describe('serializeRequestDocument', () => {
  test('emits minimal GET with @name only (no @id)', () => {
    const source = serializeRequestDocument({
      id: 'req_fixed001',
      name: 'Get user',
      method: 'GET',
      url: 'https://httpbin.org/get',
    });
    assert.equal(
      source,
      `@name Get user

GET https://httpbin.org/get
`,
    );
    assert.doesNotMatch(source, /@id/u);
  });

  test('includes description, auth, variables, headers, and expect', () => {
    const document: RequestSourceDocument = {
      name: 'Create user',
      description: 'Creates a user\nwith details',
      method: 'POST',
      url: 'https://api.example.com/users',
      authProfileId: 'bearer-prod',
      timeoutMs: 1000,
      variables: [{ name: 'tenant', value: 'acme' }],
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Debug', value: '1', enabled: false },
      ],
      body: {
        type: 'json',
        text: '{\n  "name": "Ada"\n}',
      },
      expectLines: ['status == 201', 'expect body.id exists'],
      comments: ['created via New Request'],
    };

    const source = serializeRequestDocument(document);
    assert.match(source, /^# created via New Request\n/u);
    assert.match(source, /@name Create user\n/u);
    assert.match(source, /@description Creates a user with details\n/u);
    assert.match(source, /@auth bearer-prod\n/u);
    assert.match(source, /@timeout 1000\n/u);
    assert.match(source, /@variable tenant=acme\n/u);
    assert.match(source, /POST https:\/\/api\.example\.com\/users\n/u);
    assert.match(source, /Accept: application\/json\n/u);
    assert.match(source, /# X-Debug: 1\n/u);
    assert.match(source, /Content-Type: application\/json\n/u);
    assert.match(source, /\n\{\n {2}"name": "Ada"\n\}\n/u);
    assert.match(source, /expect status == 201\n/u);
    assert.match(source, /expect body\.id exists\n/u);
  });

  test('encodes query params into the URL for parseParameters compatibility', () => {
    const source = serializeRequestDocument({
      name: 'Search',
      method: 'GET',
      url: 'https://api.example.com/search',
      queryParams: [
        { name: 'q', value: 'a b' },
        { name: 'page', value: '1' },
        { name: 'skip', value: 'x', enabled: false },
        { name: 'filter', value: '{{filter}}' },
      ],
    });
    assert.match(
      source,
      /GET https:\/\/api\.example\.com\/search\?q=a\+b&page=1&filter=\{\{filter\}\}\n/u,
    );
  });

  test('appends query params when the URL already has a query', () => {
    const source = serializeRequestDocument({
      name: 'Paged',
      method: 'GET',
      url: 'https://api.example.com/items?sort=name#top',
      queryParams: [{ name: 'limit', value: '10' }],
    });
    assert.match(
      source,
      /GET https:\/\/api\.example\.com\/items\?sort=name&limit=10#top\n/u,
    );
  });

  test('serializes @depends-on human refs after extraction rules and before the request line', () => {
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      extractionRules: [{ name: 'accessToken', from: 'body.access_token' }],
      dependsOn: ['Login', 'Authentication/Cart'],
    });
    assert.match(source, /^@name Products\n/u);
    assert.doesNotMatch(source, /@id/u);
    assert.match(
      source,
      /@extract accessToken from body\.access_token\n@depends-on Login, Authentication\/Cart\n\nGET/u,
    );
  });

  test('does not generate @id when missing', () => {
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
    });
    assert.match(source, /^@name Products\n/u);
    assert.doesNotMatch(source, /@id/u);
  });

  test('omits @depends-on when the list is empty or blank', () => {
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      dependsOn: ['   '],
    });
    assert.doesNotMatch(source, /@depends-on/u);
  });

  test('serializes form, text, raw, multipart, and binary bodies', () => {
    // Form fields are joined with `&` so runtime parseParameters can split them.
    const formSource = serializeRequestDocument({
      name: 'Form',
      method: 'POST',
      url: 'https://example.test/form',
      body: {
        type: 'form',
        fields: [
          { name: 'user', value: 'ada' },
          { name: 'role', value: '{{role}}' },
        ],
      },
    });
    assert.match(
      formSource,
      /Content-Type: application\/x-www-form-urlencoded\n/u,
    );
    assert.match(formSource, /\nuser=ada&role=\{\{role\}\}\n/u);


    assert.match(
      serializeRequestDocument({
        name: 'Text',
        method: 'POST',
        url: 'https://example.test/text',
        body: { type: 'text', text: 'hello' },
      }),
      /Content-Type: text\/plain\n\nhello\n/u,
    );

    assert.match(
      serializeRequestDocument({
        name: 'Raw',
        method: 'POST',
        url: 'https://example.test/raw',
        body: {
          type: 'raw',
          text: '<ok/>',
          contentType: 'application/xml',
        },
      }),
      /Content-Type: application\/xml\n\n<ok\/>\n/u,
    );

    const multipart = serializeRequestDocument({
      name: 'Upload',
      method: 'POST',
      url: 'https://example.test/upload',
      body: {
        type: 'multipart',
        boundary: 'bound',
        fields: [{ name: 'file', value: 'data' }],
      },
    });
    assert.match(
      multipart,
      /Content-Type: multipart\/form-data; boundary=bound\n/u,
    );
    assert.match(multipart, /--bound\n/u);
    assert.match(multipart, /name="file"/u);

    assert.match(
      serializeRequestDocument({
        name: 'Bin',
        method: 'POST',
        url: 'https://example.test/bin',
        body: { type: 'binary', note: 'avatar.png' },
      }),
      /# binary body stub — add file contents manually: avatar\.png\n/u,
    );
  });

  test('does not duplicate Content-Type when already present', () => {
    const source = serializeRequestDocument({
      name: 'Custom',
      method: 'POST',
      url: 'https://example.test',
      headers: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      ],
      body: { type: 'json', text: '{}' },
    });
    const matches = source.match(/Content-Type:/gu) ?? [];
    assert.equal(matches.length, 1);
  });

  test('emits @sensitive-variable when sensitive is true', () => {
    const source = serializeRequestDocument({
      name: 'Auth',
      method: 'GET',
      url: 'https://example.test',
      variables: [
        { name: 'tenant', value: 'acme' },
        { name: 'token', value: 'sekrit', sensitive: true },
      ],
    });
    assert.match(source, /@variable tenant=acme\n/u);
    assert.match(source, /@sensitive-variable token=sekrit\n/u);
  });

  test('emits @extract / @sensitive-extract after variables before the blank line', () => {
    const source = serializeRequestDocument({
      name: 'Login',
      method: 'POST',
      url: 'https://example.test/login',
      variables: [{ name: 'tenant', value: 'acme' }],
      extractionRules: [
        { name: 'accessToken', from: 'body.access_token' },
        {
          name: 'refreshToken',
          from: 'body.refresh_token',
          scope: 'environment',
          sensitive: true,
        },
        {
          name: 'productId',
          from: 'body.data[0].id',
          scope: 'document',
          optional: true,
        },
        {
          name: 'requestId',
          from: 'header X-Request-Id',
          when: 'status:2xx',
        },
        { name: 'code', from: 'status' },
        {
          name: 'disabled',
          from: 'body.x',
          enabled: false,
        },
      ],
    });
    assert.match(
      source,
      /@variable tenant=acme\n@extract accessToken from body\.access_token\n@sensitive-extract refreshToken from body\.refresh_token scope=environment\n@extract productId from body\.data\[0\]\.id scope=document optional\n@extract requestId from header X-Request-Id when=status:2xx\n@extract code from status\n\nPOST /u,
    );
    assert.doesNotMatch(source, /@extract disabled/u);
    assert.doesNotMatch(source, /scope=run/u);
  });
});

test('serializePlaceholderRequest emits @name without @id', () => {
  const source = serializePlaceholderRequest('Login');
  assert.match(source, /^@name Login\n\nGET https:\/\/httpbin\.org\/get\n$/u);
  assert.doesNotMatch(source, /@id/u);
});

test('emits @protocol only when set', () => {
  const omitted = serializeRequestDocument({
    name: 'REST',
    method: 'GET',
    url: 'https://example.test',
  });
  assert.doesNotMatch(omitted, /@protocol/u);

  const graphql = serializeRequestDocument({
    name: 'GetUser',
    method: 'POST',
    url: 'https://example.test/graphql',
    protocol: 'graphql',
    body: { type: 'json', text: '{ "query": "{ ping }" }' },
  });
  assert.match(graphql, /@protocol graphql\n/u);

  const http = serializeRequestDocument({
    name: 'REST',
    method: 'GET',
    url: 'https://example.test',
    protocol: 'http',
  });
  assert.match(http, /@protocol http\n/u);

  const websocket = serializeRequestDocument({
    name: 'Echo',
    method: 'GET',
    url: 'ws://example.test/socket',
    protocol: 'websocket',
    body: { type: 'text', text: 'ping' },
  });
  assert.match(websocket, /@protocol websocket\n/u);
  assert.match(websocket, /GET ws:\/\/example\.test\/socket\n/u);
  assert.match(websocket, /\nping\n/u);
  assert.doesNotMatch(websocket, /Content-Type/u);

  const websocketJson = serializeRequestDocument({
    name: 'EchoJson',
    method: 'GET',
    url: 'ws://example.test/socket',
    protocol: 'websocket',
    body: { type: 'json', text: '{"type":"ping"}' },
  });
  assert.match(websocketJson, /@protocol websocket\n/u);
  assert.doesNotMatch(websocketJson, /Content-Type/u);

  const websocketHandshake = serializeRequestDocument({
    name: 'EchoAuth',
    method: 'GET',
    url: 'wss://example.test/socket',
    protocol: 'websocket',
    headers: [
      { name: 'Content-Type', value: 'application/json', enabled: true },
    ],
    body: { type: 'json', text: '{"type":"ping"}' },
  });
  assert.match(websocketHandshake, /Content-Type: application\/json\n/u);
  assert.equal(
    (websocketHandshake.match(/Content-Type:/gu) ?? []).length,
    1,
  );

  const websocketEmptyUrl = serializeRequestDocument({
    name: 'EchoEmpty',
    method: 'GET',
    url: '',
    protocol: 'websocket',
  });
  assert.match(websocketEmptyUrl, /GET ws:\/\/localhost:8080\/socket\n/u);
  assert.doesNotMatch(websocketEmptyUrl, /httpbin/u);

  const unknown = serializeRequestDocument({
    name: 'Bad',
    method: 'GET',
    url: 'https://example.test',
    protocol: 'mqtt',
  });
  assert.match(unknown, /@protocol mqtt\n/u);
});

test('emits @source only when set', () => {
  const omitted = serializeRequestDocument({
    name: 'Get user',
    method: 'GET',
    url: 'https://example.test/users',
  });
  assert.doesNotMatch(omitted, /@source/u);

  const withSource = serializeRequestDocument({
    name: 'Get user',
    method: 'GET',
    url: 'https://example.test/users',
    source: 'src/services/user.ts:12',
  });
  assert.match(withSource, /@source src\/services\/user\.ts:12\n/u);
});
