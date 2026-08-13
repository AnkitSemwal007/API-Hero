/**
 * Unit tests for framework-free TypeScript generation from JSON.
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  generateTypeScriptFromJson,
  generateTypeScriptFromJsonText,
  looksLikeValidGeneratedTypeScript,
  sanitizeTypeName,
  typeNameFromKey,
} from './typescript-from-json';

test('generates primitives on a named root interface', () => {
  const result = generateTypeScriptFromJson(
    { id: 123, name: 'John', active: true },
    { rootName: 'User' },
  );
  assert.equal(result.rootName, 'User');
  assert.match(result.code, /export interface User \{/u);
  assert.match(result.code, /id: number;/u);
  assert.match(result.code, /name: string;/u);
  assert.match(result.code, /active: boolean;/u);
  assert.match(result.code, /not a complete API schema/u);
  assert.deepEqual(result.declarationNames, ['User']);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});

test('generates nested interfaces from object keys', () => {
  const result = generateTypeScriptFromJson({
    user: { id: 1, roles: ['admin'] },
  });
  assert.match(result.code, /export interface User \{/u);
  assert.match(result.code, /id: number;/u);
  assert.match(result.code, /roles: string\[\];/u);
  assert.match(result.code, /export interface Root \{/u);
  assert.match(result.code, /user: User;/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});

test('handles null, empty array, empty object, and mixed arrays', () => {
  const result = generateTypeScriptFromJson({
    maybe: null,
    emptyList: [],
    emptyObj: {},
    mixed: [1, 'a', true, null],
    nestedArrays: [[1], [2, 3]],
  });
  assert.match(result.code, /maybe: null;/u);
  assert.match(result.code, /emptyList: unknown\[\];/u);
  assert.match(result.code, /export interface EmptyObj \{\}/u);
  assert.match(result.code, /emptyObj: EmptyObj;/u);
  assert.match(
    result.code,
    /mixed: \(number \| string \| boolean \| null\)\[\];/u,
  );
  assert.match(result.code, /nestedArrays: number\[\]\[\];/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});

test('root empty array and mixed object/primitive arrays emit valid unions', () => {
  const empty = generateTypeScriptFromJson([], { rootName: 'EmptyList' });
  assert.match(empty.code, /export type EmptyList = unknown\[\];/u);
  assert.equal(looksLikeValidGeneratedTypeScript(empty.code), true);

  const mixed = generateTypeScriptFromJson(
    [{ id: 1 }, 'x', null],
    { rootName: 'Mixed' },
  );
  // Element object must not reuse the root type-alias name (invalid TS).
  assert.match(mixed.code, /export interface MixedItem \{/u);
  assert.match(mixed.code, /id: number;/u);
  assert.match(
    mixed.code,
    /export type Mixed = \(MixedItem \| string \| null\)\[\];/u,
  );
  assert.equal(mixed.code.includes('export interface Mixed {'), false);
  assert.equal(looksLikeValidGeneratedTypeScript(mixed.code), true);
});

test('preferInterface false emits type aliases instead of interfaces', () => {
  const result = generateTypeScriptFromJson(
    { user: { id: 1 } },
    { rootName: 'Payload', preferInterface: false },
  );
  assert.match(result.code, /export type User = \{/u);
  assert.match(result.code, /export type Payload = \{/u);
  assert.equal(result.code.includes('export interface'), false);
  assert.match(result.code, /not a complete API schema/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);

  const empty = generateTypeScriptFromJson(
    {},
    { rootName: 'Empty', preferInterface: false },
  );
  assert.match(empty.code, /export type Empty = Record<string, never>;/u);
});

test('merges inconsistent object fields in arrays as optional', () => {
  const result = generateTypeScriptFromJson({
    items: [{ id: 1, name: 'a' }, { id: 2, active: true }],
  });
  assert.match(result.code, /export interface Item \{/u);
  assert.match(result.code, /id: number;/u);
  assert.match(result.code, /name\?: string;/u);
  assert.match(result.code, /active\?: boolean;/u);
  assert.match(result.code, /items: Item\[\];/u);
});

test('quotes non-identifier property keys', () => {
  const result = generateTypeScriptFromJson({ 'content-type': 'json' });
  assert.match(result.code, /"content-type": string;/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});

test('root arrays and primitives emit type aliases', () => {
  const arr = generateTypeScriptFromJson([1, 2, 3], { rootName: 'Ids' });
  assert.match(arr.code, /export type Ids = number\[\];/u);

  const prim = generateTypeScriptFromJson('hello', { rootName: 'Message' });
  assert.match(prim.code, /export type Message = string;/u);

  const nullable = generateTypeScriptFromJson(null, { rootName: 'Empty' });
  assert.match(nullable.code, /export type Empty = null;/u);
});

test('never uses string values as type names', () => {
  const secretValue = 'sk_live_super_secret_value_do_not_use';
  const result = generateTypeScriptFromJson({
    token: secretValue,
    nested: { label: secretValue },
  });
  assert.equal(result.code.includes(secretValue), false);
  assert.match(result.code, /token: string;/u);
  assert.match(result.code, /export interface Nested \{/u);
  assert.match(result.code, /label: string;/u);
});

test('parse helper rejects invalid JSON', () => {
  const failed = generateTypeScriptFromJsonText('{');
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.match(failed.message, /Could not parse JSON/u);
  }

  const empty = generateTypeScriptFromJsonText('   ');
  assert.equal(empty.ok, false);

  const ok = generateTypeScriptFromJsonText('{"a":1}', { rootName: 'Payload' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.match(ok.result.code, /export interface Payload \{/u);
  }
});

test('sanitizeTypeName and typeNameFromKey avoid reserved words', () => {
  assert.equal(sanitizeTypeName('interface'), 'InterfaceType');
  assert.equal(typeNameFromKey('user_profile'), 'UserProfile');
  assert.equal(typeNameFromKey(''), 'Item');
  assert.equal(sanitizeTypeName('123'), 'T123');
});

test('large JSON completes within a sanity budget', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    id: index,
    name: `n${index}`,
    meta: { active: index % 2 === 0, tags: [`t${index % 5}`] },
  }));
  const payload = { rows, total: rows.length };
  const started = performance.now();
  const result = generateTypeScriptFromJson(payload, { rootName: 'ListResponse' });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1_000, `generation took ${elapsed}ms`);
  assert.match(result.code, /export interface ListResponse \{/u);
  assert.match(result.code, /rows: Row\[\];/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});

test('attribution comments use request name and path only', () => {
  const result = generateTypeScriptFromJson(
    { id: 1, accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb' },
    {
      rootName: 'User',
      attribution: {
        requestName: 'Get User',
        requestPath: 'Collections/Demo/Get-User.api',
      },
    },
  );
  assert.match(result.code, /@api-hero name: Get User/u);
  assert.match(result.code, /@api-hero request: Collections\/Demo\/Get-User\.api/u);
  assert.doesNotMatch(result.code, /eyJhbGci/u);
  assert.doesNotMatch(result.code, /Authorization/u);
  assert.match(result.code, /accessToken: string;/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});

test('attribution comments strip query secrets from unlabeled names', () => {
  const result = generateTypeScriptFromJson(
    { id: 1 },
    {
      rootName: 'User',
      attribution: {
        requestName: 'GET /users?access_token=super-secret-token',
        requestPath: 'Collections/Demo/Get-User.api',
      },
    },
  );
  assert.match(result.code, /@api-hero name: GET \/users/u);
  assert.doesNotMatch(result.code, /super-secret-token/u);
  assert.doesNotMatch(result.code, /access_token/u);
});

test('attribution comments cannot close the generated block comment', () => {
  const result = generateTypeScriptFromJson(
    { id: 1 },
    {
      rootName: 'User',
      attribution: {
        requestName: 'Get */ User',
        requestPath: 'Collections/*/Get-User.api',
      },
    },
  );
  assert.doesNotMatch(result.code, /Get \*\/ User/u);
  assert.doesNotMatch(result.code, /Collections\/\*\/Get-User/u);
  assert.match(result.code, /@api-hero name: Get {2}User/u);
  assert.match(result.code, /@api-hero request: Collections\/Get-User\.api/u);
});

test('depth cap falls back to unknown', () => {
  let nested: unknown = { value: 1 };
  for (let i = 0; i < 40; i += 1) {
    nested = { child: nested };
  }
  const result = generateTypeScriptFromJson(nested, { maxDepth: 3 });
  assert.match(result.code, /unknown/u);
  assert.equal(looksLikeValidGeneratedTypeScript(result.code), true);
});
