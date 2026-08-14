import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseNewRequestDialogMessage,
  renderNewRequestDialogHtml,
  validateCreateMessage,
} from './new-request-dialog-html';
import { serializeRequestDocument } from '../../request-source';

test('renderNewRequestDialogHtml uses nonce CSP and form controls', () => {
  const html = renderNewRequestDialogHtml('dialogNonce');
  assert.match(html, /style-src 'nonce-dialogNonce'/u);
  assert.match(html, /script-src 'nonce-dialogNonce'/u);
  assert.match(html, /id="name"/u);
  assert.match(html, /id="method"/u);
  assert.match(html, /id="url"/u);
  assert.match(html, /id="collection"/u);
  assert.match(html, /id="folder"/u);
  assert.match(html, /id="protocol"/u);
  assert.match(html, /<option value="">HTTP<\/option>/u);
  assert.match(html, /<option value="graphql">GraphQL<\/option>/u);
  assert.match(html, /<option value="websocket">WebSocket<\/option>/u);
  assert.match(html, /<option value="GET" selected>/u);
  assert.match(html, /Escape/u);
});

test('parseNewRequestDialogMessage accepts create and rejects junk', () => {
  assert.deepEqual(parseNewRequestDialogMessage({ type: 'ready' }), {
    type: 'ready',
  });
  assert.deepEqual(parseNewRequestDialogMessage({ type: 'cancel' }), {
    type: 'cancel',
  });
  assert.deepEqual(
    parseNewRequestDialogMessage({
      type: 'create',
      name: 'Login',
      method: 'POST',
      url: 'https://example.test/login',
      description: 'Auth',
      collectionId: 'c1',
      folderRelativePath: 'Auth',
    }),
    {
      type: 'create',
      name: 'Login',
      method: 'POST',
      url: 'https://example.test/login',
      description: 'Auth',
      collectionId: 'c1',
      folderRelativePath: 'Auth',
    },
  );
  assert.equal(parseNewRequestDialogMessage({ type: 'create' }), undefined);
  assert.equal(parseNewRequestDialogMessage(null), undefined);
  assert.deepEqual(
    parseNewRequestDialogMessage({
      type: 'create',
      name: 'GetUser',
      method: 'POST',
      url: 'https://example.test/graphql',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '',
      protocol: 'graphql',
    }),
    {
      type: 'create',
      name: 'GetUser',
      method: 'POST',
      url: 'https://example.test/graphql',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '',
      protocol: 'graphql',
    },
  );
});

test('validateCreateMessage allowlists destination against dialog options', () => {
  const destinations = [
    {
      collectionId: 'c1',
      collectionLabel: 'Demo',
      folderRelativePath: '',
      folderLabel: '(collection root)',
    },
    {
      collectionId: 'c1',
      collectionLabel: 'Demo',
      folderRelativePath: 'Auth',
      folderLabel: 'Auth',
    },
  ];

  const ok = validateCreateMessage(
    {
      name: 'Login',
      method: 'POST',
      url: 'https://example.test/login',
      description: '',
      collectionId: 'c1',
      folderRelativePath: 'Auth',
    },
    destinations,
  );
  assert.equal(ok.error, undefined);
  assert.equal(ok.model?.name, 'Login');

  const rejected = validateCreateMessage(
    {
      name: 'Login',
      method: 'POST',
      url: 'https://example.test/login',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '../escape',
    },
    destinations,
  );
  assert.equal(rejected.model, undefined);
  assert.match(rejected.error ?? '', /valid collection folder/iu);
});

test('validateCreateMessage seeds GraphQL protocol, POST, envelope, and Content-Type', () => {
  const destinations = [
    {
      collectionId: 'c1',
      collectionLabel: 'Demo',
      folderRelativePath: '',
      folderLabel: '(collection root)',
    },
  ];
  const created = validateCreateMessage(
    {
      name: 'GetUser',
      method: 'GET',
      url: 'https://api.example.com/graphql',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '',
      protocol: 'graphql',
    },
    destinations,
  );
  assert.equal(created.error, undefined);
  assert.equal(created.model?.protocol, 'graphql');
  assert.equal(created.model?.method, 'POST');
  assert.equal(created.model?.body?.type, 'json');
  if (created.model?.body?.type === 'json') {
    assert.match(created.model.body.text, /"query"/u);
    assert.match(created.model.body.text, /query \{/u);
  }
  assert.equal(
    created.model?.headers?.some(
      (header) =>
        header.name === 'Content-Type' && header.value === 'application/json',
    ),
    true,
  );
  assert.match(
    serializeRequestDocument(created.model!),
    /@protocol graphql\n/u,
  );

  const http = validateCreateMessage(
    {
      name: 'REST',
      method: 'GET',
      url: 'https://example.test/users',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '',
    },
    destinations,
  );
  assert.equal(http.model?.protocol, undefined);

  const websocket = validateCreateMessage(
    {
      name: 'Echo',
      method: 'GET',
      url: 'ws://example.test/socket',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '',
      protocol: 'websocket',
    },
    destinations,
  );
  assert.equal(websocket.model?.protocol, 'websocket');

  const unknown = validateCreateMessage(
    {
      name: 'Bad',
      method: 'GET',
      url: 'https://example.test',
      description: '',
      collectionId: 'c1',
      folderRelativePath: '',
      protocol: 'mqtt',
    },
    destinations,
  );
  assert.equal(unknown.model, undefined);
  assert.match(unknown.error ?? '', /Unsupported protocol/u);
});
