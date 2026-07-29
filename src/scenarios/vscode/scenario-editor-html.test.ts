import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MASKED_VARIABLE_VALUE } from '../../variables';
import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type Scenario,
} from '../models';
import {
  maskScenarioVariablesForEditor,
  parseScenarioEditorMessage,
  parseScenarioPayload,
  renderScenarioEditorHtml,
  restoreScenarioVariablesFromBaseline,
} from './scenario-editor-html';

function sampleScenario(
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    id: 'sid',
    schemaVersion: ScenarioSchemaVersion,
    name: 'Demo',
    variables: [
      {
        id: 'v-token',
        name: 'token',
        scope: ScenarioVariableScope.Scenario,
        defaultValue: 'sekrit',
        sensitive: true,
      },
      {
        id: 'v-host',
        name: 'host',
        scope: ScenarioVariableScope.Scenario,
        defaultValue: 'https://api.test',
        sensitive: false,
      },
    ],
    steps: [{ id: 'D1', type: StepType.Delay, name: 'Start', durationMs: 0 }],
    connections: [],
    executionSettings: { failurePolicy: 'stop-on-first-error' },
    metadata: { createdAt: 't1', updatedAt: 't2' },
    ...overrides,
  };
}

describe('scenarios/vscode/scenario-editor-html', () => {
  test('renderScenarioEditorHtml embeds CSP, controls, and mask constant', () => {
    const html = renderScenarioEditorHtml('scNonce');
    assert.match(html, /style-src &#39;nonce-scNonce&#39;/u);
    assert.match(html, /script-src &#39;nonce-scNonce&#39;/u);
    assert.match(html, /default-src &#39;none&#39;/u);
    assert.match(html, /id="btn-save"/u);
    assert.match(html, /id="btn-run"/u);
    assert.match(html, /data-var-sensitive/u);
    assert.match(html, /collectVariablesFromUi/u);
    assert.match(html, /const MASK = /u);
    assert.match(html, /••••••••/u);
    // Run posts a single compound message with scenario (no concurrent save+run).
    assert.match(html, /postMessage\(\{\s*type:\s*'run',\s*scenario\s*\}\)/u);
    assert.doesNotMatch(
      html,
      /postMessage\(\{\s*type:\s*'save',\s*scenario\s*\}\);\s*vscode\.postMessage\(\{\s*type:\s*'run'\s*\}\)/u,
    );
  });

  test('C1: mask/restore round-trip preserves sensitive flags and cleartext', () => {
    const baseline = sampleScenario();
    const masked = maskScenarioVariablesForEditor(baseline);
    const token = masked.variables.find((v) => v.name === 'token');
    const host = masked.variables.find((v) => v.name === 'host');
    assert.equal(token?.sensitive, true);
    assert.equal(token?.defaultValue, MASKED_VARIABLE_VALUE);
    assert.equal(host?.sensitive, false);
    assert.equal(host?.defaultValue, 'https://api.test');

    const restored = restoreScenarioVariablesFromBaseline(masked, baseline);
    assert.equal(
      restored.variables.find((v) => v.name === 'token')?.sensitive,
      true,
    );
    assert.equal(
      restored.variables.find((v) => v.name === 'token')?.defaultValue,
      'sekrit',
    );
    assert.equal(
      restored.variables.find((v) => v.name === 'host')?.defaultValue,
      'https://api.test',
    );
  });

  test('C1: restore keeps newly edited sensitive values', () => {
    const baseline = sampleScenario();
    const incoming = sampleScenario({
      variables: [
        {
          id: 'v-token',
          name: 'token',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: 'new-secret',
          sensitive: true,
        },
      ],
    });
    const restored = restoreScenarioVariablesFromBaseline(incoming, baseline);
    assert.equal(restored.variables[0]?.defaultValue, 'new-secret');
    assert.equal(restored.variables[0]?.sensitive, true);
  });

  test('W4: unmatched mask glyph is stripped rather than persisted', () => {
    const incoming = sampleScenario({
      variables: [
        {
          id: 'orphan',
          name: 'orphan',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: MASKED_VARIABLE_VALUE,
          sensitive: true,
        },
      ],
    });
    const restored = restoreScenarioVariablesFromBaseline(incoming, undefined);
    assert.equal(restored.variables[0]?.sensitive, true);
    assert.equal(restored.variables[0]?.defaultValue, undefined);
  });

  test('W4: demoting sensitive while masked still restores cleartext from baseline', () => {
    const baseline = sampleScenario();
    const incoming = sampleScenario({
      variables: [
        {
          id: 'v-token',
          name: 'token',
          scope: ScenarioVariableScope.Scenario,
          defaultValue: MASKED_VARIABLE_VALUE,
          sensitive: false,
        },
      ],
    });
    const restored = restoreScenarioVariablesFromBaseline(incoming, baseline);
    assert.equal(restored.variables[0]?.sensitive, false);
    assert.equal(restored.variables[0]?.defaultValue, 'sekrit');
  });

  test('W1: parseScenarioEditorMessage validates save payload via schema', () => {
    const valid = sampleScenario();
    const save = parseScenarioEditorMessage({ type: 'save', scenario: valid });
    assert.equal(save?.type, 'save');
    if (save?.type === 'save') {
      assert.equal(save.scenario.id, 'sid');
      assert.equal(
        save.scenario.variables.find((v) => v.name === 'token')?.sensitive,
        true,
      );
    }

    assert.equal(
      parseScenarioEditorMessage({
        type: 'save',
        scenario: { name: 'broken' },
      }),
      undefined,
    );
  });

  test('W1: parseScenarioPayload rejects invalid documents', () => {
    const bad = parseScenarioPayload({ schemaVersion: '9.9.9', id: 'x', name: 'n' });
    assert.equal(bad.ok, false);
    const good = parseScenarioPayload(sampleScenario());
    assert.equal(good.ok, true);
  });

  test('W2: run message requires a validated scenario payload', () => {
    const run = parseScenarioEditorMessage({
      type: 'run',
      scenario: sampleScenario(),
    });
    assert.equal(run?.type, 'run');
    assert.equal(
      parseScenarioEditorMessage({ type: 'run' }),
      undefined,
    );
  });

  test('collectVariablesFromUi script preserves sensitive from checkbox', () => {
    const html = renderScenarioEditorHtml('sens');
    assert.match(html, /function collectVariablesFromUi\(\)/u);
    assert.match(
      html,
      /sensitive:\s*sensitive\s*===\s*true/u,
    );
    // Must not force sensitive:false inside collectVariablesFromUi.
    const collectBody = html.match(
      /function collectVariablesFromUi\(\)\{[\s\S]*?\n\}/u,
    )?.[0];
    assert.ok(collectBody);
    assert.doesNotMatch(collectBody, /sensitive:\s*false/u);
  });

  test('renderAll syncs variable edits before re-rendering', () => {
    const html = renderScenarioEditorHtml('sync');
    assert.match(
      html,
      /function renderAll\(\)\{[\s\S]*#vars \[data-var-name\][\s\S]*collectVariablesFromUi\(\)/u,
    );
  });
});
