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
  createRequestEditorAck,
  createRequestEditorResubmit,
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
    assert.match(html, /data-tab="extract"/u);
    assert.match(html, /data-tab="tests"/u);
    assert.match(html, /data-tab="settings"/u);
    assert.match(html, /data-tab="preview"/u);
    assert.match(html, /id="run"/u);
    assert.match(html, /id="openText"/u);
    assert.match(html, /keydown/u);
    assert.match(html, /ctrlKey \|\| event\.metaKey/u);
    assert.match(html, /event\.altKey/u);
    assert.match(html, /type: 'run'/u);
    assert.match(html, /id="envShortcut"/u);
    assert.match(html, /id="authShortcut"/u);
    assert.match(html, /id="method"/u);
    assert.match(html, /id="url"/u);
    assert.match(html, /id="varSuggest"/u);
    assert.match(html, /data-var-complete="true"/u);
    assert.match(html, /id="urlResolved"/u);
    assert.match(html, /analyzeVarInput/u);
    assert.match(html, /Ctrl\+Space|ctrlKey.*metaKey.*' '/u);
    assert.match(html, /setVarCatalog/u);
    assert.match(html, /class="run-row"/u);
    assert.match(html, /class="identity-block"/u);
    assert.match(html, /id="name"/u);
    assert.match(html, /id="tab-request"/u);
    assert.match(html, /id="manageAuthProfiles"/u);
    assert.match(html, /id="manageEnvironments"/u);
    assert.match(html, /Manage Authentication/u);
    assert.match(html, /Manage Environments/u);
    assert.match(html, /No Request variables/u);
    assert.match(html, /id="variablesPrecedenceLegend"/u);
    assert.match(
      html,
      /Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global/u,
    );
    assert.match(html, /id="variablesActiveEnv"/u);
    assert.match(html, /Env: None/u);
    assert.match(html, /id="extractTable"/u);
    assert.match(html, /Add extraction/u);
    assert.match(
      html,
      /Default scope is Run\. Environment writes persist\. Request writes are session overlay for this request\./u,
    );
    // Tab order: Request, Headers, Params, … Variables, Extract, Tests
    const headersAt = html.indexOf('data-tab="headers"');
    const paramsAt = html.indexOf('data-tab="params"');
    const variablesAt = html.indexOf('data-tab="variables"');
    const extractAt = html.indexOf('data-tab="extract"');
    const testsAt = html.indexOf('data-tab="tests"');
    assert.ok(headersAt > 0 && paramsAt > headersAt);
    assert.ok(variablesAt > 0 && extractAt > variablesAt && testsAt > extractAt);
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
    assert.deepEqual(model.extractionRules, []);
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

  test('emptyRequestEditorModel includes extractionRules array', () => {
    assert.deepEqual(emptyRequestEditorModel().extractionRules, []);
  });

  test('createRequestEditorAck and resubmit shape outbound sync messages', () => {
    assert.deepEqual(createRequestEditorAck(4), {
      type: 'ack',
      documentVersion: 4,
    });
    assert.deepEqual(createRequestEditorAck(5, 'GET /\n'), {
      type: 'ack',
      documentVersion: 5,
      sourceText: 'GET /\n',
    });
    assert.deepEqual(createRequestEditorResubmit(6), {
      type: 'resubmit',
      documentVersion: 6,
    });
  });

  test('renderRequestEditorHtml embeds ack and resubmit sync handlers', () => {
    const html = renderRequestEditorHtml('sync-nonce');
    assert.match(html, /message\.type === 'ack'/u);
    assert.match(html, /message\.type === 'resubmit'/u);
    assert.match(html, /state\.documentVersion = message\.documentVersion/u);
    assert.match(html, /clearTimeout\(debounceTimer\)/u);
    assert.match(html, /document\.activeElement === node/u);
    assert.match(html, /formDirty/u);
    assert.match(html, /flushPendingUpdate/u);
    assert.match(html, /if \(formDirty\)/u);
    assert.match(html, /flushPendingUpdate\(\);\s*post\(\{ type: 'run' \}\)/u);

    // Ack updates version / preview only — does not call applyState.
    const ackIdx = html.indexOf("message.type === 'ack'");
    const resubmitIdx = html.indexOf("message.type === 'resubmit'");
    assert.ok(ackIdx >= 0 && resubmitIdx > ackIdx);
    const ackBranch = html.slice(ackIdx, resubmitIdx);
    assert.match(ackBranch, /state\.documentVersion = message\.documentVersion/u);
    assert.match(ackBranch, /refreshPreview\(\)/u);
    assert.doesNotMatch(ackBranch, /applyState\(/u);

    // Full model apply is reserved for init/state.
    assert.match(html, /message\.type === 'init' \|\| message\.type === 'state'/u);
    const initIdx = html.indexOf("message.type === 'init' || message.type === 'state'");
    const initBranch = html.slice(initIdx, ackIdx);
    assert.match(initBranch, /applyState\(message\.state\)/u);
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

  test('restores cleartext when a masked sensitive variable is renamed', () => {
    const baseline = {
      name: 'S',
      method: 'GET' as const,
      url: 'https://example.test',
      variables: [
        { name: 'public', value: 'ok' },
        { name: 'token', value: 'sekrit', sensitive: true as const },
      ],
    };
    const renamedWhileMasked = {
      ...baseline,
      variables: [
        { name: 'public', value: 'ok' },
        {
          name: 'apiToken',
          value: SENSITIVE_VARIABLE_MASK,
          sensitive: true as const,
        },
      ],
    };
    const restored = restoreSensitiveVariablesFromBaseline(
      renamedWhileMasked,
      baseline,
    );
    assert.deepEqual(restored.variables, [
      { name: 'public', value: 'ok' },
      { name: 'apiToken', value: 'sekrit', sensitive: true },
    ]);
  });
});
