import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  serializePlaceholderRequest,
  serializeRequestDocument,
  type RequestSourceDocument,
} from './index';

describe('serializeRequestDocument', () => {
  test('emits minimal GET with @name', () => {
    const source = serializeRequestDocument({
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
});

test('serializePlaceholderRequest matches Phase 1b shape', () => {
  assert.equal(
    serializePlaceholderRequest('Login'),
    `@name Login

GET https://httpbin.org/get
`,
  );
});
