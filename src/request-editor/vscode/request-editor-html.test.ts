/**
 * Unit tests for request editor message parsing and HTML generation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  emptyRequestEditorModel,
  escapeAttribute,
  renderRequestEditorHtml,
} from './request-editor-html';
import {
  maskSensitiveVariablesForWebview,
  parseRequestEditorMessage,
  parseRequestSourceDocument,
  redactSensitiveVariablesInSource,
  restoreSensitiveVariablesFromBaseline,
  SENSITIVE_VARIABLE_MASK,
} from './request-editor-messages';

describe('request editor webview helpers', () => {
  test('renderRequestEditorHtml embeds CSP nonce and tabs', () => {
    const html = renderRequestEditorHtml('abc123');
    assert.match(html, /script-src 'nonce-abc123'/u);
    assert.match(html, /style-src 'nonce-abc123'/u);
    assert.match(html, /data-tab="request"/u);
    assert.match(html, /data-tab="params"/u);
    assert.match(html, /data-tab="headers"/u);
    assert.match(html, /data-tab="body"/u);
    assert.match(html, /data-tab="auth"/u);
    assert.match(html, /data-tab="variables"/u);
    assert.match(html, /data-tab="tests"/u);
    assert.match(html, /data-tab="settings"/u);
    assert.match(html, /data-tab="preview"/u);
    assert.match(html, /id="run"/u);
    assert.match(html, /id="openText"/u);
    assert.match(html, /id="envShortcut"/u);
    assert.match(html, /id="authShortcut"/u);
    assert.match(html, /id="method"/u);
    assert.match(html, /id="url"/u);
    assert.match(html, /class="run-row"/u);
    assert.match(html, /id="manageAuthProfiles"/u);
    assert.match(html, /id="manageEnvironments"/u);
    assert.match(html, /Manage Authentication/u);
    assert.match(html, /Manage Environments/u);
    // Tab order: Request, Headers, Params, …
    const headersAt = html.indexOf('data-tab="headers"');
    const paramsAt = html.indexOf('data-tab="params"');
    assert.ok(headersAt > 0 && paramsAt > headersAt);
    assert.match(html, /--vscode-editor-background/u);
    assert.match(html, /--vscode-button-background/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
    assert.doesNotMatch(html, /rgba\(255,\s*200,\s*0/u);
  });

  test('escapeAttribute neutralizes quote breakouts', () => {
    assert.equal(
      escapeAttribute(`a"b'`),
      'a&quot;b&#39;',
    );
  });

  test('parseRequestEditorMessage accepts toolbar and lifecycle messages', () => {
    assert.deepEqual(parseRequestEditorMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseRequestEditorMessage({ type: 'run' }), {
      type: 'run',
    });
    assert.deepEqual(parseRequestEditorMessage({ type: 'openTextEditor' }), {
      type: 'openTextEditor',
    });
    assert.deepEqual(parseRequestEditorMessage({ type: 'switchEnvironment' }), {
      type: 'switchEnvironment',
    });
    assert.deepEqual(
      parseRequestEditorMessage({ type: 'selectAuthentication' }),
      { type: 'selectAuthentication' },
    );
    assert.deepEqual(
      parseRequestEditorMessage({ type: 'manageAuthProfiles' }),
      { type: 'manageAuthProfiles' },
    );
    assert.deepEqual(
      parseRequestEditorMessage({ type: 'manageEnvironments' }),
      { type: 'manageEnvironments' },
    );
  });

  test('parseRequestEditorMessage validates updateModel payloads', () => {
    const model = emptyRequestEditorModel();
    assert.equal(
      parseRequestEditorMessage({
        type: 'updateModel',
        documentVersion: 3,
        model,
      })?.type,
      'updateModel',
    );
    assert.equal(
      parseRequestEditorMessage({
        type: 'updateModel',
        documentVersion: 3,
        model: { name: 1 },
      }),
      undefined,
    );
    assert.equal(parseRequestEditorMessage({ type: 'nope' }), undefined);
  });

  test('parseRequestSourceDocument rejects invalid nested shapes', () => {
    assert.equal(
      parseRequestSourceDocument({
        name: 'X',
        method: 'TRACE',
        url: 'https://example.test',
      }),
      undefined,
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'X',
        method: 'GET',
        url: 'https://example.test',
        headers: [{ name: 1, value: 'x' }],
      }),
      undefined,
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'X',
        method: 'GET',
        url: 'https://example.test',
        body: { type: 'json' },
      }),
      undefined,
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'X',
        method: 'post',
        url: 'https://example.test',
        variables: [{ name: 'a', value: 'b', sensitive: true }],
      })?.method,
      'POST',
    );
  });

  test('masks and restores sensitive variables for the webview', () => {
    const baseline = {
      name: 'S',
      method: 'GET' as const,
      url: 'https://example.test',
      variables: [
        { name: 'public', value: 'ok' },
        { name: 'token', value: 'sekrit', sensitive: true as const },
      ],
    };
    const masked = maskSensitiveVariablesForWebview(baseline);
    assert.deepEqual(masked.variables, [
      { name: 'public', value: 'ok' },
      { name: 'token', value: SENSITIVE_VARIABLE_MASK, sensitive: true },
    ]);
    assert.equal(
      redactSensitiveVariablesInSource(
        '@sensitive-variable token=sekrit\nGET /\n',
      ),
      `@sensitive-variable token=${SENSITIVE_VARIABLE_MASK}\nGET /\n`,
    );

    const unchanged = restoreSensitiveVariablesFromBaseline(masked, baseline);
    assert.deepEqual(unchanged.variables, baseline.variables);

    const edited = restoreSensitiveVariablesFromBaseline(
      {
        ...baseline,
        variables: [
          { name: 'public', value: 'ok' },
          { name: 'token', value: 'new-secret', sensitive: true },
        ],
      },
      baseline,
    );
    assert.deepEqual(edited.variables, [
      { name: 'public', value: 'ok' },
      { name: 'token', value: 'new-secret', sensitive: true },
    ]);
  });
});
