import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenize } from '../tokenizer';
import { Lexer, type LexicalToken } from './index';

function lex(source: string) {
  return new Lexer({ sourceId: 'test.api' }).lex(source);
}

function significant(tokens: readonly LexicalToken[]): readonly LexicalToken[] {
  return tokens.filter(
    (token) => token.kind !== 'Newline' && token.kind !== 'EOF',
  );
}

test('consumes tokenizer output and normalizes supported HTTP methods', () => {
  const source = ['get', 'POST', 'put', 'PATCH', 'delete', 'HEAD', 'options']
    .map((method) => `${method} /resource`)
    .join('\n');
  const result = new Lexer().lex(tokenize(source, 'tokenized-input.api'));

  assert.deepEqual(
    result.tokens
      .filter((token) => token.kind === 'HttpMethod')
      .map((token) => token.value),
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  );
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.tokens[0]?.location.sourceId, 'tokenized-input.api');
});

test('recognizes known directives and preserves unknown directives', () => {
  const result = lex(
    [
      '@connection local',
      '@auth bearer',
      '@timeout 5000',
      '@name Users',
      '@description "All users"',
      '@tag smoke',
      '@custom enabled',
    ].join('\n'),
  );
  const directives = result.tokens.filter(
    (token) => token.kind === 'Directive',
  );

  assert.deepEqual(
    directives.map((token) => token.value),
    [
      'connection',
      'auth',
      'timeout',
      'name',
      'description',
      'tag',
      'custom',
    ],
  );
  assert.equal(directives[6]?.diagnostics, undefined);
  assert.equal(result.diagnostics.length, 0);
});

test('keeps header names and values as separate normalized tokens', () => {
  const result = lex(
    [
      'Authorization: Bearer {{token}}',
      'Content-Type: application/json',
      'Accept: application/json',
      'User-Agent: api-hero',
    ].join('\n'),
  );

  assert.deepEqual(
    result.tokens
      .filter((token) => token.kind === 'HeaderName')
      .map((token) => token.value),
    ['authorization', 'content-type', 'accept', 'user-agent'],
  );
  assert.ok(
    result.tokens.some(
      (token) => token.kind === 'HeaderValue' && token.value === 'Bearer',
    ),
  );
  assert.ok(
    result.tokens.some(
      (token) => token.kind === 'Variable' && token.value === 'token',
    ),
  );
});

test('normalizes variables, literals, and JSON symbols', () => {
  const result = lex(
    '{"url":{{baseUrl}},"id":{{employeeId}},"count":-12.5e2,"active":TRUE,"missing":null}',
  );
  const tokens = significant(result.tokens);

  assert.deepEqual(
    tokens
      .filter((token) => token.kind === 'Variable')
      .map((token) => token.value),
    ['baseUrl', 'employeeId'],
  );
  assert.ok(
    tokens.some(
      (token) => token.kind === 'Number' && token.value === -1250,
    ),
  );
  assert.ok(
    tokens.some(
      (token) => token.kind === 'Boolean' && token.value === true,
    ),
  );
  assert.ok(
    tokens.some((token) => token.kind === 'Null' && token.value === null),
  );
  assert.deepEqual(
    tokens
      .filter((token) =>
        ['LeftBrace', 'RightBrace', 'Colon', 'Comma'].includes(token.kind),
      )
      .map((token) => token.kind),
    [
      'LeftBrace',
      'Colon',
      'Comma',
      'Colon',
      'Comma',
      'Colon',
      'Comma',
      'Colon',
      'Comma',
      'Colon',
      'RightBrace',
    ],
  );
  assert.deepEqual(
    significant(lex('[]').tokens).map((token) => token.kind),
    ['LeftBracket', 'RightBracket'],
  );
});

test('decodes quoted strings without losing their raw spelling', () => {
  const result = lex('"line\\nvalue" \'single\' `template` "\\u263A"');
  const strings = result.tokens.filter((token) => token.kind === 'String');

  assert.deepEqual(
    strings.map((token) => token.value),
    ['line\nvalue', 'single', 'template', '☺'],
  );
  assert.equal(strings[0]?.raw, '"line\\nvalue"');
});

test('removes horizontal whitespace and preserves comments and boundaries', () => {
  const result = lex(
    '  # setup  \r\nGET   /first\r\n\r\n###\r\n// next\r\nPOST /second',
  );

  assert.equal(
    result.tokens.some(
      (token) =>
        token.kind !== 'Newline' &&
        token.raw.length > 0 &&
        token.raw.trim().length === 0,
    ),
    false,
  );
  assert.equal(
    result.tokens.filter((token) => token.kind === 'Newline').length,
    5,
  );
  assert.ok(
    result.tokens.some(
      (token) => token.kind === 'Comment' && token.value === 'setup',
    ),
  );
  assert.ok(
    result.tokens.some((token) => token.kind === 'RequestBoundary'),
  );
});

test('reports malformed input and continues lexing later requests', () => {
  const result = lex(
    [
      'FETCH /unknown',
      '@',
      'GET /first',
      'X-Id: {{bad variable',
      '"unterminated',
      '"bad\\q"',
      '12abc',
      '(invalid)',
      '\\',
      'POST /recovered',
    ].join('\n'),
  );
  const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));

  assert.ok(codes.has('unknown-http-method'));
  assert.ok(codes.has('invalid-directive'));
  assert.ok(codes.has('malformed-variable'));
  assert.ok(codes.has('invalid-literal'));
  assert.ok(codes.has('invalid-token-sequence'));
  assert.ok(codes.has('unexpected-character'));
  assert.ok(
    result.tokens.some(
      (token) => token.kind === 'HttpMethod' && token.value === 'POST',
    ),
  );
  assert.ok(
    result.tokens
      .filter((token) => token.diagnostics !== undefined)
      .every((token) => (token.diagnostics?.length ?? 0) > 0),
  );
  assert.equal(
    result.tokens.find((token) => token.raw === '"bad\\q"')?.diagnostics?.[0]
      ?.code,
    'invalid-literal',
  );
});

test('handles Unicode content with UTF-16 source locations', () => {
  const result = lex('@description "München 🚀"\nGET /员工/{{employeeId}}');
  const string = result.tokens.find((token) => token.kind === 'String');
  const variable = result.tokens.find((token) => token.kind === 'Variable');

  assert.equal(string?.value, 'München 🚀');
  assert.equal(variable?.value, 'employeeId');
  assert.equal(variable?.location.sourceId, 'test.api');
  assert.equal(variable?.location.range.start.line, 1);
});

test('processes large files in one recoverable lexical pass', () => {
  const requestCount = 5_000;
  const source = Array.from(
    { length: requestCount },
    (_, index) => `GET /employees/${index}\nAccept: application/json\n###\n`,
  ).join('');
  const result = lex(source);

  assert.equal(
    result.tokens.filter((token) => token.kind === 'HttpMethod').length,
    requestCount,
  );
  assert.equal(
    result.tokens.filter((token) => token.kind === 'RequestBoundary').length,
    requestCount,
  );
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.tokens.at(-1)?.kind, 'EOF');
});
