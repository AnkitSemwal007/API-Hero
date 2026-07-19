import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TokenizerDiagnosticCode } from '../diagnostics';
import { TokenKind, type Token } from '../tokens';
import { tokenize } from '.';

function significantTokens(source: string): readonly Token[] {
  return tokenize(source).tokens.filter(
    (token) =>
      token.kind !== TokenKind.Whitespace &&
      token.kind !== TokenKind.Newline &&
      token.kind !== TokenKind.EOF,
  );
}

test('emits EOF for empty input', () => {
  const result = tokenize('', 'empty.api');

  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.tokens.map((token) => token.kind), [TokenKind.EOF]);
  assert.deepEqual(result.tokens[0]?.start, { offset: 0, line: 0, column: 0 });
  assert.equal(result.tokens[0]?.location.sourceId, 'empty.api');
});

test('retains whitespace and tracks LF, CRLF, and CR as newlines', () => {
  const result = tokenize(' \r\n\t\n\rX');

  assert.deepEqual(
    result.tokens.map((token) => [token.kind, token.raw]),
    [
      [TokenKind.Whitespace, ' '],
      [TokenKind.Newline, '\r\n'],
      [TokenKind.Whitespace, '\t'],
      [TokenKind.Newline, '\n'],
      [TokenKind.Newline, '\r'],
      [TokenKind.Identifier, 'X'],
      [TokenKind.EOF, ''],
    ],
  );
  assert.deepEqual(result.tokens[5]?.start, {
    offset: 6,
    line: 3,
    column: 0,
  });
});

test('recognizes comments without treating URL slashes as comments', () => {
  const tokens = significantTokens(
    '# first\n// second\nGET https://example.test/a?x=1&y=2#result\nGET //example.test/a\n',
  );

  assert.deepEqual(
    tokens.map((token) => [token.kind, token.raw]),
    [
      [TokenKind.Comment, '# first'],
      [TokenKind.Comment, '// second'],
      [TokenKind.HttpMethod, 'GET'],
      [TokenKind.Identifier, 'https'],
      [TokenKind.Colon, ':'],
      [TokenKind.Identifier, '//example.test/a?x=1&y=2#result'],
      [TokenKind.HttpMethod, 'GET'],
      [TokenKind.Identifier, '//example.test/a'],
    ],
  );
});

test('classifies exact request-line methods and normalizes their case', () => {
  const tokens = significantTokens(
    'get /a\nPOST /b\nPUT /c\nPATCH /d\nDELETE /e\nHEAD /f\nOPTIONS /g\nvalue GET\n',
  );

  assert.deepEqual(
    tokens
      .filter((token) => token.kind === TokenKind.HttpMethod)
      .map((token) => token.normalized),
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  );
  assert.equal(tokens.at(-2)?.kind, TokenKind.Identifier);
  assert.equal(tokens.at(-1)?.raw, 'GET');
});

test('uses lightweight line context for headers and embedded variables', () => {
  const tokens = significantTokens(
    'Content-Type: application/json\nAuthorization: Bearer {{token}}\n',
  );

  assert.deepEqual(
    tokens.map((token) => [token.kind, token.raw, token.normalized]),
    [
      [TokenKind.HeaderName, 'Content-Type', 'content-type'],
      [TokenKind.Colon, ':', undefined],
      [TokenKind.HeaderValue, 'application/json', undefined],
      [TokenKind.HeaderName, 'Authorization', 'authorization'],
      [TokenKind.Colon, ':', undefined],
      [TokenKind.HeaderValue, 'Bearer', undefined],
      [TokenKind.Variable, '{{token}}', 'token'],
    ],
  );
});

test('recognizes reserved future built-in variable references', () => {
  const result = tokenize('GET /events/{{$timestamp}}/{{$uuid}}');
  const variables = result.tokens.filter((token) => token.kind === TokenKind.Variable);

  assert.deepEqual(variables.map((token) => token.normalized), ['$timestamp', '$uuid']);
  assert.equal(result.diagnostics.length, 0);
});

test('tokenizes generic directives without validating directive names', () => {
  const tokens = significantTokens(
    '@connection local\n@future-feature enabled\nGET https://user@example.test',
  );

  assert.deepEqual(
    tokens.filter((token) => token.kind === TokenKind.Directive).map((token) => [
      token.raw,
      token.normalized,
    ]),
    [
      ['@connection', 'connection'],
      ['@future-feature', 'future-feature'],
    ],
  );
  assert.ok(tokens.some((token) => token.raw === '//user@example.test'));
});

test('tokenizes JSON punctuation, strings, scalars, and numbers', () => {
  const tokens = significantTokens(
    '{"ok":true,"off":FALSE,"none":null,"n":-12.5e+2,"items":[0,+3]}',
  );

  assert.deepEqual(
    tokens.map((token) => token.kind),
    [
      TokenKind.Brace,
      TokenKind.String,
      TokenKind.Colon,
      TokenKind.Boolean,
      TokenKind.Comma,
      TokenKind.String,
      TokenKind.Colon,
      TokenKind.Boolean,
      TokenKind.Comma,
      TokenKind.String,
      TokenKind.Colon,
      TokenKind.Null,
      TokenKind.Comma,
      TokenKind.String,
      TokenKind.Colon,
      TokenKind.Number,
      TokenKind.Comma,
      TokenKind.String,
      TokenKind.Colon,
      TokenKind.Bracket,
      TokenKind.Number,
      TokenKind.Comma,
      TokenKind.Number,
      TokenKind.Bracket,
      TokenKind.Brace,
    ],
  );
  assert.deepEqual(
    tokens
      .filter((token) => token.kind === TokenKind.Number)
      .map((token) => token.raw),
    ['-12.5e+2', '0', '+3'],
  );
  assert.deepEqual(
    tokens
      .filter(
        (token) =>
          token.kind === TokenKind.Boolean || token.kind === TokenKind.Null,
      )
      .map((token) => token.normalized),
    ['true', 'false', 'null'],
  );
});

test('supports single, double, and backtick quoted strings and common escapes', () => {
  const result = tokenize(String.raw`"a\n\u0041" 'b\'' ` + '`c\\`' + '`');

  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    significantTokens(String.raw`"a\n\u0041" 'b\'' ` + '`c\\`' + '`').map(
      (token) => token.kind,
    ),
    [TokenKind.String, TokenKind.String, TokenKind.String],
  );
});

test('reports malformed strings and escapes while recovering', () => {
  const result = tokenize('"bad\\q"\n"unterminated\nGET /after');

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      TokenizerDiagnosticCode.InvalidEscape,
      TokenizerDiagnosticCode.UnterminatedString,
    ],
  );
  assert.ok(
    result.tokens.some(
      (token) =>
        token.kind === TokenKind.HttpMethod && token.normalized === 'GET',
    ),
  );
});

test('does not advance beyond EOF for a trailing string escape', () => {
  const source = ['"', 'a', '\\'].join('');
  const result = tokenize(source);
  const string = result.tokens[0];
  const eof = result.tokens.at(-1);

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      TokenizerDiagnosticCode.InvalidEscape,
      TokenizerDiagnosticCode.UnterminatedString,
    ],
  );
  assert.equal(string?.length, source.length);
  assert.equal(string?.end.offset, source.length);
  assert.equal(eof?.start.offset, source.length);
  assert.equal(eof?.end.offset, source.length);
});

test('reports malformed variables and continues on the following line', () => {
  const result = tokenize('{{not valid}}\n{{unclosed\nPOST /after');

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      TokenizerDiagnosticCode.InvalidVariableSyntax,
      TokenizerDiagnosticCode.InvalidVariableSyntax,
    ],
  );
  assert.equal(
    result.tokens.filter((token) => token.kind === TokenKind.Variable).length,
    2,
  );
  assert.ok(
    result.tokens.some(
      (token) =>
        token.kind === TokenKind.HttpMethod && token.normalized === 'POST',
    ),
  );
});

test('reports controls and unknown characters without stopping tokenization', () => {
  const result = tokenize('ok\u0001\\\uFFFD next');

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      TokenizerDiagnosticCode.UnexpectedControlCharacter,
      TokenizerDiagnosticCode.UnknownCharacter,
      TokenizerDiagnosticCode.UnknownCharacter,
    ],
  );
  assert.deepEqual(
    result.tokens
      .filter((token) => token.kind === TokenKind.Unknown)
      .map((token) => token.raw),
    ['\u0001', '\\', '\uFFFD'],
  );
  assert.ok(result.tokens.some((token) => token.raw === 'next'));
});

test('preserves Unicode and measures offsets and columns in UTF-16 units', () => {
  const result = tokenize('é😀\r\nGET /✓');
  const unicode = result.tokens[0];
  const method = result.tokens.find(
    (token) => token.kind === TokenKind.HttpMethod,
  );
  const eof = result.tokens.at(-1);

  assert.equal(unicode?.raw, 'é😀');
  assert.equal(unicode?.length, 3);
  assert.deepEqual(unicode?.span, { offset: 0, length: 3 });
  assert.deepEqual(unicode?.end, { offset: 3, line: 0, column: 3 });
  assert.deepEqual(method?.start, { offset: 5, line: 1, column: 0 });
  assert.deepEqual(eof?.start, { offset: 11, line: 1, column: 6 });
  assert.equal(eof?.kind, TokenKind.EOF);
});

test('uses half-open exact locations for every emitted token', () => {
  const result = tokenize('GET x', 'request.api');

  for (const token of result.tokens) {
    assert.equal(token.start.offset + token.length, token.end.offset);
    assert.equal(token.span.offset, token.start.offset);
    assert.equal(token.span.length, token.length);
    assert.deepEqual(token.location.range, {
      start: token.start,
      end: token.end,
    });
    assert.equal(token.location.sourceId, 'request.api');
  }
});
