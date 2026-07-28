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
    assert.match(html, /id="run"[^>]*>[\s\S]*?<\/svg><\/span> Run</u);
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

    const emptyBranch = html.slice(emptyIdx, formIdx);
    assert.match(emptyBranch, /el\('url'\)\.disabled = true/u);
    assert.match(emptyBranch, /el\('method'\)\.disabled = true/u);

    const nameFieldIdx = html.indexOf("setFieldValue('name'", formIdx);
    assert.ok(nameFieldIdx > formIdx);
    const formBranch = html.slice(formIdx, nameFieldIdx);
    assert.match(formBranch, /el\('url'\)\.disabled = false/u);
    assert.match(formBranch, /el\('method'\)\.disabled = false/u);
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
