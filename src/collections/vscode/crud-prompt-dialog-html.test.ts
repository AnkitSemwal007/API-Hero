import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeCrudPromptDescription,
  parseCrudPromptMessage,
  renderCrudPromptDialogHtml,
  validateCrudPromptValue,
} from './crud-prompt-dialog-html';

const SAMPLE_CONFIG = {
  title: 'Rename Collection',
  subtitle: 'Rename the selected collection.',
  fieldLabel: 'Name',
  placeholder: 'My APIs',
  initialValue: 'Demo',
  submitLabel: 'Rename',
};

const CREATE_CONFIG = {
  title: 'Create Collection',
  subtitle: 'Collections live under Collections/ in your workspace.',
  fieldLabel: 'Name',
  placeholder: 'My APIs',
  initialValue: '',
  submitLabel: 'Create',
  descriptionFieldLabel: 'Description',
  descriptionPlaceholder: 'Optional',
  initialDescription: '',
};

test('renderCrudPromptDialogHtml uses nonce CSP and form controls', () => {
  const html = renderCrudPromptDialogHtml('promptNonce', SAMPLE_CONFIG);
  assert.match(html, /style-src 'nonce-promptNonce'/u);
  assert.match(html, /script-src 'nonce-promptNonce'/u);
  assert.match(html, /id="value"/u);
  assert.match(html, /id="cancel"/u);
  assert.match(html, /id="submit"/u);
  assert.match(html, /Rename Collection/u);
  assert.match(html, /Escape/u);
  assert.doesNotMatch(html, /id="description"/u);
});

test('renderCrudPromptDialogHtml includes description when configured', () => {
  const html = renderCrudPromptDialogHtml('promptNonce', CREATE_CONFIG);
  assert.match(html, /Create Collection/u);
  assert.match(html, /Collections live under Collections\//u);
  assert.match(html, /id="description"/u);
  assert.match(html, /Description/u);
  assert.match(html, /placeholder="Optional"/u);
  assert.match(html, />Create</u);
  assert.match(html, /message\.description/u);
});

test('parseCrudPromptMessage accepts submit and rejects junk', () => {
  assert.deepEqual(parseCrudPromptMessage({ type: 'ready' }), {
    type: 'ready',
  });
  assert.deepEqual(parseCrudPromptMessage({ type: 'cancel' }), {
    type: 'cancel',
  });
  assert.deepEqual(
    parseCrudPromptMessage({ type: 'submit', value: '  Demo  ' }),
    { type: 'submit', value: '  Demo  ' },
  );
  assert.deepEqual(
    parseCrudPromptMessage({
      type: 'submit',
      value: 'Demo',
      description: '  Hello  ',
    }),
    { type: 'submit', value: 'Demo', description: '  Hello  ' },
  );
  assert.equal(parseCrudPromptMessage({ type: 'submit' }), undefined);
  assert.equal(parseCrudPromptMessage(null), undefined);
});

test('validateCrudPromptValue requires a non-empty trimmed name', () => {
  assert.deepEqual(validateCrudPromptValue('  Demo  '), { value: 'Demo' });
  assert.equal(validateCrudPromptValue('   ').value, undefined);
  assert.match(validateCrudPromptValue('').error ?? '', /required/iu);
});

test('normalizeCrudPromptDescription trims and drops empty', () => {
  assert.equal(normalizeCrudPromptDescription(undefined), undefined);
  assert.equal(normalizeCrudPromptDescription('  '), undefined);
  assert.equal(normalizeCrudPromptDescription('  Notes  '), 'Notes');
});
