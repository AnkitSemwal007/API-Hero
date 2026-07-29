import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveScenarioRequestRef } from './request-depend-ref';
import type { ScenarioRequestCatalogEntry } from './request-depend-ref';

describe('scenarios/request-depend-ref', () => {
  const catalog: readonly ScenarioRequestCatalogEntry[] = [
    {
      requestId: 'req-login-root',
      name: 'Login',
      folderPath: '',
      filePath: '/ws/Login.api',
      requestOffset: 0,
    },
    {
      requestId: 'req-login-auth',
      name: 'Login',
      folderPath: 'Auth',
      filePath: '/ws/Auth/Login.api',
      requestOffset: 10,
    },
    {
      requestId: 'req-me',
      name: 'Me',
      folderPath: 'Auth',
      filePath: '/ws/Auth/Me.api',
      requestOffset: 20,
    },
  ];

  test('resolves unique bare name', () => {
    const result = resolveScenarioRequestRef('Me', catalog);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.requestId, 'req-me');
      assert.equal(result.requestOffset, 20);
    }
  });

  test('fails closed on ambiguous bare name', () => {
    const result = resolveScenarioRequestRef('Login', catalog);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'ambiguous');
    }
  });

  test('resolves qualified Folder/Name', () => {
    const result = resolveScenarioRequestRef('Auth/Login', catalog);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.requestId, 'req-login-auth');
    }
  });

  test('resolves root-qualified ./Name', () => {
    const result = resolveScenarioRequestRef('./Login', catalog);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.requestId, 'req-login-root');
    }
  });

  test('fails closed on unknown', () => {
    const result = resolveScenarioRequestRef('Missing', catalog);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'unknown');
    }
  });
});
