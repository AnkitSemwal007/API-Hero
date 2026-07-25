import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clearActiveRequestEditorDocument,
  getActiveRequestEditorDocument,
  setActiveRequestEditorDocument,
} from './active-request-editor';

function fakeDocument(path: string): { uri: { path: string }; languageId: string } {
  return { uri: { path }, languageId: 'api' };
}

test('active request editor tracker sets gets and clears', () => {
  clearActiveRequestEditorDocument();
  assert.equal(getActiveRequestEditorDocument(), undefined);

  const first = fakeDocument('/a.api') as never;
  const second = fakeDocument('/b.api') as never;

  setActiveRequestEditorDocument(first);
  assert.equal(getActiveRequestEditorDocument(), first);

  setActiveRequestEditorDocument(second);
  assert.equal(getActiveRequestEditorDocument(), second);

  // Stale clear must not wipe a newer active document.
  clearActiveRequestEditorDocument(first);
  assert.equal(getActiveRequestEditorDocument(), second);

  clearActiveRequestEditorDocument(second);
  assert.equal(getActiveRequestEditorDocument(), undefined);
});

test('active request editor tracker drops closed documents', () => {
  clearActiveRequestEditorDocument();
  const closed = { ...fakeDocument('/closed.api'), isClosed: true } as never;
  setActiveRequestEditorDocument(closed);
  assert.equal(getActiveRequestEditorDocument(), undefined);
});
