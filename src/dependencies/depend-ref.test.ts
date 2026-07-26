import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatDependRef,
  isMinimalUniqueRef,
  minimalDependRefFor,
  nameContainsPathSeparator,
  parseDependRef,
  resolveDependRef,
  type DependRefIndexEntry,
} from './depend-ref';

const catalog: readonly DependRefIndexEntry[] = [
  { requestId: 'login-auth', name: 'Login', folderPath: 'Authentication' },
  { requestId: 'login-admin', name: 'Login', folderPath: 'Admin' },
  { requestId: 'cart', name: 'Cart', folderPath: '' },
  { requestId: 'new-req', name: 'New Request', folderPath: '' },
];

describe('parseDependRef', () => {
  test('parses bare names including spaces', () => {
    assert.deepEqual(parseDependRef('Login'), {
      kind: 'bare',
      name: 'Login',
    });
    assert.deepEqual(parseDependRef('  New Request  '), {
      kind: 'bare',
      name: 'New Request',
    });
  });

  test('parses qualified Folder/Name and nested folder paths', () => {
    assert.deepEqual(parseDependRef('Authentication/Login'), {
      kind: 'qualified',
      folderPath: 'Authentication',
      name: 'Login',
    });
    assert.deepEqual(parseDependRef('Auth/Nested/Login'), {
      kind: 'qualified',
      folderPath: 'Auth/Nested',
      name: 'Login',
    });
  });

  test('parses root-qualified ./Name refs', () => {
    assert.deepEqual(parseDependRef('./Login'), {
      kind: 'qualified',
      folderPath: '',
      name: 'Login',
    });
  });

  test('rejects empty and malformed tokens', () => {
    assert.equal(parseDependRef(''), undefined);
    assert.equal(parseDependRef('   '), undefined);
    assert.equal(parseDependRef('/Login'), undefined);
    assert.equal(parseDependRef('Authentication/'), undefined);
  });
});

describe('formatDependRef', () => {
  test('formats bare and qualified refs', () => {
    assert.equal(formatDependRef({ kind: 'bare', name: 'Login' }), 'Login');
    assert.equal(
      formatDependRef({
        kind: 'qualified',
        folderPath: 'Authentication',
        name: 'Login',
      }),
      'Authentication/Login',
    );
    assert.equal(
      formatDependRef({ kind: 'qualified', folderPath: '', name: 'Login' }),
      './Login',
    );
  });
});

describe('minimalDependRefFor / isMinimalUniqueRef', () => {
  test('uses bare when the name is unique', () => {
    const ref = minimalDependRefFor(
      { requestId: 'cart', name: 'Cart', folderPath: '' },
      catalog,
    );
    assert.deepEqual(ref, { kind: 'bare', name: 'Cart' });
    assert.equal(
      isMinimalUniqueRef(ref, 'cart', catalog),
      true,
    );
  });

  test('uses qualified when the name is duplicated across folders', () => {
    const ref = minimalDependRefFor(
      {
        requestId: 'login-auth',
        name: 'Login',
        folderPath: 'Authentication',
      },
      catalog,
    );
    assert.deepEqual(ref, {
      kind: 'qualified',
      folderPath: 'Authentication',
      name: 'Login',
    });
    assert.equal(
      isMinimalUniqueRef({ kind: 'bare', name: 'Login' }, 'login-auth', catalog),
      false,
    );
  });

  test('uses ./Name when a root request shares a name with a folder request', () => {
    const mixed: readonly DependRefIndexEntry[] = [
      { requestId: 'root-login', name: 'Login', folderPath: '' },
      { requestId: 'auth-login', name: 'Login', folderPath: 'Authentication' },
    ];
    const rootRef = minimalDependRefFor(
      { requestId: 'root-login', name: 'Login', folderPath: '' },
      mixed,
    );
    assert.deepEqual(rootRef, {
      kind: 'qualified',
      folderPath: '',
      name: 'Login',
    });
    assert.equal(formatDependRef(rootRef), './Login');
    assert.deepEqual(parseDependRef(formatDependRef(rootRef)), rootRef);
    const resolved = resolveDependRef(rootRef, mixed);
    assert.deepEqual(resolved, { ok: true, requestId: 'root-login' });
  });
});

describe('resolveDependRef', () => {
  test('resolves unique bare names', () => {
    const result = resolveDependRef({ kind: 'bare', name: 'Cart' }, catalog);
    assert.deepEqual(result, { ok: true, requestId: 'cart' });
  });

  test('resolves unique bare names with spaces', () => {
    const result = resolveDependRef(
      { kind: 'bare', name: 'New Request' },
      catalog,
    );
    assert.deepEqual(result, { ok: true, requestId: 'new-req' });
  });

  test('fails closed on ambiguous bare names', () => {
    const result = resolveDependRef({ kind: 'bare', name: 'Login' }, catalog);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ambiguous');
    assert.equal(result.candidates.length, 2);
  });

  test('resolves qualified refs across duplicate names', () => {
    const result = resolveDependRef(
      {
        kind: 'qualified',
        folderPath: 'Authentication',
        name: 'Login',
      },
      catalog,
    );
    assert.deepEqual(result, { ok: true, requestId: 'login-auth' });
  });

  test('fails closed on unknown refs', () => {
    const result = resolveDependRef({ kind: 'bare', name: 'Ghost' }, catalog);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'unknown');
  });
});

describe('nameContainsPathSeparator', () => {
  test('detects slash in names', () => {
    assert.equal(nameContainsPathSeparator('Login'), false);
    assert.equal(nameContainsPathSeparator('Auth/Login'), true);
  });
});
