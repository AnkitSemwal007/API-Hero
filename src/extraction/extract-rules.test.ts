import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseApiDocument } from '../parser';
import {
  extractExtractionRulesForDocument,
  extractExtractionRulesForOffset,
} from './extract-rules';

describe('extractExtractionRulesForDocument', () => {
  test('associates extract rules with each request in a multi-request file', () => {
    const source = [
      '@name Login',
      '@extract accessToken from body.access_token',
      '@sensitive-extract refreshToken from body.refresh_token scope=environment',
      '',
      'POST https://example.test/login',
      '',
      '###',
      '',
      '@name Products',
      '@extract productId from body.data[0].id optional',
      '',
      'GET https://example.test/products',
      '@extract requestId from header X-Request-Id when=status:2xx',
      '',
    ].join('\n');

    const document = parseApiDocument(source).ast;
    const extracted = extractExtractionRulesForDocument(document, source);

    assert.equal(extracted.length, 2);

    assert.equal(extracted[0]!.requestIndex, 0);
    assert.equal(extracted[0]!.malformed.length, 0);
    assert.deepEqual(
      extracted[0]!.rules.map((rule) => rule.variableName),
      ['accessToken', 'refreshToken'],
    );
    assert.equal(extracted[0]!.rules[1]!.sensitive, true);
    assert.equal(extracted[0]!.rules[1]!.targetScope, 'environment');

    assert.equal(extracted[1]!.requestIndex, 1);
    assert.equal(extracted[1]!.malformed.length, 0);
    assert.deepEqual(
      extracted[1]!.rules.map((rule) => rule.variableName),
      ['productId', 'requestId'],
    );
    assert.equal(extracted[1]!.rules[0]!.required, false);
    assert.deepEqual(extracted[1]!.rules[1]!.source, {
      kind: 'header',
      name: 'X-Request-Id',
    });
  });

  test('lists malformed directives without throwing', () => {
    const source = [
      '@extract not-a-valid-value',
      'GET https://example.test',
      '',
    ].join('\n');
    const document = parseApiDocument(source).ast;
    const extracted = extractExtractionRulesForDocument(document, source);
    assert.equal(extracted[0]!.rules.length, 0);
    assert.ok(extracted[0]!.malformed.length > 0);
  });
});

describe('extractExtractionRulesForOffset', () => {
  test('selects rules for the owning request only', () => {
    const source = [
      '@extract first from body.a',
      'GET https://a.test',
      '###',
      '@extract second from body.b',
      'GET https://b.test',
      '',
    ].join('\n');
    const document = parseApiDocument(source).ast;

    const first = extractExtractionRulesForOffset(document, source, 0);
    assert.ok(first);
    assert.deepEqual(
      first.rules.map((rule) => rule.variableName),
      ['first'],
    );

    const secondOffset = source.indexOf('GET https://b.test');
    const second = extractExtractionRulesForOffset(
      document,
      source,
      secondOffset,
    );
    assert.ok(second);
    assert.deepEqual(
      second.rules.map((rule) => rule.variableName),
      ['second'],
    );
  });
});
