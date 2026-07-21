import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseNewRequestDialogMessage,
  renderNewRequestDialogHtml,
  validateCreateMessage,
} from './new-request-dialog-html';

test('renderNewRequestDialogHtml uses nonce CSP and form controls', () => {
  const html = renderNewRequestDialogHtml('dialogNonce');
  assert.match(html, /style-src 'nonce-dialogNonce'/u);
  assert.match(html, /script-src 'nonce-dialogNonce'/u);
  assert.match(html, /id="name"/u);
  assert.match(html, /id="method"/u);
  assert.match(html, /id="url"/u);
  assert.match(html, /id="collection"/u);
  assert.match(html, /id="folder"/u);
  assert.match(html, /<option value="GET" selected>/u);
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
