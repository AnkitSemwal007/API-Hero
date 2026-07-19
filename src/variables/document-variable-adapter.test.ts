import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseApiDocument } from '../parser';
import { extractDocumentVariables, VARIABLE_DIAGNOSTIC_CODES } from './index';

function extractFrom(source: string) {
  const document = parseApiDocument(source, { sourceId: 'vars.api' }).ast;
  return extractDocumentVariables(document);
}

test('extracts @variable and @sensitive-variable definitions', () => {
  const result = extractFrom([
    '@variable host=https://example.test',
    '@sensitive-variable token=sekrit',
    'GET {{host}}/users',
  ].join('\n'));

  assert.equal(result.definitions.length, 2);
  assert.deepEqual(result.definitions[0], {
    name: 'host',
    value: 'https://example.test',
    scope: 'document',
    sensitive: false,
  });
  assert.deepEqual(result.definitions[1], {
    name: 'token',
    value: 'sekrit',
    scope: 'document',
    sensitive: true,
  });
  assert.equal(result.diagnostics.length, 0);
});

test('reports malformed names, missing equals, and empty names', () => {
  const result = extractFrom([
    '@variable =no-name',
    '@variable missing-equals',
    '@variable 1bad=value',
    '@sensitive-variable =also-bad',
    '@variable good=ok',
  ].join('\n'));

  assert.equal(result.definitions.length, 1);
  assert.equal(result.definitions[0]?.name, 'good');
  assert.equal(result.diagnostics.length, 4);
  for (const diagnostic of result.diagnostics) {
    assert.equal(diagnostic.code, VARIABLE_DIAGNOSTIC_CODES.malformedDefinition);
    assert.equal(diagnostic.severity, 'error');
  }
});

test('freezes definitions and diagnostics bags', () => {
  const result = extractFrom('@variable a=1\nGET /');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.definitions));
  assert.ok(Object.isFrozen(result.diagnostics));
  assert.ok(Object.isFrozen(result.definitions[0]));
  assert.throws(() => {
    (result.definitions as unknown as { push: (value: unknown) => void }).push({
      name: 'x',
      value: 'y',
      scope: 'document',
      sensitive: false,
    });
  });
});

test('ignores unrelated directives', () => {
  const result = extractFrom([
    '@name List users',
    '@tag users',
    '@auth bearer',
    '@timeout 5000',
    'GET /users',
  ].join('\n'));

  assert.equal(result.definitions.length, 0);
  assert.equal(result.diagnostics.length, 0);
});
