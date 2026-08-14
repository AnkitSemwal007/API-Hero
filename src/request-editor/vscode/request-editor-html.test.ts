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
  createWebsocketSessionMessage,
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
    assert.match(html, />Authentication</u);
    assert.match(html, /id="authKind"/u);
    assert.match(html, />Type</u);
    assert.match(html, /Bearer Token/u);
    assert.match(html, /Basic Auth/u);
    assert.match(html, /API Key/u);
    assert.match(html, /No Auth/u);
    assert.match(html, />Override</u);
    assert.match(html, /Saved Authentication/u);
    assert.match(html, /function buildSavedAuthPreview/u);
    assert.doesNotMatch(html, /OAuth/u);
    assert.doesNotMatch(html, /Authentication mode/u);
    assert.match(html, /id="method"/u);
    assert.match(html, /id="url"/u);
    assert.match(html, /id="varSuggest"/u);
    assert.match(html, /data-var-complete="true"/u);
    assert.match(html, /id="urlResolved"/u);
    assert.match(html, /Resolved: ' \+ info\.resolved/u);
    assert.match(html, /\.toolbar\s*\{[^}]*padding:\s*var\(--ah-space-1\)\s+var\(--ah-space-2\)/u);
    assert.match(html, /\.panels\s*\{[^}]*padding:\s*var\(--ah-space-2\)/u);
    assert.match(html, /refreshTabBadges/u);
    assert.match(html, /analyzeVarInput/u);
    assert.match(html, /Ctrl\+Space|ctrlKey.*metaKey.*' '/u);
    assert.match(html, /setVarCatalog/u);
    assert.match(html, /class="run-row"/u);
    assert.match(html, /class="identity-block"/u);
    assert.match(html, /id="name"/u);
    assert.match(html, /id="tab-request"/u);
    assert.match(html, /id="authKind"/u);
    assert.match(html, /id="oneshotToken"/u);
    assert.match(html, /id="oneshotUsername"/u);
    assert.match(html, /id="oneshotPassword"/u);
    assert.match(html, /id="oneshotApiKeyName"/u);
    assert.match(html, /id="oneshotApiKeyValue"/u);
    assert.match(html, /id="manageAuthProfiles"/u);
    assert.match(html, /id="manageEnvironments"/u);
    assert.match(html, /Manage Authentication/u);
    assert.match(html, /Manage Environments/u);
    // One-shot must preserve authProfileId (never delete @auth on mode switch).
    assert.match(html, /leave authProfileId unchanged/u);
    assert.doesNotMatch(
      html,
      /None and one-shot must never write @auth/u,
    );
    assert.match(html, /Paste a Bearer token for one-shot authentication before Send/u);
    assert.match(html, /Enter a username and password for one-shot authentication before Send/u);
    assert.match(html, /Enter an API key for one-shot authentication before Send/u);
    assert.match(html, /providerId: 'basic'/u);
    assert.match(html, /providerId: 'apiKey'/u);
    assert.match(html, /model\.protocol/u);
    assert.match(html, /No Request variables/u);
    assert.match(html, /id="variablesPrecedenceLegend"/u);
    assert.match(
      html,
      /Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global/u,
    );
    assert.match(html, /id="variablesActiveEnv"/u);
    assert.match(html, /Workspace Env: None/u);
    assert.match(html, /Workspace Env: /u);
    assert.match(html, /Active workspace environment:/u);
    assert.match(html, /title="Switch workspace environment"/u);
    assert.match(html, /id="extractTable"/u);
    assert.match(html, /Add extraction/u);
    assert.match(html, /id="dependsOnPicker"/u);
    assert.match(html, /data-testid="depends-on-picker"/u);
    assert.match(html, /id="dependsOnSearch"/u);
    assert.match(html, /id="dependsOnList"/u);
    assert.match(html, /id="dependsOnAddBtn"/u);
    assert.match(html, /id="dependsOnPopover"/u);
    assert.match(html, /id="dependenciesInfoBtn"/u);
    assert.match(html, /id="unknownVariablesSection"/u);
    assert.match(html, /id="ambiguousProducersSection"/u);
    assert.match(html, /id="executionStatus"/u);
    assert.match(html, /id="executionStatusIcon"/u);
    assert.match(html, /id="executionStatusHeadline"/u);
    assert.match(html, /id="executionStatusDetail"/u);
    assert.match(html, /id="autoDependenciesSection"/u);
    assert.match(html, /id="manualDependenciesSection"/u);
    assert.match(html, /id="dependenciesContent"/u);
    assert.match(html, /id="issuesContent"/u);
    assert.match(html, /id="pinnedLabel"/u);
    assert.match(html, /class="execution-block dependencies-block"/u);
    assert.match(html, /Execution\s*<span id="dependenciesInfoBtn"/u);
    assert.match(html, /Runs independently/u);
    assert.match(html, /Automatically detected/u);
    assert.match(html, /Missing variables/u);
    assert.match(html, /Multiple producers/u);
    assert.match(html, />Pinned</u);
    assert.match(html, /\+ Add Dependency/u);
    assert.match(html, /data-testid="auto-dependencies"/u);
    assert.match(html, /data-testid="unknown-variables"/u);
    assert.match(html, /data-testid="ambiguous-producers"/u);
    assert.doesNotMatch(html, />\s*Auto</u);
    assert.doesNotMatch(html, />\s*Manual</u);
    assert.doesNotMatch(html, />\s*Unknown</u);
    assert.doesNotMatch(html, />\s*Ambiguous</u);
    assert.doesNotMatch(html, /Method and URL stay in the top bar/u);
    assert.doesNotMatch(html, /[✓📌⚠]/u);
    assert.doesNotMatch(html, /textContent = '×'/u);
    assert.match(html, /function ahIconSpan/u);
    assert.match(html, /AH_ICON_SVG_MAP/u);
    assert.match(html, /ahIconSpan\('pin'\)/u);
    assert.match(html, /ahIconSpan\('x'\)/u);
    assert.doesNotMatch(html, /AH_ICON_PIN/u);
    assert.doesNotMatch(html, /AH_ICON_X/u);
    assert.equal((html.match(/function ahIconSpan/gu) ?? []).length, 1);
    assert.match(html, /id="run"[^>]*>[\s\S]*?<\/svg><\/span> <span id="runLabel">Run<\/span></u);
    assert.match(html, /id="dependenciesInfoBtn"[\s\S]*?aria-hidden="true"/u);
    assert.doesNotMatch(html, /ⓘ/u);
    assert.match(html, /pinAutoDependency/u);
    assert.match(html, /dependencyProjectionError/u);
    assert.match(html, /renderDependencyProjections/u);
    assert.match(html, /unknownSection\.hidden/u);
    assert.match(html, /ambiguousSection\.hidden/u);
    assert.match(html, /openDependsOnPopover/u);
    assert.match(html, /ignoreUnknownVariable/u);
    assert.match(html, /dependsOnSelectedRefs/u);
    assert.match(html, /dependencyCatalog/u);
    assert.match(html, /displayLabelForDependsToken/u);
    assert.match(html, /Unknown request/u);
    assert.match(html, /textContent = 'Uses '/u);
    assert.match(html, /Keep dependency '/u);
    assert.match(html, /EXEC_ICON_READY/u);
    assert.match(html, /EXEC_ICON_DEPS/u);
    assert.match(html, /EXEC_ICON_ISSUE/u);
    assert.doesNotMatch(html, /Manual Depends on/u);
    assert.doesNotMatch(html, /No unknown variables\./u);
    assert.doesNotMatch(html, /No ambiguous producers\./u);
    assert.doesNotMatch(
      html,
      /Comma-separated request names \(the value of <code>@name<\/code>/u,
    );
    // Depends-on picker lives on the Request tab, not a new tab.
    const requestTabAt = html.indexOf('id="tab-request"');
    const dependsOnFieldAt = html.indexOf('id="dependsOnPicker"');
    const headersTabAt = html.indexOf('id="tab-headers"');
    assert.ok(
      dependsOnFieldAt > requestTabAt && dependsOnFieldAt < headersTabAt,
    );
    assert.match(
      html,
      /Default scope is Run \(session\)\. Environment, Collection, and Workspace persist\. Request writes are a session overlay for this request\. Global is not available for extract\./u,
    );
    assert.match(html, /<option value="collection">Collection<\/option>/u);
    assert.match(html, /<option value="workspace">Workspace<\/option>/u);
    assert.doesNotMatch(html, /<option value="global">/u);
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

  // Regression (Request Editor–global, not URL-specific): outside clicks while the
  // Depends-on popover is already closed must not call dependsAddBtn.focus(). Affects
  // any editable input (name, url, description, headers, params, body, etc.).
  // Timeline: mousedown focuses the input → mouseup/click bubbles to document →
  // listener calls closeDependsOnPopover() → dependsAddBtn.focus() steals focus.
  // Introduced in 63b054f ("Simplify Request Editor Dependencies UI…"); toolbar
  // changes in that commit are unrelated. Guards below prevent the steal.
  test('document click does not steal focus from Request Editor inputs when Depends-on is closed', () => {
    const html = renderRequestEditorHtml('nonce');
    // Intentional close-while-open UX still focuses the add button after hiding.
    assert.match(
      html,
      /function closeDependsOnPopover\(\)\s*\{\s*if \(dependsPopover\.hidden\) return;\s*dependsPopover\.hidden = true;\s*dependsAddBtn\.focus\(\);/u,
    );
    // Document click listener still exists, but early-returns when already hidden.
    assert.match(
      html,
      /document\.addEventListener\('click',\s*\(event\)\s*=>\s*\{[\s\S]*?if \(!picker \|\| picker\.contains\(event\.target\)\) return;\s*if \(dependsPopover\.hidden\) return;\s*closeDependsOnPopover\(\);/u,
    );
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
    assert.deepEqual(
      parseRequestEditorMessage({ type: 'saveAsAuthentication' }),
      { type: 'saveAsAuthentication' },
    );
    assert.deepEqual(
      parseRequestEditorMessage({ type: 'dismissSaveAsAuthentication' }),
      { type: 'dismissSaveAsAuthentication' },
    );
  });

  test('parseRequestEditorMessage accepts oneshot ephemeralAuth for each live type', () => {
    assert.deepEqual(
      parseRequestEditorMessage({
        type: 'run',
        ephemeralAuth: {
          providerId: 'bearer',
          material: { token: 't' },
        },
      }),
      {
        type: 'run',
        ephemeralAuth: {
          providerId: 'bearer',
          material: { token: 't' },
        },
      },
    );
    assert.deepEqual(
      parseRequestEditorMessage({
        type: 'run',
        ephemeralAuth: {
          providerId: 'basic',
          material: { username: 'u', password: 'p' },
        },
      }),
      {
        type: 'run',
        ephemeralAuth: {
          providerId: 'basic',
          material: { username: 'u', password: 'p' },
        },
      },
    );
    assert.deepEqual(
      parseRequestEditorMessage({
        type: 'run',
        ephemeralAuth: {
          providerId: 'apiKey',
          material: { value: 'k' },
          apiKeyName: 'X-API-Key',
          apiKeyLocation: 'query',
        },
      }),
      {
        type: 'run',
        ephemeralAuth: {
          providerId: 'apiKey',
          material: { value: 'k' },
          apiKeyName: 'X-API-Key',
          apiKeyLocation: 'query',
        },
      },
    );
    const oauthRun = parseRequestEditorMessage({
      type: 'run',
      ephemeralAuth: { providerId: 'oauth2', material: { token: 't' } },
    });
    assert.equal(oauthRun?.type, 'run');
    assert.equal(
      oauthRun !== undefined && oauthRun.type === 'run'
        ? oauthRun.ephemeralAuth
        : undefined,
      undefined,
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

  test('emptyRequestEditorModel includes dependsOn array', () => {
    assert.deepEqual(emptyRequestEditorModel().dependsOn, []);
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

  test('applyState disables toolbar url/method in multi and empty modes', () => {
    const html = renderRequestEditorHtml('mode-nonce');

    const multiIdx = html.indexOf("next.mode === 'multi'");
    const emptyIdx = html.indexOf("next.mode === 'empty'");
    const formIdx = html.indexOf('formRoot.hidden = false');
    assert.ok(multiIdx >= 0 && emptyIdx > multiIdx && formIdx > emptyIdx);

    const multiBranch = html.slice(multiIdx, emptyIdx);
    assert.match(multiBranch, /el\('url'\)\.disabled = true/u);
    assert.match(multiBranch, /el\('method'\)\.disabled = true/u);
    assert.match(multiBranch, /el\('protocol'\)\.disabled = true/u);

    const emptyBranch = html.slice(emptyIdx, formIdx);
    assert.match(emptyBranch, /el\('url'\)\.disabled = true/u);
    assert.match(emptyBranch, /el\('method'\)\.disabled = true/u);
    assert.match(emptyBranch, /el\('protocol'\)\.disabled = true/u);

    const nameFieldIdx = html.indexOf("setFieldValue('name'", formIdx);
    assert.ok(nameFieldIdx > formIdx);
    const formBranch = html.slice(formIdx, nameFieldIdx);
    assert.match(formBranch, /el\('url'\)\.disabled = false/u);
    assert.match(formBranch, /el\('method'\)\.disabled = false/u);
    assert.match(formBranch, /el\('protocol'\)\.disabled = false/u);
  });

  test('scheduleUpdate gates on form mode only', () => {
    const html = renderRequestEditorHtml('schedule-nonce');
    assert.match(html, /state\.mode !== 'form'/u);
    const scheduleIdx = html.indexOf('function scheduleUpdate()');
    assert.ok(scheduleIdx >= 0);
    const scheduleBody = html.slice(scheduleIdx, scheduleIdx + 200);
    assert.match(scheduleBody, /state\.mode !== 'form'/u);
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
    assert.match(html, /flushPendingUpdate\(\)/u);
    assert.match(html, /post\(\{\s*type: 'run'/u);
    assert.match(html, /ephemeralAuth/u);

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

  test('parseRequestEditorMessage accepts ignoreUnknownVariable', () => {
    assert.deepEqual(
      parseRequestEditorMessage({
        type: 'ignoreUnknownVariable',
        name: ' ghost ',
      }),
      { type: 'ignoreUnknownVariable', name: 'ghost' },
    );
    assert.equal(
      parseRequestEditorMessage({
        type: 'ignoreUnknownVariable',
        name: '   ',
      }),
      undefined,
    );
  });

  test('parseRequestSourceDocument round-trips dependsOn', () => {
    assert.deepEqual(
      parseRequestSourceDocument({
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test',
        dependsOn: ['Login', 'Products'],
      })?.dependsOn,
      ['Login', 'Products'],
    );
    assert.deepEqual(
      parseRequestSourceDocument({
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test',
        dependsOn: ['Authentication/Login'],
      })?.dependsOn,
      ['Authentication/Login'],
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test',
        dependsOn: ['Login', 1],
      }),
      undefined,
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test',
      })?.dependsOn,
      undefined,
    );
  });

  test('parseRequestSourceDocument round-trips protocol', () => {
    assert.equal(
      parseRequestSourceDocument({
        name: 'GetUser',
        method: 'POST',
        url: 'https://example.test/graphql',
        protocol: 'graphql',
      })?.protocol,
      'graphql',
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'REST',
        method: 'GET',
        url: 'https://example.test',
        protocol: 'HTTP',
      })?.protocol,
      'http',
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'REST',
        method: 'GET',
        url: 'https://example.test',
      })?.protocol,
      undefined,
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'Bad',
        method: 'GET',
        url: 'https://example.test',
        protocol: 'mqtt',
      })?.protocol,
      'mqtt',
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'Echo',
        method: 'GET',
        url: 'ws://example.test/socket',
        protocol: 'websocket',
      })?.protocol,
      'websocket',
    );
  });

  test('parseRequestSourceDocument round-trips source', () => {
    assert.equal(
      parseRequestSourceDocument({
        name: 'Get User',
        method: 'GET',
        url: 'https://example.test/users',
        source: 'src/services/user.ts:12',
      })?.source,
      'src/services/user.ts:12',
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'Get User',
        method: 'GET',
        url: 'https://example.test/users',
      })?.source,
      undefined,
    );
    assert.equal(
      parseRequestSourceDocument({
        name: 'Get User',
        method: 'GET',
        url: 'https://example.test/users',
        source: 12,
      }),
      undefined,
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

  test('GraphQL protocol UI projects query, variables, and operation name', () => {
    const html = renderRequestEditorHtml('gql-nonce');
    assert.match(html, /id="protocol"/u);
    assert.match(html, /id="graphqlQuery"/u);
    assert.match(html, /id="graphqlVariables"/u);
    assert.match(html, /id="graphqlOperationName"/u);
    assert.match(html, /id="bodyGraphql"/u);
    assert.match(html, /id="protocolBadge"/u);
    assert.match(html, /el\('protocol'\)/u);
    assert.doesNotMatch(html, /no protocol dropdown in Phase 1/u);
    assert.match(
      html,
      /id="graphqlQuery"[^>]*data-var-complete="true"/u,
    );
    assert.match(
      html,
      /id="graphqlVariables"[^>]*data-var-complete="true"/u,
    );
    assert.match(html, /textContent = 'Query'/u);
    assert.match(html, /textContent = 'Message'/u);
    assert.match(html, /isGraphqlProtocol\(el\('protocol'\)\.value\)/u);
    assert.match(html, /refreshTabBadges/u);
    assert.match(html, /application\/json/u);
    assert.match(html, /Content-Type/u);
    assert.match(html, /ensureJsonContentTypeHeader/u);
    assert.match(html, /handleProtocolChange/u);
    assert.match(html, /compileGraphqlEditorEnvelope/u);
    assert.match(html, /delete model\.protocol/u);
    assert.match(html, /protocol === 'http'/u);
    assert.match(html, /data-unknown/u);
    assert.match(html, /JSON\.stringify\(envelope, null, 2\)/u);
    assert.match(html, /envelope\.variables = parsed/u);
    assert.match(html, /envelope\.operationName = trimmedOperation/u);
    assert.match(html, /restBodyIsNonGraphqlEnvelope/u);
    assert.match(
      html,
      /variablesTextIsInvalid\(el\('graphqlVariables'\)\.value\)/u,
    );
    assert.match(html, /Variables must be a JSON object/u);
    assert.match(html, /Prefer <code>\{\{variable\}\}<\/code> for secrets/u);
  });

  test('WebSocket protocol chrome is present in the request editor', () => {
    const html = renderRequestEditorHtml('ws-nonce');
    assert.match(html, /id="protocol"/u);
    assert.match(html, /<option value="http" selected>HTTP<\/option>/u);
    assert.match(html, /<option value="graphql">GraphQL<\/option>/u);
    assert.match(html, /<option value="websocket">WebSocket<\/option>/u);
    assert.match(html, /id="websocketConnection"/u);
    assert.match(html, /id="websocketStatus"/u);
    assert.match(html, /role="status"/u);
    assert.match(html, /id="websocketMessages"/u);
    assert.match(html, /id="methodField"/u);
    assert.match(html, /id="protocolBadge"/u);
    assert.match(html, /function applyProtocolChrome/u);
    assert.match(html, /methodField\.hidden = websocket/u);
    assert.match(html, /methodSelect\.hidden = websocket/u);
    assert.match(html, /badge\.textContent = 'WS'/u);
    assert.match(
      html,
      /\[hidden\]\s*\{\s*display:\s*none\s*!important;/u,
    );
    assert.match(html, /ws:\/\/localhost:8080\/socket/u);
    assert.match(html, /coerceWebsocketBodyTypeInForm/u);
    assert.match(html, /dropStockJsonContentTypeHeader/u);
    assert.match(html, /methodSelect\.value = 'GET'/u);
    assert.match(html, /isStockHttpOrGraphqlDefaultUrl/u);
    assert.match(html, /url\.value = DEFAULT_GRAPHQL_REQUEST_URL/u);
    assert.match(html, /rawContentTypeField'\)\.hidden = websocket \|\| type !== 'raw'/u);
    assert.match(html, /Run Session/u);
    assert.match(html, /id="runLabel">Run<\/span>/u);
    assert.match(html, /message\.type === 'websocketSession'/u);
    assert.match(html, /ws-event-sent/u);
    assert.match(html, /ws-event-received/u);
    assert.match(html, /ws-event-connection/u);
    assert.match(html, /ws-event-error/u);
    assert.match(html, /No request found in this file/u);
    assert.doesNotMatch(html, /No HTTP request found/u);
    assert.doesNotMatch(html, /no protocol dropdown in Phase 1/u);
    assert.equal(emptyRequestEditorModel().method, 'GET');
    assert.equal(emptyRequestEditorModel().url, 'https://httpbin.org/get');
    assert.equal(emptyRequestEditorModel().protocol, undefined);
    assert.equal(
      parseRequestSourceDocument({
        name: 'Echo',
        method: 'GET',
        url: 'ws://example.test/socket',
        protocol: 'websocket',
      })?.protocol,
      'websocket',
    );
    assert.deepEqual(parseRequestEditorMessage({ type: 'run' }), {
      type: 'run',
    });
  });

  test('WebSocket editor does not apply HTTP Content-Type defaults', () => {
    const html = renderRequestEditorHtml('ws-ct');
    assert.match(html, /el\('rawContentTypeField'\)\.hidden = websocket \|\| type !== 'raw'/u);
    assert.match(html, /el\('rawContentType'\)\.value = ''/u);
    assert.match(html, /placeholder="application\/xml"/u);
    assert.match(
      html,
      /isWebsocketProtocol\(el\('protocol'\)\.value\) && type !== 'none' && type !== 'json' && type !== 'text'/u,
    );
  });

  test('createWebsocketSessionMessage builds secret-free host messages', () => {
    assert.deepEqual(createWebsocketSessionMessage({ phase: 'connecting' }), {
      type: 'websocketSession',
      phase: 'connecting',
    });
    const closedView = {
      statusLabel: 'Closed',
      hint: 'Bounded session: connect → send → receive → close. The socket is not kept open.',
      events: [
        { kind: 'connection', text: 'Connected' },
        { kind: 'sent', direction: 'sent', text: '{"type":"ping"}' },
      ],
    } as const;
    assert.deepEqual(
      createWebsocketSessionMessage({
        phase: 'closed',
        view: closedView,
      }),
      {
        type: 'websocketSession',
        phase: 'closed',
        view: closedView,
      },
    );
  });
});
