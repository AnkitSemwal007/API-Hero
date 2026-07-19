import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMMAND_IDS } from '../../constants';
import { parseApiDocument } from '../../parser';
import {
  createRequestCodeLensDescriptors,
  safeRequestCodeLensDescriptors,
} from './request-code-lens';

test('derives Run Request and Run Tests lenses when expects are present', () => {
  const source = [
    'GET /one',
    'expect status == 200',
    '###',
    'POST /two',
  ].join('\n');
  const uri = 'file:///requests.api';
  const document = parseApiDocument(source, { sourceId: uri }).ast;

  const lenses = createRequestCodeLensDescriptors(document, uri, source);

  assert.equal(lenses.length, 3);
  assert.equal(lenses[0]?.command.id, COMMAND_IDS.runRequest);
  assert.equal(lenses[1]?.command.id, COMMAND_IDS.runRequestWithAssertions);
  assert.equal(lenses[1]?.command.title.includes('Run Tests'), true);
  assert.equal(lenses[2]?.command.id, COMMAND_IDS.runRequest);
});

test('derives one stable Run Request lens per canonical request', () => {
  const source = [
    '# setup',
    'GET /one',
    '###',
    '@description second',
    'POST /two',
    '{"ok":true}',
  ].join('\n');
  const uri = 'file:///requests.api';
  const document = parseApiDocument(source, { sourceId: uri }).ast;

  const lenses = createRequestCodeLensDescriptors(document, uri);

  assert.equal(lenses.length, 2);
  assert.deepEqual(
    lenses.map((lens) => lens.command.id),
    [COMMAND_IDS.runRequest, COMMAND_IDS.runRequest],
  );
  assert.deepEqual(lenses[0]?.command.argument, {
    uri,
    position: { line: 1, character: 0 },
  });
  assert.deepEqual(lenses[1]?.command.argument, {
    uri,
    position: { line: 4, character: 0 },
  });
  assert.equal(lenses[1]?.range.start.offset, source.indexOf('POST'));
});

test('does not create lenses when the canonical parser found no requests', () => {
  const document = parseApiDocument('# comments only').ast;
  assert.deepEqual(createRequestCodeLensDescriptors(document, 'test.api'), []);
});

test('guarded projection parses and projects when not cancelled', () => {
  const uri = 'file:///requests.api';
  let parseCalls = 0;
  const lenses = safeRequestCodeLensDescriptors(
    () => {
      parseCalls += 1;
      return parseApiDocument('GET /one', { sourceId: uri }).ast;
    },
    uri,
    () => false,
  );

  assert.equal(parseCalls, 1);
  assert.equal(lenses.length, 1);
  assert.equal(lenses[0]?.command.id, COMMAND_IDS.runRequest);
});

test('guarded projection honors an already-cancelled token before parsing', () => {
  let parseCalls = 0;
  const lenses = safeRequestCodeLensDescriptors(
    () => {
      parseCalls += 1;
      return parseApiDocument('GET /one').ast;
    },
    'test.api',
    () => true,
  );

  assert.deepEqual(lenses, []);
  assert.equal(parseCalls, 0);
});

test('guarded projection honors cancellation after parsing', () => {
  let projected = false;
  const parsed = parseApiDocument('GET /one').ast;
  const cancellation = [false, true];
  const lenses = safeRequestCodeLensDescriptors(
    () => {
      projected = true;
      return parsed;
    },
    'test.api',
    () => cancellation.shift() ?? true,
  );

  assert.equal(projected, true);
  assert.deepEqual(lenses, []);
});

test('guarded projection returns an empty result when parsing throws', () => {
  const lenses = safeRequestCodeLensDescriptors(
    () => {
      throw new Error('parse failure inside provider boundary');
    },
    'test.api',
    () => false,
  );

  assert.deepEqual(lenses, []);
});
