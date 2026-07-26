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

test('validates extract directives without treating them as unknown', () => {
  const valid = validateApiDocument(
    parseApiDocument(
      [
        '@extract accessToken from body.access_token',
        '@sensitive-extract refreshToken from body.refresh_token scope=environment',
        'GET /login',
      ].join('\n'),
    ).ast,
  );
  assert.equal(valid.valid, true);
  assert.equal(
    valid.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.unknownDirective,
    ),
    false,
  );

  const malformed = validateApiDocument(
    parseApiDocument('@extract broken-value\nGET /\n').ast,
  );
  assert.ok(
    malformed.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        VALIDATION_DIAGNOSTIC_CODES.extractionInvalidDirective,
    ),
  );

  const forbidden = validateApiDocument(
    parseApiDocument('@extract x from body.y scope=global\nGET /\n').ast,
  );
  assert.ok(
    forbidden.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        VALIDATION_DIAGNOSTIC_CODES.extractionForbiddenScope,
    ),
  );

  const invalidScope = validateApiDocument(
    parseApiDocument('@extract x from body.y scope=planet\nGET /\n').ast,
  );
  assert.ok(
    invalidScope.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.extractionInvalidScope,
    ),
  );

  const invalidSource = validateApiDocument(
    parseApiDocument('@extract x from header\nGET /\n').ast,
  );
  assert.ok(
    invalidSource.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.extractionInvalidSource,
    ),
  );

  const duplicate = validateApiDocument(
    parseApiDocument(
      [
        '@extract token from body.a',
        '@extract token from body.b',
        'GET /',
      ].join('\n'),
    ).ast,
  );
  const duplicateDiagnostic = duplicate.diagnostics.find(
    (diagnostic) =>
      diagnostic.code ===
      VALIDATION_DIAGNOSTIC_CODES.extractionDuplicateVariable,
  );
  assert.ok(duplicateDiagnostic);
  assert.equal(duplicateDiagnostic.severity, 'warning');
  assert.equal(duplicate.valid, true);
});

test('validates @depends-on directives', () => {
  const valid = validateApiDocument(
    parseApiDocument(
      [
        '@name Login',
        'GET /login',
        '###',
        '@name Products',
        '@depends-on Login',
        'GET /products',
      ].join('\n'),
    ).ast,
  );
  assert.equal(valid.valid, true);
  assert.equal(
    valid.diagnostics.some(
      (diagnostic) => diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.unknownDirective,
    ),
    false,
  );

  const selfDepends = validateApiDocument(
    parseApiDocument(
      ['@name Login', '@depends-on Login', 'GET /login'].join('\n'),
    ).ast,
  );
  assert.ok(
    selfDepends.diagnostics.some(
      (diagnostic) => diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.dependsOnSelfDepends,
    ),
  );
  assert.equal(selfDepends.valid, false);

  const unknownTarget = validateApiDocument(
    parseApiDocument(
      ['@name Products', '@depends-on Login', 'GET /products'].join('\n'),
    ).ast,
  );
  const unknownDiagnostic = unknownTarget.diagnostics.find(
    (diagnostic) => diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.dependsOnUnknownTarget,
  );
  assert.ok(unknownDiagnostic);
  assert.equal(unknownDiagnostic.severity, 'warning');
  assert.equal(unknownTarget.valid, true);

  const ambiguousTarget = validateApiDocument(
    parseApiDocument(
      [
        '@name Login',
        'GET /login-a',
        '###',
        '@name Login',
        'GET /login-b',
        '###',
        '@name Products',
        '@depends-on Login',
        'GET /products',
      ].join('\n'),
    ).ast,
  );
  assert.ok(
    ambiguousTarget.diagnostics.some(
      (diagnostic) => diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.dependsOnAmbiguousTarget,
    ),
  );
  assert.equal(ambiguousTarget.valid, false);

  const duplicateName = validateApiDocument(
    parseApiDocument(
      [
        '@name Login',
        'GET /login',
        '###',
        '@name Products',
        '@depends-on Login, Login',
        'GET /products',
      ].join('\n'),
    ).ast,
  );
  const duplicateDiagnostic = duplicateName.diagnostics.find(
    (diagnostic) => diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.dependsOnDuplicateName,
  );
  assert.ok(duplicateDiagnostic);
  assert.equal(duplicateDiagnostic.severity, 'warning');
  assert.equal(duplicateName.valid, true);

  const invalid = validateApiDocument(
    parseApiDocument(
      ['@depends-on Login, , Products', 'GET /products'].join('\n'),
    ).ast,
  );
  assert.ok(
    invalid.diagnostics.some(
      (diagnostic) => diagnostic.code === VALIDATION_DIAGNOSTIC_CODES.dependsOnInvalid,
    ),
  );
  assert.equal(invalid.valid, false);
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
