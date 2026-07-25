import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VariableDefinition } from '../models';
import { MASKED_VARIABLE_VALUE } from './variable-resolver';
import {
  VariableCompletionService,
  fuzzyMatches,
} from './variable-completion-service';

function definition(
  name: string,
  value: string,
  scope: VariableDefinition['scope'],
  sensitive = false,
): VariableDefinition {
  return { name, value, scope, sensitive };
}

test('analyzeInput activates only inside open {{ regions', () => {
  const service = new VariableCompletionService();

  assert.equal(service.analyzeInput('hello {', 7).isActive, false);
  assert.equal(service.analyzeInput('hello {x', 8).isActive, false);

  const open = service.analyzeInput('GET {{', 6);
  assert.equal(open.isActive, true);
  assert.equal(open.prefix, '');
  assert.equal(open.insertMode, 'name-only');
  assert.equal(open.replaceStart, 6);
  assert.equal(open.replaceEnd, 6);

  const typed = service.analyzeInput('GET {{tok', 9);
  assert.equal(typed.isActive, true);
  assert.equal(typed.prefix, 'tok');
  assert.equal(typed.replaceStart, 6);
  assert.equal(typed.replaceEnd, 9);

  const closed = service.analyzeInput('GET {{token}}/x', 14);
  assert.equal(closed.isActive, false);

  const insideClosed = service.analyzeInput('GET {{ba}}/x', 8);
  assert.equal(insideClosed.isActive, true);
  assert.equal(insideClosed.prefix, 'ba');
});

test('analyzeInput replace range covers name before closing braces', () => {
  const service = new VariableCompletionService();
  const context = service.analyzeInput('{{ba|}}'.replace('|', ''), 4);
  assert.equal(context.isActive, true);
  assert.equal(context.prefix, 'ba');
  assert.equal(context.replaceStart, 2);
  assert.equal(context.replaceEnd, 4);
  assert.equal(context.insertMode, 'name-only');
});

test('fuzzy filter matches subsequences case-insensitively', () => {
  assert.equal(fuzzyMatches('tok', 'token'), true);
  assert.equal(fuzzyMatches('tok', 'accessToken'), true);
  assert.equal(fuzzyMatches('tok', 'refreshToken'), true);
  assert.equal(fuzzyMatches('url', 'baseUrl'), true);
  assert.equal(fuzzyMatches('url', 'callbackUrl'), true);
  assert.equal(fuzzyMatches('zzz', 'token'), false);

  const service = new VariableCompletionService();
  service.setDefinitions([
    definition('token', 'a', 'global'),
    definition('accessToken', 'b', 'workspace'),
    definition('refreshToken', 'c', 'environment'),
    definition('baseUrl', 'd', 'document'),
    definition('callbackUrl', 'e', 'global'),
    definition('host', 'f', 'global'),
  ]);

  assert.deepEqual(
    service.getCompletions('tok').map((item) => item.name),
    ['accessToken', 'refreshToken', 'token'],
  );
  assert.deepEqual(
    service.getCompletions('url').map((item) => item.name),
    ['baseUrl', 'callbackUrl'],
  );
  assert.deepEqual(
    service.getCompletions('').map((item) => item.name),
    ['accessToken', 'baseUrl', 'callbackUrl', 'host', 'refreshToken', 'token'],
  );
});

test('scope precedence yields one effective item with winning scope', () => {
  const service = new VariableCompletionService();
  service.setDefinitions([
    definition('host', 'global', 'global'),
    definition('host', 'workspace', 'workspace'),
    definition('host', 'environment', 'environment'),
    definition('host', 'document', 'document'),
  ]);

  const items = service.getCompletions('');
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'host');
  assert.equal(items[0]?.scope, 'document');
  assert.equal(items[0]?.sourceLabel, 'Request');
  assert.equal(items[0]?.icon, '📄');
});

test('sensitive values never appear in completion models or hover', () => {
  const service = new VariableCompletionService();
  service.setDefinitions([
    definition('token', 'super-secret', 'environment', true),
    definition('host', 'example.test', 'global'),
  ]);

  const token = service.getCompletions('').find((item) => item.name === 'token');
  assert.equal(token?.sensitive, true);
  assert.equal(token?.valuePreview, undefined);
  assert.ok(token?.icon.includes('🔒'));
  assert.doesNotMatch(JSON.stringify(token), /super-secret/);

  const hover = service.getHoverInfo('token');
  assert.equal(hover?.valueDisplay, MASKED_VARIABLE_VALUE);
  assert.equal(hover?.sensitive, true);
  assert.doesNotMatch(hover?.documentation ?? '', /super-secret/);
  assert.match(hover?.documentation ?? '', /Yes/);

  const host = service.getHoverInfo('host');
  assert.equal(host?.valueDisplay, 'example.test');
  assert.match(host?.documentation ?? '', /Effective source:.*Global/u);
  assert.match(host?.documentation ?? '', /Current Value/);
  assert.match(host?.documentation ?? '', /\nNo$/m);
});

test('buildInsertText supports wrap and name-only modes', () => {
  const service = new VariableCompletionService();
  service.setDefinitions([definition('baseUrl', 'https://x', 'global')]);
  const item = service.getCompletions('base')[0]!;

  const wrap = service.analyzeInput('hello ', 6);
  assert.equal(service.buildInsertText(item, wrap), '{{baseUrl}}');

  const nameOnly = service.analyzeInput('{{ba', 4);
  assert.equal(service.buildInsertText(item, nameOnly), 'baseUrl');
});

test('suggestCorrection returns a close fuzzy match', () => {
  const service = new VariableCompletionService();
  service.setDefinitions([
    definition('baseUrl', 'https://x', 'global'),
    definition('token', 't', 'workspace'),
  ]);

  assert.equal(service.suggestCorrection('baseUr'), 'baseUrl');
  assert.equal(service.suggestCorrection('tokn'), 'token');
  assert.equal(service.suggestCorrection('zzzz'), undefined);
  assert.equal(service.suggestCorrection('baseUrl'), undefined);
});

test('cache refreshes only when definitions change', () => {
  const service = new VariableCompletionService();
  const first = [
    definition('host', 'a', 'global'),
    definition('token', 'b', 'workspace', true),
  ];
  service.setDefinitions(first);
  assert.equal(service.getCachedCount(), 2);
  const snapshot = service.getCompletions('');

  service.setDefinitions(first);
  assert.equal(service.getCompletions(''), snapshot);

  service.setDefinitions([
    definition('host', 'a', 'global'),
    definition('token', 'b', 'workspace', true),
    definition('region', 'us', 'environment'),
  ]);
  assert.equal(service.getCachedCount(), 3);
  assert.ok(service.getCompletions('').some((item) => item.name === 'region'));

  // Environment switch: replace environment-scoped defs
  service.setDefinitions([
    definition('host', 'a', 'global'),
    definition('token', 'b', 'workspace', true),
    definition('region', 'eu', 'environment'),
  ]);
  const region = service.getCompletions('').find((item) => item.name === 'region');
  assert.equal(region?.valuePreview, 'eu');
});

test('resolvePreview masks sensitive values and leaves unknown refs', () => {
  const service = new VariableCompletionService();
  service.setDefinitions([
    definition('host', 'example.test', 'global'),
    definition('token', 'secret', 'document', true),
  ]);

  assert.equal(service.resolvePreview('plain text'), undefined);

  const preview = service.resolvePreview('https://{{host}}/{{token}}/{{missing}}');
  assert.deepEqual(preview, {
    resolved: `https://example.test/${MASKED_VARIABLE_VALUE}/{{missing}}`,
    hasSensitive: true,
  });
});

test('source labels map document scope to Request', () => {
  const service = new VariableCompletionService();
  service.setDefinitions([
    definition('a', '1', 'document'),
    definition('b', '2', 'environment'),
    definition('c', '3', 'workspace'),
    definition('d', '4', 'global'),
  ]);
  const byName = Object.fromEntries(
    service.getCompletions('').map((item) => [item.name, item.sourceLabel]),
  );
  assert.deepEqual(byName, {
    a: 'Request',
    b: 'Environment',
    c: 'Workspace',
    d: 'Global',
  });
});
