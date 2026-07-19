import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AstNodeType } from './ast';
import { parseApiDocument, validateApiDocument } from './index';
import { Lexer } from './lexer';
import { Parser, parse } from './parser';

function parseSource(source: string) {
  return parseApiDocument(source, { sourceId: 'test.api' });
}

test('parses requests, headers, directives, comments, and variables', () => {
  const result = parseSource(
    [
      '# document setup',
      '@connection local',
      'GET https://example.test/users/{{userId}}',
      '@name Get user',
      'Authorization: Bearer {{token}}',
      '// request note',
    ].join('\n'),
  );

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.ast.comments[0]?.text, 'document setup');
  assert.equal(result.ast.directives[0]?.knownName, 'connection');
  const request = result.ast.requests[0];
  assert.equal(request?.method, 'GET');
  assert.equal(request?.url, 'https://example.test/users/{{userId}}');
  assert.equal(request?.headers[0]?.name, 'Authorization');
  assert.equal(request?.headers[0]?.value, 'Bearer {{token}}');
  assert.equal(request?.directives[0]?.value, 'Get user');
  assert.equal(request?.comments[0]?.text, 'request note');
  assert.deepEqual(
    request?.variables.map((variable) => variable.name),
    ['userId', 'token'],
  );
  assert.deepEqual(
    request?.children.map((node) => node.type),
    [
      AstNodeType.Directive,
      AstNodeType.Comment,
      AstNodeType.Header,
      AstNodeType.Variable,
      AstNodeType.Variable,
    ],
  );
});

test('parses nested JSON literals and JSON variable placeholders', () => {
  const result = parseSource(
    [
      'POST /employees',
      'Content-Type: application/json',
      '{',
      '  "name": "München 🚀",',
      '  "age": 42,',
      '  "active": true,',
      '  "manager": null,',
      '  "tags": ["api", false, 2.5],',
      '  "ownerId": {{ownerId}},',
      '  "address": {"city": "東京"}',
      '}',
    ].join('\n'),
  );

  assert.equal(result.diagnostics.length, 0);
  const request = result.ast.requests[0];
  assert.equal(request?.body?.type, AstNodeType.JsonBody);
  assert.deepEqual(
    request?.variables.map((variable) => variable.name),
    ['ownerId'],
  );
  if (request?.body?.type !== AstNodeType.JsonBody) {
    assert.fail('Expected a JSON body.');
  }
  assert.equal(request.body.value.type, AstNodeType.ObjectLiteral);
  if (request.body.value.type !== AstNodeType.ObjectLiteral) {
    assert.fail('Expected an object literal.');
  }
  assert.ok(request.body.value.raw.startsWith('{'));
  assert.ok(request.body.value.raw.endsWith('}'));
  assert.equal(request.body.value.properties.length, 7);
  const tags = request.body.value.properties[4]?.value;
  assert.equal(tags?.type, AstNodeType.ArrayLiteral);
  if (tags?.type === AstNodeType.ArrayLiteral) {
    assert.deepEqual(
      tags.elements.map((element) => element.type),
      [
        AstNodeType.StringLiteral,
        AstNodeType.BooleanLiteral,
        AstNodeType.NumberLiteral,
      ],
    );
  }
  const placeholder = request.body.value.properties[5]?.value;
  assert.equal(placeholder?.type, AstNodeType.StringLiteral);
  assert.equal(placeholder?.metadata.variableName, 'ownerId');
  assert.doesNotThrow(() => JSON.stringify(result.ast));
});

test('separates inline request comments from URLs', () => {
  const result = parseSource('GET /employees # lookup');
  const request = result.ast.requests[0];

  assert.equal(request?.url, '/employees');
  assert.equal(request?.comments[0]?.text, 'lookup');
});

test('parses raw bodies and keeps their variables parent-safe', () => {
  const result = parseSource(
    ['POST /messages', 'Content-Type: text/plain', 'hello {{name}}', 'next line'].join(
      '\n',
    ),
  );
  const request = result.ast.requests[0];

  assert.equal(request?.body?.type, AstNodeType.RawBody);
  if (request?.body?.type !== AstNodeType.RawBody) {
    assert.fail('Expected a raw body.');
  }
  assert.equal(request.body.content, 'hello {{name}}\nnext line');
  assert.deepEqual(
    request.body.variables.map((variable) => variable.name),
    ['name'],
  );
  assert.equal(request.body.variables[0]?.parent, request.body);
  assert.equal(request.variables.length, 0);
});

test('parses multiple requests with and without explicit boundaries', () => {
  const result = parseSource(
    ['GET /one', '###', 'POST /two', 'PUT /three'].join('\n'),
  );

  assert.deepEqual(
    result.ast.requests.map((request) => [request.method, request.url]),
    [
      ['GET', '/one'],
      ['POST', '/two'],
      ['PUT', '/three'],
    ],
  );
});

test('recovers from malformed requests and continues later requests', () => {
  const result = parseSource(
    [
      'GET',
      'Accept:',
      '@future enabled',
      'POST /broken',
      'Content-Type: application/json',
      '{"missingColon" true, "array": [1 2], "open": {',
      '###',
      'PUT /recovered',
      'X-Value: {{bad variable}}',
      'DELETE /last',
    ].join('\n'),
  );
  const codes = new Set([
    ...result.diagnostics.map((diagnostic) => diagnostic.code),
    ...validateApiDocument(result.ast).diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
  ]);

  assert.ok(codes.has('parser.missing-url'));
  assert.ok(codes.has('parser.missing-header-value'));
  assert.ok(codes.has('parser.unknown-directive'));
  assert.ok(codes.has('parser.missing-property-colon'));
  assert.ok(codes.has('parser.missing-comma'));
  assert.ok(codes.has('parser.unexpected-eof'));
  assert.ok(codes.has('lexer.malformed-variable'));
  assert.deepEqual(
    result.ast.requests.map((request) => request.url),
    ['', '/broken', '/recovered', '/last'],
  );
});

test('recovers from unexpected document tokens and unexpected EOF', () => {
  const lexical = new Lexer().lex('orphan\nPOST /items\n{"items":[1,2');
  const result = new Parser(lexical).parse();
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes('parser.unexpected-token'));
  assert.ok(codes.includes('parser.unexpected-eof'));
  assert.equal(result.ast.requests[0]?.url, '/items');
});

test('accepts lexical token arrays and parser options', () => {
  const lexical = new Lexer({ sourceId: 'lexer.api' }).lex('GET /员工');
  const result = new Parser(lexical.tokens, {
    sourceId: 'override.api',
    maxNestingDepth: 8,
  }).parse();

  assert.equal(result.ast.sourceId, 'override.api');
  assert.equal(result.ast.requests[0]?.url, '/员工');
});

test('parse() compatibility entry point returns the canonical result', () => {
  const lexical = new Lexer({ sourceId: 'compat.api' }).lex('GET /compat');
  const result = parse(lexical, { sourceId: 'compat.api' });

  assert.equal(result.ast.type, AstNodeType.Document);
  assert.equal(result.ast.sourceId, 'compat.api');
  assert.equal(result.ast.requests[0]?.method, 'GET');
  assert.equal(result.ast.requests[0]?.url, '/compat');
  assert.equal(result.diagnostics.length, 0);
});

test('handles empty documents and EOF-only input', () => {
  const result = parseSource('');

  assert.equal(result.ast.requests.length, 0);
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.ast.range.start, result.ast.range.end);
});

test('recovers from JSON nesting beyond the configured maximum depth', () => {
  const lexical = new Lexer({ sourceId: 'nesting.api' }).lex(
    ['POST /deep', 'Content-Type: application/json', '{"a":{"b":{"c":1}}}'].join(
      '\n',
    ),
  );
  const parseWithLimit = () =>
    new Parser(lexical, { maxNestingDepth: 2 }).parse();

  assert.doesNotThrow(parseWithLimit);
  const result = parseWithLimit();

  const nestingDiagnostic = result.diagnostics.find(
    (diagnostic) => diagnostic.code === 'parser.maximum-nesting',
  );
  assert.ok(nestingDiagnostic, 'Expected a maximum-nesting diagnostic.');
  assert.equal(nestingDiagnostic?.severity, 'error');
  assert.match(nestingDiagnostic?.message ?? '', /limit of 2/);

  const request = result.ast.requests[0];
  assert.equal(request?.url, '/deep');
  assert.equal(request?.body?.type, AstNodeType.JsonBody);
  assert.doesNotThrow(() => JSON.stringify(result.ast));
});

test('processes large request files in one forward pass', () => {
  const requestCount = 3_000;
  const source = Array.from(
    { length: requestCount },
    (_, index) => `GET /items/${index}\nX-Index: ${index}\n###\n`,
  ).join('');
  const result = parseSource(source);

  assert.equal(result.ast.requests.length, requestCount);
  assert.equal(result.ast.requests.at(-1)?.url, `/items/${requestCount - 1}`);
  assert.equal(result.diagnostics.length, 0);
});

test('keeps headers and JSON body intact with interleaved expect lines', () => {
  const result = parseSource(
    [
      'POST https://example.test/users',
      'Content-Type: application/json',
      'expect status == 201',
      'Accept: application/json',
      'expect header Content-Type contains "json"',
      '{"name":"Ada","id":1}',
      'expect body.name == "Ada"',
      '###',
      'GET https://example.test/users/1',
    ].join('\n'),
  );

  assert.equal(result.diagnostics.length, 0);
  const request = result.ast.requests[0];
  assert.equal(request?.method, 'POST');
  assert.equal(request?.url, 'https://example.test/users');
  assert.deepEqual(
    request?.headers.map((header) => [header.name, header.value]),
    [
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ],
  );
  assert.equal(request?.body?.type, AstNodeType.JsonBody);
  assert.equal(
    request.headers.some((header) => header.name.toLowerCase() === 'expect'),
    false,
  );
  // Expect lines must not become body content.
  assert.doesNotMatch(
    JSON.stringify(request.body),
    /expect status/u,
  );
});

test('parses empty body, unicode headers, and very long URL lines', () => {
  const longUrl = `https://example.test/${'a'.repeat(4_000)}?q=1`;
  const result = parseSource(
    [
      `GET ${longUrl}`,
      'X-Trace: 東京🚀',
      '',
      '###',
      'POST /empty',
      'Content-Type: application/json',
      '',
      '{}',
    ].join('\n'),
  );
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.ast.requests[0]?.url, longUrl);
  assert.equal(result.ast.requests[0]?.headers[0]?.value, '東京🚀');
  assert.equal(result.ast.requests[1]?.body?.type, AstNodeType.JsonBody);

  // Hang detector for a large synthetic document (not a tight SLA).
  const started = performance.now();
  const large = Array.from({ length: 200 }, (_, index) =>
    [`GET /item-${index}`, 'Accept: application/json', '###'].join('\n'),
  ).join('\n');
  const largeResult = parseSource(large);
  assert.equal(largeResult.ast.requests.length, 200);
  assert.ok(
    performance.now() - started < 60_000,
    'large parser document hang detector',
  );
});
