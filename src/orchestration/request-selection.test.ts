import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AstBuilder, parseApiDocument, range } from '../parser';
import {
  RequestSelectionError,
  selectRequestAtOffset,
} from './request-selection';

test('selects the sole request throughout its parser-defined block', () => {
  const source = [
    '@description selected request',
    '# request comment',
    'POST https://example.test/items',
    '@timeout 100',
    'Content-Type: application/json',
    '{"nested":{"value":true}}',
    '// trailing comment',
    '',
  ].join('\n');
  const document = parseApiDocument(source).ast;

  for (const marker of [
    '@description',
    '# request',
    'POST',
    '@timeout',
    'Content-Type',
    '"nested"',
    '// trailing',
  ]) {
    assert.equal(
      selectRequestAtOffset(document, source.indexOf(marker)).request.method,
      'POST',
    );
  }
  assert.equal(
    selectRequestAtOffset(document, source.length).request.method,
    'POST',
  );
});

test('uses separators to select exactly one of multiple requests', () => {
  const source = [
    'GET https://example.test/one',
    '# still first',
    '###',
    '// second block',
    'POST https://example.test/two',
  ].join('\n');
  const document = parseApiDocument(source).ast;

  assert.equal(
    selectRequestAtOffset(document, source.indexOf('# still')).index,
    0,
  );
  assert.equal(
    selectRequestAtOffset(document, source.indexOf('// second')).index,
    1,
  );
  assert.throws(
    () => selectRequestAtOffset(document, source.indexOf('###')),
    (error) =>
      error instanceof RequestSelectionError && error.code === 'NO_REQUEST',
  );
});

test('rejects empty, ambiguous, and trailing-empty request blocks', () => {
  const empty = parseApiDocument('# no requests').ast;
  assert.throws(
    () => selectRequestAtOffset(empty, 0),
    (error) =>
      error instanceof RequestSelectionError && error.code === 'NO_REQUEST',
  );

  const ambiguousSource = 'GET /one\nPOST /two';
  const ambiguous = parseApiDocument(ambiguousSource).ast;
  assert.throws(
    () => selectRequestAtOffset(ambiguous, 0),
    (error) =>
      error instanceof RequestSelectionError &&
      error.code === 'AMBIGUOUS_REQUEST',
  );

  const trailingSource = 'GET /one\n###\n';
  const trailing = parseApiDocument(trailingSource).ast;
  assert.throws(
    () => selectRequestAtOffset(trailing, trailingSource.length),
    (error) =>
      error instanceof RequestSelectionError && error.code === 'NO_REQUEST',
  );
});

test('rejects invalid positions and malformed canonical metadata', () => {
  const parsed = parseApiDocument('GET /one').ast;
  assert.throws(
    () => selectRequestAtOffset(parsed, -1),
    (error) =>
      error instanceof RequestSelectionError &&
      error.code === 'INVALID_POSITION',
  );

  const builder = new AstBuilder();
  const request = builder.request({
    method: 'GET',
    url: '/one',
    metadata: { requestBlock: 0 },
    range: range(0, 8),
  });
  const malformed = builder.document({
    requests: [request],
    metadata: {
      requestBoundaries: [
        { start: range(5, 7).start, end: range(3, 4).end },
      ],
    },
    range: range(0, 8),
  });
  assert.throws(
    () => selectRequestAtOffset(malformed, 1),
    (error) =>
      error instanceof RequestSelectionError &&
      error.code === 'INVALID_RANGES',
  );
});
