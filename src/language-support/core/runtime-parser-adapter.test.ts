import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LANGUAGE_DIAGNOSTIC_CODES } from '../constants';
import { RuntimeParserAdapter } from './runtime-parser-adapter';

function positionAt(source: string, search: string, delta = 0) {
  const offset = source.indexOf(search) + delta;
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return {
    offset,
    line: lines.length - 1,
    column: lines.at(-1)?.length ?? 0,
  };
}

test('projects canonical requests into outline symbols', () => {
  const source = [
    '@name List users',
    '@tag users',
    'GET https://api.example.com/users',
    'Accept: application/json',
    '',
    '###',
    'POST /users',
    '@name Create user',
    '{',
    '  "active": true',
    '}',
  ].join('\n');
  const adapter = new RuntimeParserAdapter(source, 'outline.api');

  assert.deepEqual(
    adapter.getSymbols().map((symbol) => ({
      name: symbol.name,
      start: symbol.range.start.line,
      end: symbol.range.end.line,
      selection: symbol.selectionRange.start.line,
    })),
    [
      { name: 'List users', start: 0, end: 3, selection: 2 },
      { name: 'Create user', start: 6, end: 10, selection: 6 },
    ],
  );
  assert.equal(adapter.document.requests.length, 2);
});

test('derives request, directive, and nested JSON folds from AST ranges', () => {
  const source = [
    '@name Create user',
    '@tag users',
    'POST /users',
    '{',
    '  "profile": {',
    '    "active": true',
    '  }',
    '}',
  ].join('\n');
  const folds = new RuntimeParserAdapter(source).getFolds();

  assert.ok(folds.some(
    (fold) => fold.kind === 'request' && fold.startLine === 2 && fold.endLine === 7,
  ));
  assert.ok(folds.some(
    (fold) => fold.kind === 'directives' && fold.startLine === 0 && fold.endLine === 1,
  ));
  assert.ok(folds.some(
    (fold) => fold.kind === 'json' && fold.startLine === 3 && fold.endLine === 7,
  ));
  assert.ok(folds.some(
    (fold) => fold.kind === 'json' && fold.startLine === 4 && fold.endLine === 6,
  ));
});

test('offers hover only for parser-recognized methods and directives', () => {
  const source = [
    '# GET in a comment',
    '@timeout 1000',
    'GET /users',
  ].join('\n');
  const adapter = new RuntimeParserAdapter(source);

  assert.equal(adapter.getHover(positionAt(source, '@timeout', 2))?.key, '@timeout');
  assert.equal(adapter.getHover(positionAt(source, 'GET /users', 1))?.key, 'GET');
  assert.equal(adapter.getHover(positionAt(source, '# GET', 3)), undefined);
});

test('preserves completion candidates for incomplete cursor contexts', () => {
  const methodSource = 'PO';
  const methodItems = new RuntimeParserAdapter(methodSource)
    .getCompletions(positionAt(methodSource, 'PO', 2));
  assert.ok(methodItems.some(
    (item) => item.kind === 'method' && item.label === 'POST',
  ));

  const mimeSource = 'Accept: application/';
  const mimeItems = new RuntimeParserAdapter(mimeSource)
    .getCompletions(positionAt(mimeSource, mimeSource, mimeSource.length));
  assert.ok(mimeItems.some(
    (item) => item.kind === 'mime' && item.label === 'application/json',
  ));

  const variableSource = 'GET /users/{{us';
  const variableItems = new RuntimeParserAdapter(variableSource)
    .getCompletions(positionAt(variableSource, variableSource, variableSource.length));
  assert.deepEqual(
    variableItems
      .filter((item) => item.kind === 'variable')
      .map((item) => item.label),
    [],
  );
});

test('provides variable diagnostics, effective completions, and safe hovers', () => {
  const source = [
    '@variable local=hello',
    '@sensitive-variable token=private',
    'GET https://{{host}}/{{local}}',
    'Authorization: {{token}}',
  ].join('\n');
  const adapter = new RuntimeParserAdapter(source, 'variables.api', {
    definitions: [
      { name: 'host', value: 'example.test', scope: 'environment', sensitive: false },
      { name: 'token', value: 'configured', scope: 'global', sensitive: false },
    ],
  });

  assert.equal(
    adapter.getHover(positionAt(source, '{{token}}', 3))?.documentation,
    'document variable · ••••••••',
  );
  assert.doesNotMatch(
    adapter.getHover(positionAt(source, '{{token}}', 3))?.documentation ?? '',
    /private/,
  );
  assert.deepEqual(adapter.diagnostics, []);

  const incomplete = `${source}\nX-Test: {{`;
  const completions = new RuntimeParserAdapter(incomplete, undefined, {
    definitions: [
      { name: 'host', value: 'example.test', scope: 'environment', sensitive: false },
    ],
  }).getCompletions(positionAt(incomplete, 'X-Test: {{', 10));
  assert.deepEqual(
    completions.filter((item) => item.kind === 'variable').map((item) => item.label),
    ['host', 'local', 'token'],
  );
  assert.equal(
    completions.find((item) => item.label === 'token')?.detail,
    'document · sensitive',
  );
});

test('deduplicates variable diagnostics with canonical ranges and stable codes', () => {
  const source = [
    '@variable duplicate=one',
    '@variable duplicate=two',
    'GET https://{{missing}}/{{$timestamp}}',
  ].join('\n');
  const diagnostics = new RuntimeParserAdapter(source, 'variables.api').diagnostics;

  assert.equal(
    diagnostics.filter((item) => item.code === 'variables.duplicate-definition').length,
    1,
  );
  assert.equal(
    diagnostics.filter((item) => item.code === 'variables.missing').length,
    1,
  );
  assert.equal(
    diagnostics.filter((item) => item.code === 'variables.unsupported-built-in').length,
    1,
  );
  assert.ok(diagnostics.every((item) => item.range.start.offset <= item.range.end.offset));
});

test('combines canonical parser and semantic validation diagnostics once', () => {
  const source = [
    '@name First',
    '@name Second',
    '@timeout later',
    '@description',
    '@unknown value',
    'FETCH https://api.example.com/users',
    'GET',
  ].join('\n');
  const codes = new Set(
    new RuntimeParserAdapter(source).diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
  );

  assert.ok(codes.has('lexer.unknown-http-method'));
  assert.ok(codes.has('parser.missing-url'));
  assert.ok(codes.has('parser.unknown-directive'));
  assert.ok(codes.has(LANGUAGE_DIAGNOSTIC_CODES.duplicateDirective));
  assert.ok(codes.has(LANGUAGE_DIAGNOSTIC_CODES.invalidDirective));
  assert.equal(
    new RuntimeParserAdapter(source).diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === LANGUAGE_DIAGNOSTIC_CODES.duplicateDirective,
    ).length,
    1,
  );
});

test('does not duplicate an empty unknown directive as invalid syntax', () => {
  const unknownDiagnostics = new RuntimeParserAdapter('@unknown').diagnostics;

  assert.ok(unknownDiagnostics.some(
    (diagnostic) => diagnostic.code === 'parser.unknown-directive',
  ));
  assert.equal(
    unknownDiagnostics.some(
      (diagnostic) =>
        diagnostic.code === LANGUAGE_DIAGNOSTIC_CODES.invalidDirective,
    ),
    false,
  );

  const knownDiagnostics = new RuntimeParserAdapter(
    ['@description', '@timeout'].join('\n'),
  ).diagnostics;
  assert.equal(
    knownDiagnostics.filter(
      (diagnostic) =>
        diagnostic.code === LANGUAGE_DIAGNOSTIC_CODES.invalidDirective,
    ).length,
    2,
  );
});
