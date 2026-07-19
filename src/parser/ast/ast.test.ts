import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AstBuilder,
  AstNodeType,
  astToJsonValue,
  findAstNodes,
  getAstAncestors,
  range,
  serializeAst,
  walkAst,
  type AstNode,
  type RequestOptions,
} from '.';

test('builds a strongly typed document with exact ranges and children', () => {
  const builder = new AstBuilder('requests.api');
  const variable = builder.variable('{{userId}}', 'userId', {
    range: range(10, 20),
  });
  const header = builder.header('Accept', 'application/json', {
    range: range(21, 45),
  });
  const directive = builder.directive({
    name: '@name',
    value: 'Get user',
    range: range(0, 9),
  });
  const comment = builder.comment('// lookup', 'lookup', '//', {
    range: range(46, 55),
  });
  const request = builder.request({
    method: 'GET',
    url: '/users/{{userId}}',
    headers: [header],
    directives: [directive],
    variables: [variable],
    comments: [comment],
    range: range(0, 75),
  });
  const document = builder.document({
    requests: [request],
    range: range(0, 75),
  });

  assert.equal(document.type, AstNodeType.Document);
  assert.equal(request.method, 'GET');
  assert.equal(header.location.sourceId, 'requests.api');
  assert.deepEqual(variable.range, {
    start: { offset: 10, line: 0, column: 10 },
    end: { offset: 20, line: 0, column: 20 },
  });
  assert.deepEqual(
    request.children.map((node) => node.type),
    [
      AstNodeType.Directive,
      AstNodeType.Comment,
      AstNodeType.Header,
      AstNodeType.Variable,
    ],
  );
  assert.equal(request.parent, document);
  assert.equal(variable.parent, request);
  assert.deepEqual(getAstAncestors(variable), [request, document]);
});

test('represents known and forward-compatible unknown directives', () => {
  const builder = new AstBuilder();
  const known = builder.directive({
    name: '@timeout',
    knownName: 'timeout',
    value: '5000',
    range: range(0, 13),
  });
  const unknown = builder.directive({
    name: '@retry-policy',
    value: 'linear',
    range: range(14, 34),
  });

  assert.equal(known.knownName, 'timeout');
  assert.equal(known.name, '@timeout');
  assert.equal(unknown.name, '@retry-policy');
  assert.equal(unknown.knownName, undefined);
});

test('supports every body and literal variant', () => {
  const builder = new AstBuilder();
  const key = builder.stringLiteral('enabled', '"enabled"', {
    range: range(1, 10),
  });
  const boolean = builder.booleanLiteral(true, 'true', {
    range: range(11, 15),
  });
  const property = builder.objectProperty(key, boolean, {
    range: range(1, 15),
  });
  const number = builder.numberLiteral(2, '2', { range: range(16, 17) });
  const string = builder.stringLiteral('ok', '"ok"', {
    range: range(18, 22),
  });
  const nil = builder.nullLiteral('null', { range: range(23, 27) });
  const array = builder.arrayLiteral([number, string, nil], '[2,"ok",null]', {
    range: range(16, 29),
  });
  const object = builder.objectLiteral([property], '{"enabled":true}', {
    range: range(0, 16),
  });
  const json = builder.jsonBody(object, { range: range(0, 16) });
  const variable = builder.variable('{{value}}', 'value', {
    range: range(4, 13),
  });
  const raw = builder.rawBody({
    content: 'raw {{value}}',
    variables: [variable],
    range: range(0, 13),
  });
  const text = builder.textBody({
    content: 'plain',
    range: range(0, 5),
  });
  const multipart = builder.multipartBody('--boundary', {
    range: range(0, 10),
  });
  const binary = builder.binaryBody('./payload.bin', {
    range: range(0, 13),
  });

  assert.equal(json.value, object);
  assert.equal(property.key.value, 'enabled');
  assert.equal(boolean.value, true);
  assert.deepEqual(array.elements.map((element) => element.type), [
    AstNodeType.NumberLiteral,
    AstNodeType.StringLiteral,
    AstNodeType.NullLiteral,
  ]);
  assert.deepEqual(
    [json, raw, text, multipart, binary].map((body) => body.type),
    [
      AstNodeType.JsonBody,
      AstNodeType.RawBody,
      AstNodeType.TextBody,
      AstNodeType.MultipartBody,
      AstNodeType.BinaryBody,
    ],
  );
  assert.equal(variable.parent, raw);
});

test('attaches diagnostics without performing semantic validation', () => {
  const builder = new AstBuilder('invalid.api');
  const diagnostic = builder.diagnostic({
    code: 'parser.expected-value',
    message: 'Expected a value.',
    severity: 'error',
    range: range(8, 8),
    source: 'api-parser',
  });
  const directive = builder.directive({
    name: 'future',
    diagnostics: [diagnostic],
    range: range(0, 8),
  });

  assert.equal(directive.diagnostics[0]?.code, 'parser.expected-value');
  assert.equal(
    directive.diagnostics[0]?.location.sourceId,
    'invalid.api',
  );
});

test('walks depth-first with typed visitor callbacks and search helpers', () => {
  const builder = new AstBuilder();
  const header = builder.header('Accept', '*/*', { range: range(7, 18) });
  const request = builder.request({
    method: 'GET',
    url: '/',
    headers: [header],
    range: range(0, 18),
  });
  const document = builder.document({
    requests: [request],
    range: range(0, 18),
  });
  const events: string[] = [];

  walkAst(document, {
    enterNode(node) {
      events.push(`enter:${node.type}`);
    },
    visitRequest(node) {
      events.push(`request:${node.method}`);
    },
    leaveNode(node) {
      events.push(`leave:${node.type}`);
    },
  });

  assert.deepEqual(events, [
    'enter:Document',
    'enter:Request',
    'request:GET',
    'enter:Header',
    'leave:Header',
    'leave:Request',
    'leave:Document',
  ]);
  const headers = findAstNodes(
    document,
    (node): node is Extract<AstNode, { type: AstNodeType.Header }> =>
      node.type === AstNodeType.Header,
  );
  assert.deepEqual(headers, [header]);
});

test('rejects assigning a node to conflicting parents', () => {
  const builder = new AstBuilder();
  const header = builder.header('Accept', '*/*', { range: range(7, 18) });
  builder.request({
    method: 'GET',
    url: '/first',
    headers: [header],
    range: range(0, 18),
  });

  assert.throws(
    () =>
      builder.request({
        method: 'GET',
        url: '/second',
        headers: [header],
        range: range(19, 38),
      }),
    /cannot belong to more than one parent/,
  );
});

test('serializes without parent cycles and produces detached JSON values', () => {
  const builder = new AstBuilder('serialize.api');
  const request = builder.request({
    method: 'POST',
    url: '/items',
    range: range(0, 11),
  });
  const document = builder.document({
    requests: [request],
    range: range(0, 11),
  });

  const serialized = serializeAst(document);
  const prettySerialized = serializeAst(document, 2);
  const value = astToJsonValue(document);

  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.equal(serialized.includes('"parent"'), false);
  assert.equal(prettySerialized, JSON.stringify(document, undefined, 2));
  assert.equal(serializeAst(document, 0), serialized);
  assert.equal(
    (value as { readonly sourceId?: string }).sourceId,
    'serialize.api',
  );
});

test('freezes nodes, collections, coordinates, metadata, and diagnostics', () => {
  const builder = new AstBuilder();
  const diagnostic = builder.diagnostic({
    code: 'test',
    message: 'test',
    severity: 'hint',
    range: range(0, 1),
  });
  const request = builder.request({
    method: 'GET',
    url: '/',
    metadata: { generated: true },
    diagnostics: [diagnostic],
    range: range(0, 5),
  });

  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.children), true);
  assert.equal(Object.isFrozen(request.headers), true);
  assert.equal(Object.isFrozen(request.range), true);
  assert.equal(Object.isFrozen(request.range.start), true);
  assert.equal(Object.isFrozen(request.metadata), true);
  assert.equal(Object.isFrozen(request.diagnostics), true);
  assert.equal(Reflect.set(request, 'url', '/changed'), false);
});

test('builder option types retain required request fields', () => {
  const completeOptions: RequestOptions = {
    method: 'GET',
    url: '/',
    range: range(0, 1),
  };
  assert.equal(completeOptions.method, 'GET');

  // @ts-expect-error RequestOptions requires a method.
  const missingMethod: RequestOptions = { url: '/', range: range(0, 1) };
  assert.equal(missingMethod.url, '/');
});
