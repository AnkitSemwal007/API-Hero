/**
 * Round-trip and projection tests for document ↔ RequestSourceDocument.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseSourceToRequestDocument,
  serializeRequestDocument,
} from './index';

describe('documentToRequestSource / parseSourceToRequestDocument', () => {
  test('projects a single-request document with headers, query, auth, timeout', () => {
    const source = [
      '# hand-written',
      '@name Get users',
      '@description Lists users',
      '@auth bearer-prod',
      '@timeout 2500',
      '@variable base=https://api.example.com',
      '',
      'GET {{base}}/users?q=a+b&page=1',
      'Accept: application/json',
      '# X-Debug: 1',
      'Content-Type: application/json',
      '',
      '{"ok":true}',
      '',
      'expect status == 200',
      'expect header Content-Type contains "json"',
      '',
    ].join('\n');

    const result = parseSourceToRequestDocument(source, 'users.api');
    assert.equal(result.kind, 'single');
    if (result.kind !== 'single') {
      return;
    }

    const model = result.document;
    assert.equal(model.name, 'Get users');
    assert.equal(model.description, 'Lists users');
    assert.equal(model.authProfileId, 'bearer-prod');
    assert.equal(model.timeoutMs, 2500);
    assert.equal(model.method, 'GET');
    assert.equal(model.url, '{{base}}/users');
    assert.deepEqual(model.queryParams, [
      { name: 'q', value: 'a b', enabled: true },
      { name: 'page', value: '1', enabled: true },
    ]);
    assert.deepEqual(model.variables, [
      { name: 'base', value: 'https://api.example.com' },
    ]);
    assert.equal(model.comments?.[0], 'hand-written');
    assert.equal(model.headers?.[0]?.name, 'Accept');
    assert.equal(model.headers?.[1]?.enabled, false);
    assert.equal(model.headers?.[1]?.name, 'X-Debug');
    assert.equal(model.body?.type, 'json');
    assert.ok(model.expectLines?.some((line) => /status == 200/u.test(line)));
  });

  test('preserves @sensitive-variable as sensitive', () => {
    const source = [
      '@name Secrets',
      '@variable public=ok',
      '@sensitive-variable token=sekrit',
      '',
      'GET https://example.test',
      '',
    ].join('\n');
    const result = parseSourceToRequestDocument(source);
    assert.equal(result.kind, 'single');
    if (result.kind !== 'single') {
      return;
    }
    assert.deepEqual(result.document.variables, [
      { name: 'public', value: 'ok' },
      { name: 'token', value: 'sekrit', sensitive: true },
    ]);

    const roundTrip = serializeRequestDocument(result.document);
    assert.match(roundTrip, /@variable public=ok\n/u);
    assert.match(roundTrip, /@sensitive-variable token=sekrit\n/u);
  });

  test('reports multi-request files without projecting a form model', () => {
    const source = ['GET https://a.test', '###', 'POST https://b.test'].join(
      '\n',
    );
    const result = parseSourceToRequestDocument(source);
    assert.deepEqual(result, { kind: 'multi', requestCount: 2 });
  });

  test('reports empty documents', () => {
    const result = parseSourceToRequestDocument('# only comments\n');
    assert.equal(result.kind, 'empty');
  });

  test('round-trips serialize → parse for a rich single request', () => {
    const original = {
      name: 'Create',
      method: 'POST' as const,
      url: 'https://api.example.com/items',
      description: 'Creates an item',
      authProfileId: 'token',
      timeoutMs: 1000,
      variables: [{ name: 'role', value: 'admin' }],
      headers: [
        { name: 'Accept', value: 'application/json', enabled: true },
        { name: 'X-Trace', value: '1', enabled: false },
      ],
      queryParams: [
        { name: 'dryRun', value: 'true', enabled: true },
        { name: 'skip', value: 'x', enabled: false },
      ],
      body: { type: 'json' as const, text: '{\n  "name": "Ada"\n}' },
      expectLines: [
        'expect status == 201',
        'expect body.id exists',
        'expect responseTime < 2000',
        'expect body contains "Ada"',
      ],
      comments: ['from editor'],
    };

    const source = serializeRequestDocument(original);
    const parsed = parseSourceToRequestDocument(source);
    assert.equal(parsed.kind, 'single');
    if (parsed.kind !== 'single') {
      return;
    }

    assert.equal(parsed.document.name, original.name);
    assert.equal(parsed.document.method, original.method);
    assert.equal(parsed.document.url, original.url);
    assert.equal(parsed.document.authProfileId, original.authProfileId);
    assert.equal(parsed.document.timeoutMs, original.timeoutMs);
    assert.equal(parsed.document.description, original.description);
    assert.deepEqual(parsed.document.variables, original.variables);
    assert.equal(
      parsed.document.queryParams?.find((param) => param.name === 'dryRun')
        ?.value,
      'true',
    );
    assert.ok(
      parsed.document.headers?.some(
        (header) => header.name === 'X-Trace' && header.enabled === false,
      ),
    );
    assert.equal(parsed.document.body?.type, 'json');
    assert.ok(
      (parsed.document.expectLines ?? []).some((line) =>
        /status == 201/u.test(line),
      ),
    );

    const second = parseSourceToRequestDocument(
      serializeRequestDocument(parsed.document),
    );
    assert.equal(second.kind, 'single');
  });

  test('maps form bodies from urlencoded content-type', () => {
    const source = serializeRequestDocument({
      name: 'Form',
      method: 'POST',
      url: 'https://example.test/form',
      body: {
        type: 'form',
        fields: [
          { name: 'user', value: 'ada' },
          { name: 'role', value: 'admin' },
        ],
      },
    });
    const parsed = parseSourceToRequestDocument(source);
    assert.equal(parsed.kind, 'single');
    if (parsed.kind !== 'single') {
      return;
    }
    assert.equal(parsed.document.body?.type, 'form');
    if (parsed.document.body?.type === 'form') {
      assert.deepEqual(parsed.document.body.fields, [
        { name: 'user', value: 'ada' },
        { name: 'role', value: 'admin' },
      ]);
    }
  });
});
