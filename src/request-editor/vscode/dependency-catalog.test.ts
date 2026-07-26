import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  freezeWorkspaceCollections,
  type WorkspaceCollections,
} from '../../collections';
import { prepareModelForSerialize } from '../prepare-model-for-serialize';
import {
  buildRequestEditorDependencyCatalog,
  toWebviewDependencyCatalog,
} from './dependency-catalog';

describe('buildRequestEditorDependencyCatalog', () => {
  test('returns same-collection human refs excluding self', () => {
    const aggregate = freezeWorkspaceCollections({
      workspaceRoots: [],
      discoveredAt: 0,
      issues: [],
      collections: {
        'collection:demo': {
          id: 'collection:demo',
          rootPath: '/ws/Collections/Demo',
          workspaceRootPath: '/ws',
          kind: 'native',
          metadata: {
            name: 'Demo',
            workspacePath: '/ws/Collections/Demo',
            requestCount: 2,
            folderCount: 0,
          },
          display: { label: 'Demo' },
          rootFolderIds: [],
          rootRequestIds: ['request:/ws/a.api#0', 'request:/ws/b.api#0'],
          folders: {},
          requests: {
            'request:/ws/a.api#0': {
              id: 'request:/ws/a.api#0',
              collectionId: 'collection:demo',
              folderId: undefined,
              filePath: '/ws/a.api',
              requestIndex: 0,
              method: 'GET',
              url: 'https://example.test/a',
              display: { label: 'Alpha' },
              range: {
                start: { line: 0, column: 0, offset: 0 },
                end: { line: 0, column: 1, offset: 1 },
              },
            },
            'request:/ws/b.api#0': {
              id: 'request:/ws/b.api#0',
              collectionId: 'collection:demo',
              folderId: undefined,
              filePath: '/ws/b.api',
              requestIndex: 0,
              method: 'GET',
              url: 'https://example.test/b',
              display: { label: 'Beta' },
              range: {
                start: { line: 0, column: 0, offset: 0 },
                end: { line: 0, column: 1, offset: 1 },
              },
            },
          },
        },
      },
    } satisfies WorkspaceCollections);

    const catalog = buildRequestEditorDependencyCatalog({
      aggregate,
      documentPath: '/ws/a.api',
      currentRequestId: 'request:/ws/a.api#0',
    });
    assert.deepEqual(catalog, [
      {
        name: 'Beta',
        folderPath: '',
        dependRef: 'Beta',
        requestId: 'request:/ws/b.api#0',
      },
    ]);
  });

  test('uses qualified dependRef when names collide across folders', () => {
    const aggregate = freezeWorkspaceCollections({
      workspaceRoots: [],
      discoveredAt: 0,
      issues: [],
      collections: {
        'collection:demo': {
          id: 'collection:demo',
          rootPath: '/ws/Collections/Demo',
          workspaceRootPath: '/ws',
          kind: 'native',
          metadata: {
            name: 'Demo',
            workspacePath: '/ws/Collections/Demo',
            requestCount: 2,
            folderCount: 2,
          },
          display: { label: 'Demo' },
          rootFolderIds: ['folder:auth', 'folder:admin'],
          rootRequestIds: [],
          folders: {
            'folder:auth': {
              id: 'folder:auth',
              collectionId: 'collection:demo',
              parentId: undefined,
              relativePath: 'Authentication',
              display: { label: 'Authentication' },
              folderIds: [],
              requestIds: ['request:/ws/auth-login.api#0'],
            },
            'folder:admin': {
              id: 'folder:admin',
              collectionId: 'collection:demo',
              parentId: undefined,
              relativePath: 'Admin',
              display: { label: 'Admin' },
              folderIds: [],
              requestIds: ['request:/ws/admin-login.api#0'],
            },
          },
          requests: {
            'request:/ws/auth-login.api#0': {
              id: 'request:/ws/auth-login.api#0',
              collectionId: 'collection:demo',
              folderId: 'folder:auth',
              filePath: '/ws/auth-login.api',
              requestIndex: 0,
              method: 'POST',
              url: 'https://example.test/login',
              display: { label: 'Login' },
              range: {
                start: { line: 0, column: 0, offset: 0 },
                end: { line: 0, column: 1, offset: 1 },
              },
            },
            'request:/ws/admin-login.api#0': {
              id: 'request:/ws/admin-login.api#0',
              collectionId: 'collection:demo',
              folderId: 'folder:admin',
              filePath: '/ws/admin-login.api',
              requestIndex: 0,
              method: 'POST',
              url: 'https://example.test/admin/login',
              display: { label: 'Login' },
              range: {
                start: { line: 0, column: 0, offset: 0 },
                end: { line: 0, column: 1, offset: 1 },
              },
            },
          },
        },
      },
    } satisfies WorkspaceCollections);

    const catalog = buildRequestEditorDependencyCatalog({
      aggregate,
      documentPath: '/ws/auth-login.api',
      currentRequestId: 'request:/ws/auth-login.api#0',
    });
    assert.deepEqual(
      catalog.map((entry) => entry.dependRef).sort(),
      ['Admin/Login'],
    );

    // Without excluding self, both duplicates are qualified.
    const full = buildRequestEditorDependencyCatalog({
      aggregate,
      documentPath: '/ws/auth-login.api',
    });
    assert.deepEqual(
      full.map((entry) => entry.dependRef).sort(),
      ['Admin/Login', 'Authentication/Login'],
    );
  });
});

describe('toWebviewDependencyCatalog', () => {
  test('strips discovery requestId before posting to the webview', () => {
    const webview = toWebviewDependencyCatalog([
      {
        name: 'Login',
        folderPath: 'Authentication',
        dependRef: 'Authentication/Login',
        requestId: 'request:/ws/login.api#0',
        folderLabel: 'Authentication',
        legacyAuthoredId: 'req_login01',
      },
    ]);
    assert.deepEqual(webview, [
      {
        name: 'Login',
        folderPath: 'Authentication',
        dependRef: 'Authentication/Login',
        folderLabel: 'Authentication',
        legacyAuthoredId: 'req_login01',
      },
    ]);
  });
});

describe('prepareModelForSerialize', () => {
  test('does not generate @id and keeps human depends-on refs', () => {
    const prepared = prepareModelForSerialize(
      {
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test/invoice',
        dependsOn: ['Login'],
      },
      [{ name: 'Login', folderPath: '', requestId: 'request:/ws/login.api#0' }],
    );
    assert.equal(prepared.id, undefined);
    assert.deepEqual(prepared.dependsOn, ['Login']);
  });

  test('reverse-migrates leftover req_* tokens when legacyAuthoredId is unique', () => {
    const prepared = prepareModelForSerialize(
      {
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test/invoice',
        dependsOn: ['req_login01'],
      },
      [
        {
          name: 'Login',
          folderPath: '',
          requestId: 'request:/ws/login.api#0',
          legacyAuthoredId: 'req_login01',
        },
      ],
    );
    assert.deepEqual(prepared.dependsOn, ['Login']);
  });

  test('drops leftover req_* when catalog is empty', () => {
    const prepared = prepareModelForSerialize(
      {
        name: 'Invoice',
        method: 'GET',
        url: 'https://example.test/invoice',
        dependsOn: ['req_login01', 'Products'],
      },
      [],
    );
    assert.deepEqual(prepared.dependsOn, ['Products']);
  });
});
