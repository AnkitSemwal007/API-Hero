import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DependRefIndexEntry } from './depend-ref';
import {
  planDependRefRewrites,
  rewriteDependsOnTokens,
  tokenTargetsRenamedRequest,
} from './rename-depend-refs';

const before: readonly DependRefIndexEntry[] = [
  { requestId: 'login', name: 'Login', folderPath: 'Authentication' },
  { requestId: 'cart', name: 'Cart', folderPath: '' },
  { requestId: 'invoice', name: 'Invoice', folderPath: '' },
];

const afterUnique: readonly DependRefIndexEntry[] = [
  { requestId: 'login', name: 'SignIn', folderPath: 'Authentication' },
  { requestId: 'cart', name: 'Cart', folderPath: '' },
  { requestId: 'invoice', name: 'Invoice', folderPath: '' },
];

describe('rewriteDependsOnTokens', () => {
  test('rewrites unique bare name to new bare name when still unique', () => {
    const next = rewriteDependsOnTokens(['Login', 'Cart'], {
      identity: {
        requestId: 'cart',
        oldName: 'Cart',
        oldFolderPath: '',
        newName: 'Basket',
      },
      catalogBefore: before,
      catalogAfter: [
        { requestId: 'login', name: 'Login', folderPath: 'Authentication' },
        { requestId: 'cart', name: 'Basket', folderPath: '' },
        { requestId: 'invoice', name: 'Invoice', folderPath: '' },
      ],
    });
    assert.deepEqual(next, ['Login', 'Basket']);
  });

  test('rewrites qualified Folder/Name tokens', () => {
    const next = rewriteDependsOnTokens(['Authentication/Login'], {
      identity: {
        requestId: 'login',
        oldName: 'Login',
        oldFolderPath: 'Authentication',
        newName: 'SignIn',
      },
      catalogBefore: before,
      catalogAfter: afterUnique,
    });
    assert.deepEqual(next, ['SignIn']);
  });

  test('does not rewrite unrelated tokens', () => {
    const next = rewriteDependsOnTokens(['Cart'], {
      identity: {
        requestId: 'login',
        oldName: 'Login',
        oldFolderPath: 'Authentication',
        newName: 'SignIn',
      },
      catalogBefore: before,
      catalogAfter: afterUnique,
    });
    assert.deepEqual(next, ['Cart']);
  });

  test('does not rewrite ambiguous bare names that were not unique', () => {
    const catalogDup: readonly DependRefIndexEntry[] = [
      { requestId: 'login1', name: 'Login', folderPath: 'A' },
      { requestId: 'login2', name: 'Login', folderPath: 'B' },
    ];
    assert.equal(
      tokenTargetsRenamedRequest(
        'Login',
        {
          requestId: 'login1',
          oldName: 'Login',
          oldFolderPath: 'A',
          newName: 'SignIn',
        },
        catalogDup,
      ),
      false,
    );
  });
});

describe('planDependRefRewrites', () => {
  test('returns only documents whose dependsOn lists change', () => {
    const rewrites = planDependRefRewrites({
      identity: {
        requestId: 'cart',
        oldName: 'Cart',
        oldFolderPath: '',
        newName: 'Basket',
      },
      catalogBefore: before,
      catalogAfter: [
        { requestId: 'login', name: 'Login', folderPath: 'Authentication' },
        { requestId: 'cart', name: 'Basket', folderPath: '' },
        { requestId: 'invoice', name: 'Invoice', folderPath: '' },
      ],
      documents: [
        {
          filePath: '/ws/invoice.api',
          requestId: 'invoice',
          dependsOn: ['Cart'],
        },
        {
          filePath: '/ws/other.api',
          requestId: 'other',
          dependsOn: ['Login'],
        },
        {
          filePath: '/ws/cart.api',
          requestId: 'cart',
          dependsOn: [],
        },
      ],
    });
    assert.deepEqual(rewrites, [
      {
        filePath: '/ws/invoice.api',
        requestId: 'invoice',
        dependsOn: ['Basket'],
      },
    ]);
  });
});
