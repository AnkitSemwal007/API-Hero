import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VariableScope } from '../models';
import {
  VARIABLE_PRECEDENCE_LEGEND,
  VARIABLE_PRECEDENCE_ORDER_LABELS,
  VARIABLE_SCOPE_UI,
  formatVariableScopeLabel,
  getVariableScopeUi,
} from './variable-scope-ui';

const ALL_SCOPES: readonly VariableScope[] = [
  'run',
  'document',
  'environment',
  'collection',
  'workspace',
  'global',
];

test('scope UI labels map all six scopes including Run and Collection', () => {
  assert.equal(VARIABLE_SCOPE_UI.run.sourceLabel, 'Run');
  assert.equal(VARIABLE_SCOPE_UI.document.sourceLabel, 'Request');
  assert.equal(VARIABLE_SCOPE_UI.environment.sourceLabel, 'Environment');
  assert.equal(VARIABLE_SCOPE_UI.collection.sourceLabel, 'Collection');
  assert.equal(VARIABLE_SCOPE_UI.workspace.sourceLabel, 'Workspace');
  assert.equal(VARIABLE_SCOPE_UI.global.sourceLabel, 'Global');
  assert.deepEqual(
    Object.keys(VARIABLE_SCOPE_UI).sort(),
    [...ALL_SCOPES].sort(),
  );
});

test('precedence legend is highest-to-lowest Run-first with Collection', () => {
  assert.equal(
    VARIABLE_PRECEDENCE_LEGEND,
    'Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global',
  );
  assert.deepEqual([...VARIABLE_PRECEDENCE_ORDER_LABELS], [
    'Run',
    'Request',
    'Environment',
    'Collection',
    'Workspace',
    'Global',
  ]);
});

test('formatVariableScopeLabel includes icon and label for new scopes', () => {
  assert.equal(formatVariableScopeLabel('document'), '📄 Request');
  assert.equal(formatVariableScopeLabel('run'), '▶️ Run');
  assert.equal(formatVariableScopeLabel('collection'), '📚 Collection');
  assert.equal(getVariableScopeUi('environment').icon, '🌍');
  assert.equal(getVariableScopeUi('run').icon, '▶️');
  assert.equal(getVariableScopeUi('collection').icon, '📚');
});
