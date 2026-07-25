import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildNonceOnlyCsp,
  createWebviewNonce,
  escapeAttribute,
  escapeHtml,
  isWebviewMessageRecord,
  methodBadgeClass,
  WEBVIEW_SHARED_CSS,
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

  test('WEBVIEW_SHARED_CSS exposes spacing tokens and chrome primitives', () => {
    assert.match(WEBVIEW_SHARED_CSS, /--ah-space-1:\s*4px/u);
    assert.match(WEBVIEW_SHARED_CSS, /button\.primary/u);
    assert.match(WEBVIEW_SHARED_CSS, /\.status-badge/u);
    assert.match(WEBVIEW_SHARED_CSS, /\.empty-state/u);
    assert.match(WEBVIEW_SHARED_CSS, /\.method-badge/u);
    assert.match(WEBVIEW_SHARED_CSS, /\.method-get/u);
  });

  test('methodBadgeClass maps known methods and falls back for others', () => {
    assert.equal(methodBadgeClass('get'), 'method-badge method-get');
    assert.equal(methodBadgeClass(' POST '), 'method-badge method-post');
    assert.equal(methodBadgeClass('PUT'), 'method-badge method-put');
    assert.equal(methodBadgeClass('patch'), 'method-badge method-patch');
    assert.equal(methodBadgeClass('DELETE'), 'method-badge method-delete');
    assert.equal(methodBadgeClass('HEAD'), 'method-badge method-head');
    assert.equal(methodBadgeClass('OPTIONS'), 'method-badge method-options');
    assert.equal(methodBadgeClass('CUSTOM'), 'method-badge method-other');
    assert.equal(methodBadgeClass(''), 'method-badge method-other');
  });
});
