import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AstBuilder,
  type ApiHttpMethod,
  parseApiDocument,
  range,
  VALIDATION_DIAGNOSTIC_CODES,
  validateApiDocument,
  validateApiRequest,
  type ValidationRule,
} from './index';

test('accepts a valid canonical document', () => {
  const parsed = parseApiDocument(
    [
      '@connection local',
      'GET /users/{{userId}}',
      'Accept: application/json',
      '@timeout 1000',
      '###',
      'POST /users',
      'Content-Type: application/json',
      '{"name": "{{name}}"}',
    ].join('\n'),
  );

  const result = validateApiDocument(parsed.ast);

  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test('validates request declarations, block structure, and ordering', () => {
  const parsed = parseApiDocument(['GET', 'POST /two'].join('\n'));
  const parsedValidation = validateApiDocument(parsed.ast);
  const parsedCodes = parsedValidation.diagnostics.map(
    (diagnostic) => diagnostic.code,
  );

  assert.ok(parsedCodes.includes(VALIDATION_DIAGNOSTIC_CODES.missingUrl));
  assert.ok(
    parsedCodes.includes(
      VALIDATION_DIAGNOSTIC_CODES.multipleRequestDeclarations,
    ),
  );
  assert.ok(
    parsedValidation.diagnostics.find(
      (diagnostic) =>
        diagnostic.code ===
        VALIDATION_DIAGNOSTIC_CODES.multipleRequestDeclarations,
    )?.relatedInformation?.length,
  );
  assert.ok(
    validateApiDocument(parseApiDocument('/without-method').ast).diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.missingMethod,
    ),
  );

  const builder = new AstBuilder('invalid.api');
  const body = builder.rawBody({ content: 'body', range: range(5, 9) });
  const lateHeader = builder.header('Accept', 'text/plain', {
    range: range(10, 28),
  });
  const malformedRequest = builder.request({
    method: '' as ApiHttpMethod,
    url: '/items',
    headers: [lateHeader],
    body,
    range: range(0, 28),
  });
  const malformedDocument = builder.document({
    requests: [malformedRequest],
    range: range(0, 28),
  });
  const malformedCodes = validateApiDocument(malformedDocument).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );

  assert.ok(malformedCodes.includes(VALIDATION_DIAGNOSTIC_CODES.missingMethod));
  assert.ok(
    malformedCodes.includes(VALIDATION_DIAGNOSTIC_CODES.malformedOrdering),
  );
});

test('validates duplicate and malformed headers case-insensitively', () => {
  const parsed = parseApiDocument(
    ['GET /items', 'Accept: text/plain', 'accept: application/json'].join('\n'),
  );
  const duplicate = validateApiDocument(parsed.ast).diagnostics.find(
    (diagnostic) =>
      diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.duplicateHeader,
  );

  assert.ok(duplicate);
  assert.equal(duplicate.severity, 'warning');
  assert.equal(duplicate.relatedInformation?.length, 1);

  const builder = new AstBuilder();
  const malformed = builder.header('Bad Header', 'value', {
    range: range(5, 15),
  });
  const request = builder.request({
    method: 'GET',
    url: '/',
    headers: [malformed],
    range: range(0, 15),
  });
  const document = builder.document({ requests: [request], range: range(0, 15) });

  assert.ok(
    validateApiDocument(document).diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.malformedHeader,
    ),
  );
});

test('validates directive names, values, and singleton duplicates', () => {
  const parsed = parseApiDocument(
    [
      '@name First',
      'GET /items',
      '@name Second',
      '@timeout later',
      '@description',
      '@future enabled',
    ].join('\n'),
  );
  const diagnostics = validateApiDocument(parsed.ast).diagnostics;
  const codes = diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes(VALIDATION_DIAGNOSTIC_CODES.duplicateDirective));
  assert.ok(codes.includes(VALIDATION_DIAGNOSTIC_CODES.invalidDirective));
  assert.ok(codes.includes(VALIDATION_DIAGNOSTIC_CODES.unknownDirective));
  assert.equal(
    diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.invalidDirective,
    ).length,
    2,
  );
});

test('validates malformed variable nodes without resolving references', () => {
  const parsed = parseApiDocument('GET /items/{{bad variable}}');
  const parsedValidation = validateApiDocument(parsed.ast);

  assert.equal(
    parsedValidation.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.malformedVariable,
    ),
    false,
    'The lexer diagnostic already owns this source occurrence.',
  );

  const builder = new AstBuilder();
  const variable = builder.variable('{{bad variable}}', 'bad variable', {
    range: range(4, 20),
  });
  const request = builder.request({
    method: 'GET',
    url: '/{{bad variable}}',
    variables: [variable],
    range: range(0, 20),
  });
  const document = builder.document({ requests: [request], range: range(0, 20) });

  assert.ok(
    validateApiDocument(document).diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.malformedVariable,
    ),
  );
});

test('allows future domains to contribute rules without changing the engine', () => {
  const parsed = parseApiDocument('GET /health');
  const customRule: ValidationRule = {
    id: 'custom-health',
    validate(document, context) {
      context.report({
        code: 'custom.health',
        message: 'Custom rule executed.',
        severity: 'information',
        range: document.range,
      });
    },
  };

  assert.deepEqual(
    validateApiDocument(parsed.ast, [customRule]).diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
    ['custom.health'],
  );
});

test('scoped validation excludes unrelated request errors but keeps document semantics', () => {
  const parsed = parseApiDocument([
    '@tag global',
    'GET /valid',
    '###',
    'POST',
  ].join('\n'));
  const selected = parsed.ast.requests[0]!;

  assert.equal(validateApiDocument(parsed.ast).valid, false);
  assert.equal(validateApiRequest(parsed.ast, selected).valid, true);

  const invalidGlobal = parseApiDocument([
    '@timeout later',
    'GET /valid',
    '###',
    'POST /other',
  ].join('\n')).ast;
  const scoped = validateApiRequest(invalidGlobal, invalidGlobal.requests[0]!);
  assert.equal(scoped.valid, false);
  assert.ok(
    scoped.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.invalidDirective,
    ),
  );
});
