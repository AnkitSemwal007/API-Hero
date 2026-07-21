import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MASKED_VARIABLE_VALUE } from '../variable-resolver';
import {
  allocateEnvironmentId,
  escapeAttribute,
  isValidVariableName,
  maskEnvironmentManagerState,
  parseEnvironmentManagerMessage,
  renderEnvironmentManagerHtml,
  restoreEnvironmentManagerState,
  validateEnvironmentManagerState,
  type EnvironmentManagerState,
} from './environment-manager-html';

describe('environment-manager-html', () => {
  test('renderEnvironmentManagerHtml embeds CSP nonce and controls', () => {
    const html = renderEnvironmentManagerHtml('envNonce');
    assert.match(html, /style-src 'nonce-envNonce'/u);
    assert.match(html, /script-src 'nonce-envNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="addEnv"/u);
    assert.match(html, /id="save"/u);
    assert.match(html, /Global variables/u);
    assert.match(html, /Workspace variables/u);
  });

  test('escapeAttribute neutralizes quote breakouts', () => {
    assert.equal(escapeAttribute(`a"b'`), 'a&quot;b&#39;');
  });

  test('parseEnvironmentManagerMessage accepts ready and commit', () => {
    assert.deepEqual(parseEnvironmentManagerMessage({ type: 'ready' }), {
      type: 'ready',
    });
    const state = sampleState();
    assert.deepEqual(
      parseEnvironmentManagerMessage({ type: 'commit', state }),
      { type: 'commit', state },
    );
    assert.equal(parseEnvironmentManagerMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseEnvironmentManagerMessage({
        type: 'commit',
        state: { environments: 'bad' },
      }),
      undefined,
    );
  });

  test('validateEnvironmentManagerState rejects bad names and unknown active', () => {
    assert.equal(validateEnvironmentManagerState(sampleState()), undefined);
    assert.match(
      validateEnvironmentManagerState({
        ...sampleState(),
        environments: [{
          id: 'dev',
          name: 'Dev',
          variables: [{ name: '1bad', value: 'x', sensitive: false }],
        }],
      }) ?? '',
      /invalid variable name/u,
    );
    assert.match(
      validateEnvironmentManagerState({
        ...sampleState(),
        activeEnvironmentId: 'missing',
      }) ?? '',
      /Unknown active environment/u,
    );
  });

  test('isValidVariableName matches settings schema', () => {
    assert.equal(isValidVariableName('baseUrl'), true);
    assert.equal(isValidVariableName('token_1'), true);
    assert.equal(isValidVariableName('1token'), false);
    assert.equal(isValidVariableName(''), false);
  });

  test('allocateEnvironmentId slugifies and uniquifies', () => {
    assert.equal(allocateEnvironmentId('My Env', new Set()), 'my-env');
    assert.equal(
      allocateEnvironmentId('My Env', new Set(['my-env'])),
      'my-env-2',
    );
    assert.equal(
      allocateEnvironmentId('!!!', new Set(['environment'])),
      'environment-2',
    );
  });

  test('mask and restore preserve sensitive cleartext across round-trips', () => {
    const baseline = sampleState();
    const masked = maskEnvironmentManagerState(baseline);
    assert.equal(
      masked.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      MASKED_VARIABLE_VALUE,
    );
    assert.equal(
      masked.environments[0]?.variables.find((entry) => entry.name === 'host')
        ?.value,
      'https://dev.test',
    );

    const edited: EnvironmentManagerState = {
      ...masked,
      environments: masked.environments.map((environment) => ({
        ...environment,
        variables: environment.variables.map((variable) =>
          variable.name === 'host'
            ? { ...variable, value: 'https://new.test' }
            : variable,
        ),
      })),
    };
    const restored = restoreEnvironmentManagerState(edited, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      'sekrit',
    );
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'host')
        ?.value,
      'https://new.test',
    );
  });

  test('restore keeps newly edited sensitive values', () => {
    const baseline = sampleState();
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: baseline.environments.map((environment) => ({
        ...environment,
        variables: environment.variables.map((variable) =>
          variable.name === 'token'
            ? { ...variable, value: 'rotated' }
            : variable,
        ),
      })),
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      'rotated',
    );
  });
});

function sampleState(): EnvironmentManagerState {
  return {
    environments: [
      {
        id: 'dev',
        name: 'Development',
        variables: [
          { name: 'host', value: 'https://dev.test', sensitive: false },
          { name: 'token', value: 'sekrit', sensitive: true },
        ],
      },
    ],
    globalVariables: [{ name: 'g', value: '1', sensitive: false }],
    workspaceVariables: [],
    activeEnvironmentId: 'dev',
    selectedId: 'dev',
  };
}
