import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseDestinationPickerMessage,
  renderDestinationPickerDialogHtml,
  validateDestinationPickerSelection,
} from './destination-picker-dialog-html';

const DESTINATIONS = [
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

const SAMPLE_CONFIG = {
  title: 'Move Request',
  subtitle: 'Choose a collection folder.',
  destinations: DESTINATIONS,
  submitLabel: 'Move Here',
};

test('renderDestinationPickerDialogHtml uses nonce CSP and selects', () => {
  const html = renderDestinationPickerDialogHtml('destNonce', SAMPLE_CONFIG);
  assert.match(html, /style-src 'nonce-destNonce'/u);
  assert.match(html, /script-src 'nonce-destNonce'/u);
  assert.match(html, /id="collection"/u);
  assert.match(html, /id="folder"/u);
  assert.match(html, /Move Request/u);
  assert.match(html, /Escape/u);
});

test('parseDestinationPickerMessage accepts submit and rejects junk', () => {
  assert.deepEqual(parseDestinationPickerMessage({ type: 'ready' }), {
    type: 'ready',
  });
  assert.deepEqual(parseDestinationPickerMessage({ type: 'cancel' }), {
    type: 'cancel',
  });
  assert.deepEqual(
    parseDestinationPickerMessage({
      type: 'submit',
      collectionId: 'c1',
      folderRelativePath: 'Auth',
    }),
    {
      type: 'submit',
      collectionId: 'c1',
      folderRelativePath: 'Auth',
    },
  );
  assert.equal(
    parseDestinationPickerMessage({ type: 'submit', collectionId: 'c1' }),
    undefined,
  );
  assert.equal(parseDestinationPickerMessage(null), undefined);
});

test('validateDestinationPickerSelection allowlists destinations', () => {
  const ok = validateDestinationPickerSelection(
    { collectionId: 'c1', folderRelativePath: 'Auth' },
    DESTINATIONS,
  );
  assert.equal(ok.error, undefined);
  assert.equal(ok.collectionId, 'c1');
  assert.equal(ok.folderRelativePath, 'Auth');

  const rejected = validateDestinationPickerSelection(
    { collectionId: 'c1', folderRelativePath: '../escape' },
    DESTINATIONS,
  );
  assert.equal(rejected.collectionId, undefined);
  assert.match(rejected.error ?? '', /valid collection folder/iu);
});
