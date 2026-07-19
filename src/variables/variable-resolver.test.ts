import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VariableDefinition } from '../models';
import { parseApiDocument, validateApiRequest } from '../parser';
import { buildSelectedRequest } from '../request';
import {
  DefaultVariableResolver,
  EnvironmentManager,
  MASKED_VARIABLE_VALUE,
  maskVariableValue,
  type VariableConfigurationSnapshot,
} from '.';

const resolver = new DefaultVariableResolver();

function definition(
  name: string,
  value: string,
  scope: VariableDefinition['scope'],
  sensitive = false,
): VariableDefinition {
  return { name, value, scope, sensitive };
}

function request(source: string) {
  const parsed = parseApiDocument(source, { sourceId: 'variables.api' });
  const node = parsed.ast.requests[0]!;
  return buildSelectedRequest(
    parsed.ast,
    node,
    validateApiRequest(parsed.ast, node),
  );
}

test('uses deterministic precedence and permits shadowing across scopes', () => {
  const analysis = resolver.analyze({ definitions: [
    definition('host', 'global', 'global'),
    definition('host', 'workspace', 'workspace'),
    definition('host', 'environment', 'environment'),
    definition('host', 'document', 'document'),
  ] });

  assert.equal(analysis.values.get('host')?.value, 'document');
  assert.equal(analysis.values.get('host')?.scope, 'document');
  assert.deepEqual(analysis.errors, []);
});

test('reports duplicates within one scope without silently choosing the duplicate', () => {
  const analysis = resolver.analyze({ definitions: [
    definition('host', 'first', 'workspace'),
    definition('host', 'second', 'workspace'),
  ] });

  assert.equal(analysis.values.get('host')?.value, 'first');
  assert.equal(analysis.errors[0]?.code, 'DUPLICATE_DEFINITION');
  assert.equal(analysis.errors[0]?.variableName, 'host');
  assert.doesNotMatch(analysis.errors[0]?.message ?? '', /first|second/);
});

test('resolves transitively and propagates sensitivity without leaking values', () => {
  const analysis = resolver.analyze({ definitions: [
    definition('secret', 'private-value', 'global', true),
    definition('token', 'Bearer {{secret}}', 'workspace'),
  ] });
  const token = analysis.values.get('token')!;

  assert.equal(token.value, 'Bearer private-value');
  assert.equal(token.sensitive, true);
  assert.equal(maskVariableValue(token), MASKED_VARIABLE_VALUE);
  assert.equal('set' in analysis.values, false);
  assert.doesNotMatch(JSON.stringify(analysis.errors), /private-value/);
});

test('detects missing values, stable cycles, self-cycles, and unsupported built-ins', () => {
  const analysis = resolver.analyze({ definitions: [
    definition('a', '{{b}}', 'global'),
    definition('b', '{{a}}', 'global'),
    definition('self', '{{self}}', 'global'),
    definition('missingRef', '{{missing}}', 'global'),
    definition('future', '{{$uuid}}', 'global'),
  ] });

  assert.deepEqual(
    analysis.errors.find((item) => item.code === 'CYCLE' && item.variableName === 'a')?.chain,
    ['a', 'b', 'a'],
  );
  assert.deepEqual(
    analysis.errors.find((item) => item.code === 'CYCLE' && item.variableName === 'self')?.chain,
    ['self', 'self'],
  );
  assert.ok(analysis.errors.some((item) =>
    item.code === 'MISSING_VARIABLE' && item.variableName === 'missing'));
  assert.ok(analysis.errors.some((item) =>
    item.code === 'UNSUPPORTED_BUILT_IN' && item.variableName === '$uuid'));
});

test('reports transitive missing chains without claiming the root is undefined', () => {
  const analysis = resolver.analyze({ definitions: [
    definition('root', '{{middle}}', 'global'),
    definition('middle', '{{missing}}', 'global'),
  ] });
  const missing = analysis.errors.find((item) => item.code === 'MISSING_VARIABLE');

  assert.deepEqual(missing?.chain, ['root', 'middle', 'missing']);
  assert.equal(missing?.variableName, 'missing');
  assert.match(missing?.message ?? '', /root -> middle -> missing/);
  assert.doesNotMatch(missing?.message ?? '', /Variable "root" is not defined/);
});

test('resolves authoritative URL, headers, JSON, form, directives, and projections immutably', () => {
  const original = request([
    '@auth Bearer {{token}}',
    '@description {{description}}',
    'POST https://{{host}}/users/{{id}}?filter={{filter}}',
    'X-Token: {{token}}',
    'Content-Type: application/json',
    '',
    '{"id":"{{id}}","name":"{{description}}"}',
  ].join('\n'));
  const result = resolver.resolveRequest(original, { definitions: [
    definition('host', 'example.test', 'environment'),
    definition('id', '42', 'document'),
    definition('filter', 'active', 'workspace', true),
    definition('token', 'secret-token', 'global', true),
    definition('description', 'Ada', 'document'),
  ] });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }
  assert.equal(result.request.url, 'https://example.test/users/42?filter=active');
  assert.deepEqual(result.request.queryParameters, [{ name: 'filter', value: 'active' }]);
  assert.deepEqual(result.request.pathParameters, []);
  assert.deepEqual(result.request.headers[0], { name: 'X-Token', value: 'secret-token' });
  assert.equal(result.request.body?.content, '{"id":"42","name":"Ada"}');
  assert.deepEqual(result.request.body?.type === 'json' && result.request.body.value, {
    id: '42',
    name: 'Ada',
  });
  assert.equal(result.request.authentication.kind, 'unresolved');
  assert.equal(
    result.request.authentication.kind === 'unresolved' &&
      result.request.authentication.reference,
    'Bearer secret-token',
  );
  assert.match(result.request.resolution?.presentationUrl ?? '', /example\.test/);
  assert.doesNotMatch(result.request.resolution?.presentationUrl ?? '', /active/);
  assert.match(result.request.resolution?.presentationUrl ?? '', /••••••••/);
  assert.ok(Object.isFrozen(result.request));
  assert.equal(original.url, 'https://{{host}}/users/{{id}}?filter={{filter}}');
  assert.notEqual(result.request, original);
});

test('only request-relevant resolution errors block a selected request', () => {
  const resolved = resolver.resolveRequest(request('GET https://{{host}}'), {
    definitions: [
      definition('host', 'example.test', 'global'),
      definition('unused', '{{missing}}', 'global'),
    ],
  });
  assert.equal(resolved.success, true);
});

test('keeps form content and derived fields coherent and resolves runtime metadata', () => {
  const built = request([
    'POST https://example.test',
    'Content-Type: application/x-www-form-urlencoded',
    '',
    'name={{name}}&role={{role}}',
  ].join('\n'));
  const enriched = {
    ...built,
    headers: [{ name: 'X-{{header}}', value: '{{name}}' }],
    metadata: {
      ...built.metadata,
      description: '{{role}}',
      extensions: { owner: '{{name}}' },
    },
  };
  const result = resolver.resolveRequest(enriched, { definitions: [
    definition('name', 'Ada', 'document'),
    definition('role', 'admin', 'workspace'),
    definition('header', 'Owner', 'global'),
  ] });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }
  assert.equal(result.request.body?.content, 'name=Ada&role=admin');
  assert.deepEqual(
    result.request.body?.type === 'form' && result.request.body.fields,
    [{ name: 'name', value: 'Ada' }, { name: 'role', value: 'admin' }],
  );
  assert.deepEqual(result.request.headers[0], { name: 'X-Owner', value: 'Ada' });
  assert.equal(result.request.metadata.description, 'admin');
  assert.deepEqual(result.request.metadata.extensions, { owner: 'Ada' });
});

test('handles adversarial names, replacement text, stable extension keys, and sensitive URLs', () => {
  const built = request([
    '@name {{regex.name}}',
    'GET https://example.test/path?secret={{secret}}',
    'X-Symbols: {{symbols}}',
  ].join('\n'));
  const extensions = Object.fromEntries([
    ['{{rewriteKey}}', '{{__proto__}}'],
    ['__proto__', '{{constructor}}'],
    ['constructor', '{{prototype}}'],
    ['prototype', '{{symbols}}'],
  ]);
  const enriched = {
    ...built,
    metadata: { ...built.metadata, extensions },
  };
  const sensitive = 'a&b=c#fragment';
  const symbols = "$&-$`-$'-&=#";
  const result = resolver.resolveRequest(enriched, { definitions: [
    definition('regex.name', 'Resolved name', 'document'),
    definition('__proto__', 'proto-value', 'global'),
    definition('constructor', 'constructor-value', 'global'),
    definition('prototype', 'prototype-value', 'global'),
    definition('rewriteKey', 'must-not-rewrite', 'global'),
    definition('symbols', symbols, 'workspace'),
    definition('secret', sensitive, 'environment', true),
  ] });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }
  assert.equal(result.request.name, 'Resolved name');
  assert.equal(
    result.request.url,
    `https://example.test/path?secret=${sensitive}`,
  );
  assert.equal(result.request.headers[0]?.value, symbols);
  assert.equal(
    result.request.resolution?.presentationUrl,
    `https://example.test/path?secret=${MASKED_VARIABLE_VALUE}`,
  );
  assert.doesNotMatch(
    result.request.resolution?.presentationUrl ?? '',
    /a&b=c#fragment/,
  );
  assert.equal(
    result.request.metadata.extensions['{{rewriteKey}}'],
    'proto-value',
  );
  assert.equal(result.request.metadata.extensions.__proto__, 'constructor-value');
  assert.equal(result.request.metadata.extensions.constructor, 'prototype-value');
  assert.equal(result.request.metadata.extensions.prototype, symbols);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.request.metadata.extensions,
      '__proto__',
    ),
    true,
  );
  assert.equal('must-not-rewrite' in result.request.metadata.extensions, false);
});

test('environment captures remain stable across atomic switches', () => {
  let snapshot: VariableConfigurationSnapshot = {
    globalVariables: [],
    workspaceVariables: [],
    activeEnvironmentId: 'dev',
    environments: [
      { id: 'dev', name: 'Development', variables: [
        definition('host', 'dev.test', 'environment'),
      ] },
      { id: 'prod', name: 'Production', variables: [
        definition('host', 'prod.test', 'environment'),
      ] },
    ],
  };
  const manager = new EnvironmentManager({ getSnapshot: () => snapshot });
  const inFlight = manager.capture();
  manager.switchActive('prod');
  snapshot = { ...snapshot, activeEnvironmentId: 'prod' };
  const next = manager.capture();

  assert.equal(inFlight.active?.name, 'Development');
  assert.equal(inFlight.active?.variables[0]?.value, 'dev.test');
  assert.equal(next.active?.name, 'Production');
  assert.ok(Object.isFrozen(inFlight));
  assert.throws(() => {
    (inFlight.workspaceVariables as VariableDefinition[]).push(
      definition('new', 'value', 'workspace'),
    );
  });
});

test('environment refresh emits once only for effective configuration changes', () => {
  let snapshot: VariableConfigurationSnapshot = {
    globalVariables: [definition('global', 'one', 'global')],
    workspaceVariables: [],
    activeEnvironmentId: 'dev',
    environments: [{
      id: 'dev',
      name: 'Development',
      variables: [definition('host', 'dev.test', 'environment')],
    }, {
      id: 'inactive',
      name: 'Inactive',
      variables: [definition('unused', 'one', 'environment')],
    }],
  };
  const manager = new EnvironmentManager({ getSnapshot: () => snapshot });
  let notifications = 0;
  manager.onDidChange(() => {
    notifications += 1;
  });

  manager.refresh();
  assert.equal(notifications, 0);

  snapshot = structuredClone(snapshot);
  manager.refresh();
  assert.equal(notifications, 0);

  snapshot = {
    ...snapshot,
    environments: snapshot.environments.map((environment) =>
      environment.id === 'inactive'
        ? { ...environment, variables: [definition('unused', 'two', 'environment')] }
        : environment),
  };
  manager.refresh();
  assert.equal(notifications, 0);

  snapshot = {
    ...snapshot,
    workspaceVariables: [definition('workspace', 'changed', 'workspace', true)],
  };
  manager.refresh();
  assert.equal(notifications, 1);
});

test('unrelated refresh preserves an explicit session environment switch', () => {
  let snapshot: VariableConfigurationSnapshot = {
    globalVariables: [],
    workspaceVariables: [],
    activeEnvironmentId: 'dev',
    environments: [
      { id: 'dev', name: 'Development', variables: [] },
      { id: 'prod', name: 'Production', variables: [] },
    ],
  };
  const manager = new EnvironmentManager({ getSnapshot: () => snapshot });
  let notifications = 0;
  manager.onDidChange(() => {
    notifications += 1;
  });
  manager.switchActive('prod');

  snapshot = structuredClone(snapshot);
  manager.refresh();

  assert.equal(manager.activeId, 'prod');
  assert.equal(notifications, 1);
});
