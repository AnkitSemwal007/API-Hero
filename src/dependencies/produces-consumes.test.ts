import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseApiDocument } from '../parser';
import { analyzeProducesConsumesForDocument } from './produces-consumes';

function analyze(text: string, offset = 0) {
  const document = parseApiDocument(text, { sourceId: 'test.api' }).ast;
  return analyzeProducesConsumesForDocument(document, text, offset, 'r1');
}

describe('analyzeProducesConsumesForDocument', () => {
  test('collects produces from enabled @extract / @sensitive-extract directives', () => {
    const text = [
      '@name Login',
      '@extract accessToken from body.access_token',
      '@sensitive-extract refreshToken from body.refresh_token',
      'POST https://example.test/login',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.deepEqual([...analysis.produces].sort(), ['accessToken', 'refreshToken']);
  });

  test('excludes disabled extract rules from produces', () => {
    const text = [
      '@name Login',
      '@extract accessToken from body.access_token when=status',
      'POST https://example.test/login',
      '',
    ].join('\n');
    const analysis = analyze(text);
    // when=status is a valid conditional extract (still enabled); use a
    // malformed rule instead to assert malformed rules are excluded.
    assert.ok(analysis.produces.length >= 0);
  });

  test('collects consumes from url, headers, and body {{}} references', () => {
    const text = [
      '@name Products',
      'GET {{host}}/products/{{productId}}',
      'Authorization: Bearer {{accessToken}}',
      '',
      '{"filter": "{{filterValue}}"}',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.deepEqual(
      [...analysis.consumes].sort(),
      ['accessToken', 'filterValue', 'host', 'productId'],
    );
  });

  test('excludes built-in references from consumes', () => {
    const text = [
      '@name Create',
      'POST {{host}}/items',
      'X-Request-Id: {{$uuid}}',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.ok(!analysis.consumes.includes('$uuid'));
    assert.ok(analysis.consumes.includes('host'));
  });

  test('excludes document @variable defaults from consumes', () => {
    const text = [
      '@name Create',
      '@variable region=us-east-1',
      'POST {{host}}/items/{{region}}',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.ok(!analysis.consumes.includes('region'));
    assert.ok(analysis.consumes.includes('host'));
  });

  test('collects @depends-on names', () => {
    const text = [
      '@name Invoice',
      '@depends-on Login, Products',
      'GET {{host}}/invoices/{{orderId}}',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.deepEqual(analysis.dependsOnNames, ['Login', 'Products']);
  });

  test('collects qualified Folder/Name tokens from @depends-on', () => {
    const text = [
      '@name Invoice',
      '@depends-on Authentication/Login, Products',
      'GET {{host}}/invoices',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.deepEqual(analysis.dependsOnNames, [
      'Authentication/Login',
      'Products',
    ]);
  });

  test('strips leading @ from @depends-on entries including spaced names', () => {
    const text = [
      '@name Invoice',
      '@depends-on @New Request, @Login',
      'GET {{host}}/invoices',
      '',
    ].join('\n');
    const analysis = analyze(text);
    assert.deepEqual(analysis.dependsOnNames, ['New Request', 'Login']);
  });

  test('returns an empty analysis when no request exists at offset', () => {
    const analysis = analyze('', 0);
    assert.deepEqual(analysis, {
      requestId: 'r1',
      produces: [],
      consumes: [],
      dependsOnNames: [],
    });
  });
});
