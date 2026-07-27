import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MASKED_VARIABLE_VALUE } from '../variable-resolver';
import {
  allocateEnvironmentId,
  escapeAttribute,
  isValidVariableName,
  maskEnvironmentManagerState,
  parseEnvironmentManagerMessage,
  renameSelectedEnvironment,
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
    assert.match(html, /id="duplicateEnv"/u);
    assert.match(html, /id="envSearch"/u);
    assert.match(html, /Global Variables/u);
    assert.match(html, /Workspace Variables/u);
    assert.match(html, /id="precedenceLegend"/u);
    assert.match(
      html,
      /Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global/u,
    );
    assert.match(html, /id="activeEnvStrip"/u);
    assert.match(html, /Active environment: None/u);
  });

  test('sidebar separates Environments from Scopes and keeps scopes out of env list', () => {
    const html = renderEnvironmentManagerHtml('iaNonce');
    assert.match(html, /id="environmentsHeading"[^>]*>Environments</u);
    assert.match(html, /id="scopesHeading"[^>]*>Scopes</u);
    assert.match(html, /aria-label="Environment Manager navigation"/u);
    assert.match(html, /aria-label="Variable scopes"/u);
    assert.match(html, /id="envList"[^>]*aria-label="Environments"/u);
    assert.match(html, /id="envEmpty"/u);
    // Scope rows (and runtime env rows) use presentation list items around options.
    assert.match(
      html,
      /<ul class="scope-list"[^>]*>\s*<li role="presentation">/u,
    );
    assert.match(html, /wrap\.setAttribute\('role', 'presentation'\)/u);
    const envListBlock = html.match(/<ul id="envList"[^>]*>[\s\S]*?<\/ul>/u)?.[0];
    assert.ok(envListBlock);
    assert.doesNotMatch(
      envListBlock,
      /Global Variables|Workspace Variables|scopeGlobal|scopeWorkspace/u,
    );
    const scopesIndex = html.indexOf('id="scopesHeading"');
    const workspaceIndex = html.indexOf('id="scopeWorkspace"');
    const globalIndex = html.indexOf('id="scopeGlobal"');
    assert.ok(scopesIndex > 0);
    assert.ok(workspaceIndex > scopesIndex);
    assert.ok(globalIndex > workspaceIndex);
  });

  test('active environment is surfaced with badge and bold patterns', () => {
    const html = renderEnvironmentManagerHtml('activeNonce');
    assert.match(html, /id="activeBadge"[^>]*>Active environment</u);
    assert.match(html, /is-active-env/u);
    assert.match(html, /env-active-badge/u);
    assert.match(html, /aria-current/u);
    assert.match(html, /font-weight: 600/u);
    assert.match(html, /textContent = 'Active'/u);
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
      /Active environment "missing" is not in the list/u,
    );
  });

  test('empty activeEnvironmentId is treated as no active environment', () => {
    assert.equal(
      validateEnvironmentManagerState({
        ...sampleState(),
        activeEnvironmentId: '',
      }),
      undefined,
    );
    assert.equal(
      validateEnvironmentManagerState({
        ...sampleState(),
        activeEnvironmentId: '   ',
      }),
      undefined,
    );

    const emptyCommit = parseEnvironmentManagerMessage({
      type: 'commit',
      state: { ...sampleState(), activeEnvironmentId: '' },
    });
    assert.equal(emptyCommit?.type, 'commit');
    if (emptyCommit?.type === 'commit') {
      assert.equal('activeEnvironmentId' in emptyCommit.state, false);
    }

    const whitespaceCommit = parseEnvironmentManagerMessage({
      type: 'commit',
      state: { ...sampleState(), activeEnvironmentId: '  \t' },
    });
    assert.equal(whitespaceCommit?.type, 'commit');
    if (whitespaceCommit?.type === 'commit') {
      assert.equal('activeEnvironmentId' in whitespaceCommit.state, false);
    }
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

  test('renameSelectedEnvironment reallocates id and selection', () => {
    const state: EnvironmentManagerState = {
      environments: [
        { id: 'new-environment', name: 'New Environment', variables: [] },
      ],
      globalVariables: [],
      workspaceVariables: [],
      selectedId: 'new-environment',
    };
    const renamed = renameSelectedEnvironment(state, 'Dummy');
    assert.equal(renamed.environments[0]?.id, 'dummy');
    assert.equal(renamed.environments[0]?.name, 'Dummy');
    assert.equal(renamed.selectedId, 'dummy');
  });

  test('renameSelectedEnvironment updates activeEnvironmentId when it matched', () => {
    const state: EnvironmentManagerState = {
      environments: [
        { id: 'new-environment', name: 'New Environment', variables: [] },
      ],
      globalVariables: [],
      workspaceVariables: [],
      selectedId: 'new-environment',
      activeEnvironmentId: 'new-environment',
    };
    const renamed = renameSelectedEnvironment(state, 'Dummy');
    assert.equal(renamed.activeEnvironmentId, 'dummy');
    assert.equal(renamed.selectedId, 'dummy');
  });

  test('renameSelectedEnvironment leaves unrelated activeEnvironmentId alone', () => {
    const state: EnvironmentManagerState = {
      environments: [
        { id: 'prod', name: 'Prod', variables: [] },
        { id: 'new-environment', name: 'New Environment', variables: [] },
      ],
      globalVariables: [],
      workspaceVariables: [],
      selectedId: 'new-environment',
      activeEnvironmentId: 'prod',
    };
    const renamed = renameSelectedEnvironment(state, 'Dummy');
    assert.equal(renamed.activeEnvironmentId, 'prod');
    assert.equal(renamed.selectedId, 'dummy');
  });

  test('renameSelectedEnvironment uniquifies against other env ids', () => {
    const state: EnvironmentManagerState = {
      environments: [
        { id: 'dummy', name: 'Dummy', variables: [] },
        { id: 'new-environment', name: 'New Environment', variables: [] },
      ],
      globalVariables: [],
      workspaceVariables: [],
      selectedId: 'new-environment',
    };
    const renamed = renameSelectedEnvironment(state, 'Dummy');
    assert.equal(renamed.environments[1]?.id, 'dummy-2');
    assert.equal(renamed.environments[1]?.name, 'Dummy');
    assert.equal(renamed.selectedId, 'dummy-2');
    assert.equal(renamed.environments[0]?.id, 'dummy');
  });

  test('renameSelectedEnvironment ignores global and workspace selection', () => {
    const globalState: EnvironmentManagerState = {
      environments: [{ id: 'dev', name: 'Dev', variables: [] }],
      globalVariables: [],
      workspaceVariables: [],
      selectedId: 'global',
      activeEnvironmentId: 'dev',
    };
    assert.deepEqual(
      renameSelectedEnvironment(globalState, 'Dummy'),
      globalState,
    );

    const workspaceState: EnvironmentManagerState = {
      ...globalState,
      selectedId: 'workspace',
    };
    assert.deepEqual(
      renameSelectedEnvironment(workspaceState, 'Dummy'),
      workspaceState,
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

  test('restore recovers cleartext when a masked sensitive variable is renamed', () => {
    const baseline = sampleState();
    const renamedWhileMasked: EnvironmentManagerState = {
      ...baseline,
      environments: baseline.environments.map((environment) => ({
        ...environment,
        variables: [
          { name: 'host', value: 'https://dev.test', sensitive: false },
          {
            name: 'apiToken',
            value: MASKED_VARIABLE_VALUE,
            sensitive: true,
          },
        ],
      })),
    };
    const restored = restoreEnvironmentManagerState(renamedWhileMasked, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'apiToken')
        ?.value,
      'sekrit',
    );
  });

  test('restore recovers cleartext when environment id changes on rename', () => {
    const baseline = sampleState();
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'staging',
          name: 'Staging',
          variables: [
            { name: 'host', value: 'https://dev.test', sensitive: false },
            {
              name: 'token',
              value: MASKED_VARIABLE_VALUE,
              sensitive: true,
            },
          ],
        },
      ],
      selectedId: 'staging',
      activeEnvironmentId: 'staging',
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      'sekrit',
    );
  });

  test('restore pairs orphan for one rename while sibling keeps id match', () => {
    const baseline: EnvironmentManagerState = {
      environments: [
        {
          id: 'dev',
          name: 'Development',
          variables: [{ name: 'token', value: 'sekritA', sensitive: true }],
        },
        {
          id: 'staging',
          name: 'Staging',
          variables: [{ name: 'token', value: 'sekritB', sensitive: true }],
        },
      ],
      globalVariables: [],
      workspaceVariables: [],
      activeEnvironmentId: 'dev',
      selectedId: 'dev',
    };
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'dev-renamed',
          name: 'Development',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
        {
          id: 'staging',
          name: 'Staging',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
      ],
      selectedId: 'dev-renamed',
      activeEnvironmentId: 'dev-renamed',
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments.find((entry) => entry.id === 'dev-renamed')
        ?.variables.find((entry) => entry.name === 'token')?.value,
      'sekritA',
    );
    assert.equal(
      restored.environments.find((entry) => entry.id === 'staging')
        ?.variables.find((entry) => entry.name === 'token')?.value,
      'sekritB',
    );
  });

  test('restore uses id match not orphan when deleting one of two environments', () => {
    const baseline: EnvironmentManagerState = {
      environments: [
        {
          id: 'dev',
          name: 'Development',
          variables: [
            { name: 'token', value: 'sekritA', sensitive: true },
          ],
        },
        {
          id: 'staging',
          name: 'Staging',
          variables: [
            { name: 'token', value: 'sekritB', sensitive: true },
          ],
        },
      ],
      globalVariables: [],
      workspaceVariables: [],
      activeEnvironmentId: 'staging',
      selectedId: 'staging',
    };
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'staging',
          name: 'Staging',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
      ],
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      'sekritB',
    );
  });

  test('restore does not pair orphan secrets after delete and rename in same save', () => {
    const baseline: EnvironmentManagerState = {
      environments: [
        {
          id: 'dev',
          name: 'Development',
          variables: [
            { name: 'token', value: 'sekritA', sensitive: true },
          ],
        },
        {
          id: 'staging',
          name: 'Staging',
          variables: [
            { name: 'token', value: 'sekritB', sensitive: true },
          ],
        },
      ],
      globalVariables: [],
      workspaceVariables: [],
      activeEnvironmentId: 'staging',
      selectedId: 'staging',
    };
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'prod',
          name: 'Production',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
      ],
      selectedId: 'prod',
      activeEnvironmentId: 'prod',
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    const token = restored.environments[0]?.variables.find(
      (entry) => entry.name === 'token',
    )?.value;
    assert.notEqual(token, 'sekritA');
    assert.notEqual(token, 'sekritB');
    assert.equal(token, '');
  });

  test('restore skips orphan pairing when multiple environments are renamed', () => {
    const baseline: EnvironmentManagerState = {
      environments: [
        {
          id: 'dev',
          name: 'Development',
          variables: [
            { name: 'token', value: 'sekritA', sensitive: true },
          ],
        },
        {
          id: 'staging',
          name: 'Staging',
          variables: [
            { name: 'token', value: 'sekritB', sensitive: true },
          ],
        },
      ],
      globalVariables: [],
      workspaceVariables: [],
      activeEnvironmentId: 'dev',
      selectedId: 'dev',
    };
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'dev-renamed',
          name: 'Development',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
        {
          id: 'staging-renamed',
          name: 'Staging',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
      ],
      selectedId: 'dev-renamed',
      activeEnvironmentId: 'dev-renamed',
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      '',
    );
    assert.equal(
      restored.environments[1]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      '',
    );
    assert.notEqual(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      'sekritB',
    );
    assert.notEqual(
      restored.environments[1]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      'sekritA',
    );
  });

  test('restore skips secret restoration when orphan pairing is ambiguous', () => {
    const baseline: EnvironmentManagerState = {
      environments: [
        {
          id: 'a',
          name: 'A',
          variables: [{ name: 'token', value: 'secretA', sensitive: true }],
        },
        {
          id: 'b',
          name: 'B',
          variables: [{ name: 'token', value: 'secretB', sensitive: true }],
        },
      ],
      globalVariables: [],
      workspaceVariables: [],
      activeEnvironmentId: 'a',
      selectedId: 'a',
    };
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'c',
          name: 'C',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
      ],
      selectedId: 'c',
      activeEnvironmentId: 'c',
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      '',
    );
  });

  test('restore does not use orphan when new env has masked value and baseline has no orphans', () => {
    const baseline: EnvironmentManagerState = {
      environments: [],
      globalVariables: [],
      workspaceVariables: [],
      activeEnvironmentId: undefined,
      selectedId: 'global',
    };
    const incoming: EnvironmentManagerState = {
      ...baseline,
      environments: [
        {
          id: 'fresh',
          name: 'Fresh',
          variables: [
            { name: 'token', value: MASKED_VARIABLE_VALUE, sensitive: true },
          ],
        },
      ],
      selectedId: 'fresh',
      activeEnvironmentId: 'fresh',
    };
    const restored = restoreEnvironmentManagerState(incoming, baseline);
    assert.equal(
      restored.environments[0]?.variables.find((entry) => entry.name === 'token')
        ?.value,
      '',
    );
  });

  test('parseEnvironmentManagerMessage accepts dirty and setActiveEnvironment', () => {
    assert.deepEqual(parseEnvironmentManagerMessage({ type: 'dirty', dirty: true }), {
      type: 'dirty',
      dirty: true,
    });
    assert.deepEqual(
      parseEnvironmentManagerMessage({
        type: 'setActiveEnvironment',
        id: 'dev',
      }),
      { type: 'setActiveEnvironment', id: 'dev' },
    );
  });

  test('environment manager HTML wires search and duplicate controls', () => {
    const html = renderEnvironmentManagerHtml('envNonce');
    assert.match(html, /id="envSearch"/u);
    assert.match(html, /id="duplicateEnv"/u);
    assert.match(html, /envSearch'\)\.addEventListener/u);
    assert.match(html, /duplicateEnv'\)\.addEventListener/u);
    assert.match(html, /envFilter/u);
    assert.match(html, / Copy'/u);
    assert.match(html, /type: 'setActiveEnvironment'/u);
    assert.match(html, /type: 'dirty'/u);
    assert.match(html, /pendingActiveEnvironmentId/u);
    assert.match(html, /previousActiveEnvironmentId/u);
    assert.match(html, /activeEnvironmentSet/u);
    assert.match(html, /activeEnvironmentError/u);
  });

  test('environment manager HTML syncs id and selection on rename', () => {
    const html = renderEnvironmentManagerHtml('renameNonce');
    const envNameIdx = html.indexOf("el('envName').addEventListener('input'");
    assert.ok(envNameIdx >= 0);
    const handler = html.slice(envNameIdx, envNameIdx + 900);
    assert.match(handler, /filter\(\(id\) => id !== oldId\)/u);
    assert.match(handler, /allocateId\(name, collisionSet\)/u);
    assert.match(handler, /selectedId: newId/u);
    assert.match(
      handler,
      /activeEnvironmentId:\s*state\.activeEnvironmentId === oldId \? newId/u,
    );
    assert.match(handler, /render\(\)/u);
    assert.match(
      html,
      /!haystack\.includes\(query\) && environment\.id !== state\.selectedId/u,
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
