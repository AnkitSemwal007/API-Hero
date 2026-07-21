import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildNonceOnlyCsp,
  createWebviewNonce,
  escapeAttribute,
  escapeHtml,
  isWebviewMessageRecord,
} from './index';

describe('ui/webview helpers', () => {
  test('escapeHtml neutralizes markup breakouts', () => {
    assert.equal(escapeHtml(`a<b>"c"'`), 'a&lt;b&gt;&quot;c&quot;&#39;');
    assert.equal(escapeHtml('a&b'), 'a&amp;b');
  });

  test('escapeAttribute also escapes backticks', () => {
    assert.equal(escapeAttribute(`a"b'\``), 'a&quot;b&#39;&#96;');
  });

  test('buildNonceOnlyCsp uses img-src none by default', () => {
    assert.equal(
      buildNonceOnlyCsp('abc123'),
      "default-src 'none'; style-src 'nonce-abc123'; script-src 'nonce-abc123'; " +
        "font-src 'none'; connect-src 'none'; img-src 'none'; frame-src 'none'; " +
        "object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  test('buildNonceOnlyCsp allows data images when requested', () => {
    assert.equal(
      buildNonceOnlyCsp('xyz', { allowDataImages: true }),
      "default-src 'none'; img-src data:; style-src 'nonce-xyz'; " +
        "script-src 'nonce-xyz'; font-src 'none'; connect-src 'none'; " +
        "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  test('buildNonceOnlyCsp escapes nonce for attribute safety', () => {
    assert.match(
      buildNonceOnlyCsp(`a"b`),
      /nonce-a&quot;b/u,
    );
  });

  test('createWebviewNonce returns a non-empty base64url string', () => {
    const nonce = createWebviewNonce();
    assert.ok(nonce.length > 0);
    assert.match(nonce, /^[A-Za-z0-9_-]+$/u);
  });

  test('isWebviewMessageRecord accepts plain objects only', () => {
    assert.equal(isWebviewMessageRecord({ type: 'ready' }), true);
    assert.equal(isWebviewMessageRecord(null), false);
    assert.equal(isWebviewMessageRecord([]), false);
    assert.equal(isWebviewMessageRecord('x'), false);
    assert.equal(isWebviewMessageRecord(undefined), false);
  });
});
