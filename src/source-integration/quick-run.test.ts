/**
 * Unit tests for Quick Run fetch detection and catalog URL matching (no VS Code).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { serializeRequestDocument } from '../request-source';
import type { Range } from '../parser/types';
import {
  buildSourceIntegrationCatalog,
  detectFetchAtCursor,
  matchCatalogByMethodAndUrl,
  normalizeConcreteHttpUrl,
  requestDocumentFromDetectedFetch,
  type CatalogRequest,
} from './index';

function range(line: number): Range {
  return {
    start: { line, column: 0, offset: line * 10 },
    end: { line, column: 3, offset: line * 10 + 3 },
  };
}

function request(
  overrides: Partial<CatalogRequest> & Pick<CatalogRequest, 'id' | 'name'>,
): CatalogRequest {
  return {
    filePath: `file:///ws/Collections/Demo/${overrides.name.replace(/\s+/gu, '-')}.api`,
    relativePath: `Collections/Demo/${overrides.name.replace(/\s+/gu, '-')}.api`,
    workspaceRootPath: 'file:///ws',
    requestIndex: 0,
    method: 'GET',
    url: 'https://example.com/users',
    protocol: 'http',
    range: range(2),
    ...overrides,
  };
}

test('GET fetch string literal defaults to GET', () => {
  const source = 'await fetch("https://example.com/users");';
  const detected = detectFetchAtCursor(source, 0);
  assert.equal(detected?.method, 'GET');
  assert.equal(detected?.url, 'https://example.com/users');
  assert.equal(detected?.name, 'users');
  assert.equal(detected?.body, undefined);
  assert.deepEqual(detected?.headers, []);
});

test('GET fetch accepts single-quoted URL', () => {
  const source = "fetch('https://example.com/users');";
  const detected = detectFetchAtCursor(source, source.indexOf('fetch'));
  assert.equal(detected?.url, 'https://example.com/users');
  assert.equal(detected?.method, 'GET');
});

test('POST with method, JSON.stringify object literal body, and literal headers', () => {
  const source = `
fetch("https://example.com/users", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ name: "Ada" })
});
`;
  const detected = detectFetchAtCursor(source, source.indexOf('method'));
  assert.equal(detected?.method, 'POST');
  assert.equal(detected?.url, 'https://example.com/users');
  assert.deepEqual(detected?.headers, [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Accept', value: 'application/json' },
  ]);
  assert.equal(detected?.body?.type, 'json');
  if (detected?.body?.type === 'json') {
    assert.equal(JSON.parse(detected.body.text).name, 'Ada');
  }
});

test('JSON.stringify(identifier) omits body and keeps POST', () => {
  const source = `
fetch("https://example.com/users", {
  method: "POST",
  body: JSON.stringify(data)
});
`;
  const detected = detectFetchAtCursor(source, source.indexOf('POST'));
  assert.equal(detected?.method, 'POST');
  assert.equal(detected?.url, 'https://example.com/users');
  assert.equal(detected?.body, undefined);
});

test('identifier URL is not detected', () => {
  const source = 'fetch(url);';
  assert.equal(detectFetchAtCursor(source, 0), undefined);
});

test('template string with interpolation is not detected', () => {
  const source = 'fetch(`https://example.com/${id}`);';
  assert.equal(detectFetchAtCursor(source, 0), undefined);
});

test('cursor picks the correct fetch among two URLs', () => {
  const source = [
    'fetch("https://example.com/one");',
    'fetch("https://example.com/two");',
  ].join('\n');
  const first = detectFetchAtCursor(source, source.indexOf('one'));
  const second = detectFetchAtCursor(source, source.indexOf('two'));
  assert.equal(first?.url, 'https://example.com/one');
  assert.equal(second?.url, 'https://example.com/two');
});

test('comment fetch is ignored', () => {
  const source = [
    '// fetch("https://example.com/hidden");',
    'fetch("https://example.com/visible");',
  ].join('\n');
  assert.equal(detectFetchAtCursor(source, source.indexOf('hidden')), undefined);
  const visible = detectFetchAtCursor(source, source.indexOf('visible'));
  assert.equal(visible?.url, 'https://example.com/visible');
});

test('normalize URL matching unique / none / ambiguous', () => {
  const uniqueCatalog = buildSourceIntegrationCatalog([
    request({
      id: 'request:a#0',
      name: 'Get Users',
      method: 'GET',
      url: 'https://Example.com:443/users/',
    }),
  ]);
  const unique = matchCatalogByMethodAndUrl(
    uniqueCatalog,
    'get',
    'https://example.com/users',
  );
  assert.equal(unique.kind, 'unique');
  if (unique.kind === 'unique') {
    assert.equal(unique.request.id, 'request:a#0');
  }

  const none = matchCatalogByMethodAndUrl(
    uniqueCatalog,
    'POST',
    'https://example.com/users',
  );
  assert.equal(none.kind, 'none');

  const missingUrl = matchCatalogByMethodAndUrl(
    uniqueCatalog,
    'GET',
    'https://example.com/other',
  );
  assert.equal(missingUrl.kind, 'none');

  const ambiguousCatalog = buildSourceIntegrationCatalog([
    request({
      id: 'request:a#0',
      name: 'Users A',
      url: 'https://example.com/users',
      relativePath: 'Collections/A/Users.api',
      filePath: 'file:///ws/Collections/A/Users.api',
    }),
    request({
      id: 'request:b#0',
      name: 'Users B',
      url: 'https://example.com/users/',
      relativePath: 'Collections/B/Users.api',
      filePath: 'file:///ws/Collections/B/Users.api',
    }),
  ]);
  const ambiguous = matchCatalogByMethodAndUrl(
    ambiguousCatalog,
    'GET',
    'https://example.com/users',
  );
  assert.equal(ambiguous.kind, 'ambiguous');
  if (ambiguous.kind === 'ambiguous') {
    assert.equal(ambiguous.requests.length, 2);
  }
});

test('{{baseUrl}} catalog URL does not match a concrete URL', () => {
  const catalog = buildSourceIntegrationCatalog([
    request({
      id: 'request:a#0',
      name: 'Products',
      url: '{{baseUrl}}/products',
    }),
  ]);
  const match = matchCatalogByMethodAndUrl(
    catalog,
    'GET',
    'https://api.example.com/products',
  );
  assert.equal(match.kind, 'none');
  assert.equal(normalizeConcreteHttpUrl('{{baseUrl}}/products'), undefined);
});

test('graphql protocol catalog entry does not match', () => {
  const catalog = buildSourceIntegrationCatalog([
    request({
      id: 'request:gql#0',
      name: 'Graphql Users',
      url: 'https://example.com/users',
      protocol: 'graphql',
    }),
  ]);
  const match = matchCatalogByMethodAndUrl(
    catalog,
    'GET',
    'https://example.com/users',
  );
  assert.equal(match.kind, 'none');
});

test('serialize temp document has GET default and detected URL', () => {
  const source = 'fetch("https://randomuser.me/api/");';
  const detected = detectFetchAtCursor(source, 0);
  assert.ok(detected);
  const serialized = serializeRequestDocument(
    requestDocumentFromDetectedFetch(detected),
  );
  assert.match(serialized, /^@name api\n/u);
  assert.match(serialized, /\nGET https:\/\/randomuser\.me\/api\/\n/u);
});

test('unknown or identifier method fails closed instead of defaulting to GET', () => {
  assert.equal(
    detectFetchAtCursor(
      'fetch("https://example.com/users", { method: "PURGE" });',
      0,
    ),
    undefined,
  );
  assert.equal(
    detectFetchAtCursor(
      'fetch("https://example.com/users", { method: methodVar });',
      0,
    ),
    undefined,
  );
});

test('trailing as const / satisfies still detects POST', () => {
  const asConst = `fetch("https://example.com/users", {
  method: "POST",
  body: JSON.stringify({ name: "Ada" })
} as const);`;
  const asConstDetected = detectFetchAtCursor(asConst, asConst.indexOf('POST'));
  assert.equal(asConstDetected?.method, 'POST');
  assert.equal(asConstDetected?.body?.type, 'json');

  const satisfies = `fetch("https://example.com/users", {
  method: "POST"
} satisfies RequestInit);`;
  const satisfiesDetected = detectFetchAtCursor(
    satisfies,
    satisfies.indexOf('POST'),
  );
  assert.equal(satisfiesDetected?.method, 'POST');
});
