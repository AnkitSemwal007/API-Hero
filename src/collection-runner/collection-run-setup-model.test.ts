import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  freezeWorkspaceCollections,
  type Collection,
  type RequestReference,
  type WorkspaceCollections,
} from '../collections';
import type { VariableDefinition } from '../models';
import { MASKED_VARIABLE_VALUE } from '../variables';
import {
  NO_ENVIRONMENT_OPTION_ID,
  buildCollectionRunSetupModel,
  collectFolderTreeRequestIds,
  listCollectionRunSetupRequestIds,
  mapSelectionToRunPlanTarget,
  toExecuteConfig,
  validateCollectionRunSetup,
  type CollectionRunSetupModelInput,
} from './collection-run-setup-model';
import { CollectionRunMode, FailurePolicyKind } from './models';

describe('collection-run-setup-model', () => {
  test('builds collection name, description, and target request count', () => {
    const model = buildCollectionRunSetupModel(baseInput());
    assert.equal(model.collectionName, 'Payments');
    assert.equal(model.description, 'Checkout APIs');
    assert.equal(model.requestCount, 4);
    assert.equal(model.requestCountLabel, '4 requests');
    assert.equal(model.workspaceLabel, undefined);
    assert.equal(model.canRun, true);
  });

  test('environment list includes No Environment and selected env vs none', () => {
    const withEnv = buildCollectionRunSetupModel(
      baseInput({ selectedEnvironmentId: 'env-dev' }),
    );
    assert.equal(withEnv.environments[0]?.id, NO_ENVIRONMENT_OPTION_ID);
    assert.equal(withEnv.environments[0]?.label, 'No Environment');
    assert.equal(withEnv.environments[1]?.id, 'env-dev');
    assert.equal(withEnv.environments[1]?.label, 'Development');
    assert.equal(withEnv.selectedEnvironmentId, 'env-dev');
    assert.equal(withEnv.hasEnvironment, true);

    const none = buildCollectionRunSetupModel(
      baseInput({ selectedEnvironmentId: undefined }),
    );
    assert.equal(none.selectedEnvironmentId, NO_ENVIRONMENT_OPTION_ID);
    assert.equal(none.hasEnvironment, false);
  });

  test('variables use DefaultVariableResolver; environment wins over collection', () => {
    const model = buildCollectionRunSetupModel(
      baseInput({
        collectionVariables: [
          definition('baseUrl', 'http://collection.example', 'collection', false),
          definition('shared', 'from-collection', 'collection', false),
        ],
        environmentVariables: [
          definition('baseUrl', 'http://env.example', 'environment', false),
        ],
        globalVariables: [
          definition('region', 'us', 'global', false),
        ],
        workspaceVariables: [
          definition('tenant', 'acme', 'workspace', false),
        ],
      }),
    );
    const byName = Object.fromEntries(
      model.variables.map((row) => [row.name, row]),
    );
    assert.equal(byName.baseUrl?.displayValue, 'http://env.example');
    assert.equal(byName.baseUrl?.scopeLabel, 'Environment');
    assert.equal(byName.shared?.displayValue, 'from-collection');
    assert.equal(byName.shared?.scopeLabel, 'Collection');
    assert.equal(byName.region?.scopeLabel, 'Global');
    assert.equal(byName.tenant?.scopeLabel, 'Workspace');
    const names = model.variables.map((row) => row.name);
    assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right)));
  });

  test('sensitive values are MASKED_VARIABLE_VALUE and never plaintext', () => {
    const secret = 'super-secret-token-value';
    const password = 'hunter2-password';
    const model = buildCollectionRunSetupModel(
      baseInput({
        collectionVariables: [
          definition('apiToken', secret, 'collection', true),
          definition('password', password, 'collection', true),
          definition('publicHost', 'api.example.test', 'collection', false),
        ],
      }),
    );
    const token = model.variables.find((row) => row.name === 'apiToken');
    const pass = model.variables.find((row) => row.name === 'password');
    const host = model.variables.find((row) => row.name === 'publicHost');
    assert.equal(token?.sensitive, true);
    assert.equal(token?.displayValue, MASKED_VARIABLE_VALUE);
    assert.equal(pass?.displayValue, MASKED_VARIABLE_VALUE);
    assert.equal(host?.displayValue, 'api.example.test');
    const serialized = JSON.stringify(model);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(password), false);
    assert.equal(serialized.includes(MASKED_VARIABLE_VALUE), true);
  });

  test('auth preference mapping shows collection default and resolved labels', () => {
    const collectionDefault = buildCollectionRunSetupModel(
      baseInput({
        authentication: {
          collectionDefaultId: 'auth-basic',
          collectionDefaultLabel: 'Basic Prod',
          workspaceDefaultId: 'auth-bearer',
          workspaceDefaultLabel: 'Bearer Session',
          profiles: [
            {
              id: 'auth-basic',
              label: 'Basic Prod',
              providerId: 'basic',
              fields: [
                {
                  name: 'username',
                  label: 'Username',
                  display: '{{authUser}}',
                  sourceKind: 'variable',
                },
                {
                  name: 'password',
                  label: 'Password',
                  display: MASKED_VARIABLE_VALUE,
                  sourceKind: 'secret',
                },
              ],
            },
            {
              id: 'auth-bearer',
              label: 'Bearer Session',
              providerId: 'bearer',
              fields: [
                {
                  name: 'token',
                  label: 'Token',
                  display: '{{authToken}}',
                  sourceKind: 'variable',
                },
              ],
            },
          ],
        },
        authenticationPreference: 'collection-default',
      }),
    );
    assert.equal(collectionDefault.authentication.preference, 'collection-default');
    assert.equal(collectionDefault.authentication.collectionDefaultDisplay, 'Basic Prod');
    assert.equal(collectionDefault.authentication.resolvedDisplay, 'Bearer Session');
    assert.equal(collectionDefault.authentication.ui.selectedKind, 'basic');
    assert.equal(collectionDefault.authentication.ui.effectiveLabel, 'Collection default');
    assert.equal(
      collectionDefault.authentication.ui.fields.find((field) => field.name === 'username')
        ?.display,
      '{{authUser}}',
    );
    assert.match(
      collectionDefault.authentication.perRequestOverrideHint,
      /@auth still overrides/u,
    );

    const resolved = buildCollectionRunSetupModel(
      baseInput({
        authentication: {
          collectionDefaultId: 'auth-basic',
          collectionDefaultLabel: 'Basic Prod',
          workspaceDefaultId: 'auth-bearer',
          workspaceDefaultLabel: 'Bearer Session',
          profiles: [
            {
              id: 'auth-basic',
              label: 'Basic Prod',
              providerId: 'basic',
              fields: [],
            },
            {
              id: 'auth-bearer',
              label: 'Bearer Session',
              providerId: 'bearer',
              fields: [
                {
                  name: 'token',
                  label: 'Token',
                  display: '{{authToken}}',
                  sourceKind: 'variable',
                },
              ],
            },
          ],
        },
        authenticationPreference: 'resolved',
      }),
    );
    assert.equal(resolved.authentication.preference, 'resolved');
    assert.equal(resolved.authentication.ui.selectedKind, 'bearer');
    assert.equal(resolved.authentication.ui.effectiveLabel, 'Bearer Session');
    assert.equal(resolved.authentication.ui.resolution.source, 'workspace');

    const none = buildCollectionRunSetupModel(
      baseInput({
        authentication: {},
        authenticationPreference: 'resolved',
      }),
    );
    assert.equal(none.authentication.preference, 'resolved');
    assert.equal(none.authentication.collectionDefaultDisplay, 'None');
    assert.equal(none.authentication.resolvedDisplay, 'Resolved authentication');
    assert.equal(none.authentication.ui.selectedKind, 'none');
    assert.equal(none.authentication.ui.effectiveLabel, 'None');

    const idFallback = buildCollectionRunSetupModel(
      baseInput({
        authentication: { collectionDefaultId: 'auth-orphan' },
        authenticationPreference: 'collection-default',
      }),
    );
    assert.equal(idFallback.authentication.collectionDefaultDisplay, 'auth-orphan');
  });

  test('run setup auth ui never includes literal credential values', () => {
    const secret = 'run-setup-literal-must-not-leak';
    const model = buildCollectionRunSetupModel(
      baseInput({
        authentication: {
          collectionDefaultId: 'auth-lit',
          collectionDefaultLabel: 'Literal Bearer',
          profiles: [
            {
              id: 'auth-lit',
              label: 'Literal Bearer',
              providerId: 'bearer',
              fields: [
                {
                  name: 'token',
                  label: 'Token',
                  display: MASKED_VARIABLE_VALUE,
                  sourceKind: 'literal',
                },
              ],
            },
          ],
        },
        authenticationPreference: 'collection-default',
      }),
    );
    const serialized = JSON.stringify(model);
    assert.equal(serialized.includes(secret), false);
    assert.equal(model.authentication.ui.fields[0]?.display, MASKED_VARIABLE_VALUE);
  });

  test('hierarchical folders and requests follow collection DFS order', () => {
    const model = buildCollectionRunSetupModel(baseInput());
    assert.equal(model.tree.length, 2);
    const folderA = model.tree[0];
    assert.equal(folderA?.kind, 'folder');
    if (folderA?.kind !== 'folder') {
      assert.fail('expected folder A at tree root');
    }
    assert.equal(folderA.label, 'a');
    assert.equal(folderA.children[0]?.kind, 'folder');
    const folderB = folderA.children[0];
    if (folderB?.kind !== 'folder') {
      assert.fail('expected nested folder B');
    }
    assert.equal(folderB.label, 'b');
    assert.equal(folderB.children[0]?.kind, 'request');
    assert.equal(folderB.children[0]?.id, 'r2');
    assert.equal(folderA.children[1]?.kind, 'request');
    assert.equal(folderA.children[1]?.id, 'r1');
    assert.equal(model.tree[1]?.kind, 'request');
    assert.equal(model.tree[1]?.id, 'r4');
    assert.deepEqual(listCollectionRunSetupRequestIds(sampleAggregate(), {
      mode: 'collection',
      collectionId: 'collection:ws',
    }), ['r2', 'r3', 'r1', 'r4']);
  });

  test('all selected maps to collection target; partial maps to selected-requests', () => {
    const all = mapSelectionToRunPlanTarget(
      sampleAggregate(),
      { mode: CollectionRunMode.Collection, collectionId: 'collection:ws' },
      ['r2', 'r3', 'r1', 'r4'],
    );
    assert.deepEqual(all, {
      mode: CollectionRunMode.Collection,
      collectionId: 'collection:ws',
    });

    const partial = mapSelectionToRunPlanTarget(
      sampleAggregate(),
      { mode: CollectionRunMode.Collection, collectionId: 'collection:ws' },
      ['r1', 'r4'],
    );
    assert.equal(partial.mode, CollectionRunMode.SelectedRequests);
    if (partial.mode !== CollectionRunMode.SelectedRequests) {
      assert.fail('expected selected-requests target');
    }
    assert.deepEqual(partial.requestIds, ['r1', 'r4']);
  });

  test('folder target only includes the folder subtree', () => {
    const folderId = 'folder:collection:ws:a/b';
    const model = buildCollectionRunSetupModel(
      baseInput({
        target: {
          mode: CollectionRunMode.Folder,
          collectionId: 'collection:ws',
          folderId,
        },
        selectedRequestIds: ['r2', 'r3'],
      }),
    );
    assert.equal(model.requestCount, 2);
    assert.equal(model.requestCountLabel, '2 requests');
    assert.equal(model.tree.length, 1);
    assert.equal(model.tree[0]?.kind, 'folder');
    assert.equal(model.tree[0]?.id, folderId);
    const ids = listCollectionRunSetupRequestIds(sampleAggregate(), {
      mode: CollectionRunMode.Folder,
      collectionId: 'collection:ws',
      folderId,
    });
    assert.deepEqual(ids, ['r2', 'r3']);
    const serialized = JSON.stringify(model.tree);
    assert.equal(serialized.includes('"id":"r1"'), false);
    assert.equal(serialized.includes('"id":"r4"'), false);

    const fullFolder = mapSelectionToRunPlanTarget(
      sampleAggregate(),
      {
        mode: CollectionRunMode.Folder,
        collectionId: 'collection:ws',
        folderId,
      },
      ['r2', 'r3'],
    );
    assert.deepEqual(fullFolder, {
      mode: CollectionRunMode.Folder,
      collectionId: 'collection:ws',
      folderId,
    });
  });

  test('validate rejects missing collection, zero requests, and unknown environment', () => {
    const missing = validateCollectionRunSetup({
      aggregate: sampleAggregate(),
      originalTarget: { mode: 'collection', collectionId: 'missing' },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedRequestIds: ['r1'],
      failurePolicy: FailurePolicyKind.ContinueOnError,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.match(missing.message, /collection is no longer available/u);
    }

    const zero = validateCollectionRunSetup({
      aggregate: sampleAggregate(),
      originalTarget: { mode: 'collection', collectionId: 'collection:ws' },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedRequestIds: [],
      failurePolicy: FailurePolicyKind.ContinueOnError,
    });
    assert.equal(zero.ok, false);
    if (!zero.ok) {
      assert.match(zero.message, /at least one request/u);
    }

    const unknownEnv = validateCollectionRunSetup({
      aggregate: sampleAggregate(),
      originalTarget: { mode: 'collection', collectionId: 'collection:ws' },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedEnvironmentId: 'env-gone',
      selectedRequestIds: ['r1'],
      failurePolicy: FailurePolicyKind.ContinueOnError,
    });
    assert.equal(unknownEnv.ok, false);
    if (!unknownEnv.ok) {
      assert.match(unknownEnv.message, /environment is no longer available/u);
    }

    const unknownRequest = validateCollectionRunSetup({
      aggregate: sampleAggregate(),
      originalTarget: { mode: 'collection', collectionId: 'collection:ws' },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedRequestIds: ['not-a-request'],
      failurePolicy: FailurePolicyKind.ContinueOnError,
    });
    assert.equal(unknownRequest.ok, false);

    const outOfScope = validateCollectionRunSetup({
      aggregate: sampleAggregate(),
      originalTarget: {
        mode: CollectionRunMode.Folder,
        collectionId: 'collection:ws',
        folderId: 'folder:collection:ws:a/b',
      },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedRequestIds: ['r4'],
      failurePolicy: FailurePolicyKind.ContinueOnError,
    });
    assert.equal(outOfScope.ok, false);
    if (!outOfScope.ok) {
      assert.match(outOfScope.message, /no longer in this collection/u);
    }
  });

  test('failure policy maps to continue-on-error / stop-on-first-error', () => {
    const continueRun = toExecuteConfig({
      aggregate: sampleAggregate(),
      originalTarget: { mode: 'collection', collectionId: 'collection:ws' },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedEnvironmentId: 'env-dev',
      selectedRequestIds: ['r1', 'r2', 'r3', 'r4'],
      failurePolicy: FailurePolicyKind.ContinueOnError,
      authenticationPreference: 'collection-default',
    });
    assert.equal(continueRun.ok, true);
    if (continueRun.ok) {
      assert.equal(continueRun.config.failurePolicy, FailurePolicyKind.ContinueOnError);
      assert.equal(continueRun.config.target.mode, CollectionRunMode.Collection);
      assert.deepEqual(continueRun.config.environmentOverride, {
        environmentId: 'env-dev',
      });
    }

    const stopRun = toExecuteConfig({
      aggregate: sampleAggregate(),
      originalTarget: { mode: 'collection', collectionId: 'collection:ws' },
      environments: [{ id: 'env-dev', name: 'Development' }],
      selectedRequestIds: ['r4'],
      failurePolicy: FailurePolicyKind.StopOnFirstError,
      authenticationPreference: 'resolved',
    });
    assert.equal(stopRun.ok, true);
    if (stopRun.ok) {
      assert.equal(stopRun.config.failurePolicy, FailurePolicyKind.StopOnFirstError);
      assert.equal(stopRun.config.authenticationPreference, 'resolved');
      assert.deepEqual(stopRun.config.environmentOverride, {});
      assert.equal(stopRun.config.target.mode, CollectionRunMode.SelectedRequests);
    }
  });

  test('missing collection cannot run', () => {
    const model = buildCollectionRunSetupModel(
      baseInput({
        target: { mode: CollectionRunMode.Collection, collectionId: 'missing' },
      }),
    );
    assert.equal(model.canRun, false);
    assert.match(model.error ?? '', /no longer available/u);
    assert.equal(model.collectionName, 'Unknown collection');
  });

  test('collectFolderTreeRequestIds returns descendant request ids', () => {
    const model = buildCollectionRunSetupModel(baseInput());
    const nested = collectFolderTreeRequestIds(
      model.tree,
      'folder:collection:ws:a/b',
    );
    assert.deepEqual(nested, ['r2', 'r3']);
    const parent = collectFolderTreeRequestIds(
      model.tree,
      'folder:collection:ws:a',
    );
    assert.deepEqual(parent, ['r2', 'r3', 'r1']);
    assert.equal(
      collectFolderTreeRequestIds(model.tree, 'folder:missing'),
      undefined,
    );
  });

  test('multi-root includes workspace label when more than one workspace root', () => {
    const model = buildCollectionRunSetupModel(
      baseInput({ aggregate: multiRootAggregate() }),
    );
    assert.equal(model.workspaceLabel, 'App');
  });

  test('request nodes include method badges', () => {
    const model = buildCollectionRunSetupModel(baseInput());
    const rootRequest = model.tree[1];
    assert.equal(rootRequest?.kind, 'request');
    if (rootRequest?.kind !== 'request') {
      assert.fail('expected root request node');
    }
    assert.equal(rootRequest.method, 'GET');
    assert.equal(rootRequest.methodBadgeClass, 'method-badge method-get');
    assert.equal(rootRequest.selected, true);
  });
});

function baseInput(
  overrides: Partial<CollectionRunSetupModelInput> = {},
): CollectionRunSetupModelInput {
  const aggregate = overrides.aggregate ?? sampleAggregate();
  return {
    aggregate,
    target: overrides.target ?? {
      mode: CollectionRunMode.Collection,
      collectionId: 'collection:ws',
    },
    environments: overrides.environments ?? [
      { id: 'env-dev', name: 'Development' },
    ],
    selectedEnvironmentId: overrides.selectedEnvironmentId,
    collectionVariables: overrides.collectionVariables ?? [],
    globalVariables: overrides.globalVariables ?? [],
    workspaceVariables: overrides.workspaceVariables ?? [],
    environmentVariables: overrides.environmentVariables ?? [],
    authentication: overrides.authentication ?? {},
    authenticationPreference: overrides.authenticationPreference ?? 'collection-default',
    failurePolicy: overrides.failurePolicy ?? FailurePolicyKind.ContinueOnError,
    selectedRequestIds: overrides.selectedRequestIds ?? ['r1', 'r2', 'r3', 'r4'],
    ...(overrides.error === undefined ? {} : { error: overrides.error }),
  };
}

function definition(
  name: string,
  value: string,
  scope: VariableDefinition['scope'],
  sensitive: boolean,
): VariableDefinition {
  return { name, value, scope, sensitive };
}

function request(
  id: string,
  collectionId: string,
  filePath: string,
  index: number,
  folderId?: string,
  method = 'GET',
): RequestReference {
  return {
    id,
    collectionId,
    folderId,
    filePath,
    requestIndex: index,
    method,
    url: `https://example.test/${index}`,
    display: { label: `req-${index}` },
    range: {
      start: { offset: index * 10, line: index, column: 0 },
      end: { offset: index * 10 + 5, line: index, column: 5 },
    },
  };
}

function sampleAggregate(): WorkspaceCollections {
  const collectionId = 'collection:ws';
  const folderA = 'folder:collection:ws:a';
  const folderB = 'folder:collection:ws:a/b';
  const requests: Record<string, RequestReference> = {
    r1: request('r1', collectionId, 'file:///a/one.api', 0, folderA),
    r2: request('r2', collectionId, 'file:///a/b/two.api', 0, folderB),
    r3: request('r3', collectionId, 'file:///a/b/two.api', 1, folderB),
    r4: request('r4', collectionId, 'file:///root.api', 0),
  };
  const collection: Collection = {
    id: collectionId,
    rootPath: 'file:///ws',
    workspaceRootPath: 'file:///ws',
    kind: 'native',
    metadata: {
      name: 'Payments',
      description: 'Checkout APIs',
      workspacePath: 'file:///ws',
      requestCount: 4,
      folderCount: 2,
      defaultAuthenticationId: 'auth-basic',
    },
    display: { label: 'Payments' },
    rootFolderIds: [folderA],
    rootRequestIds: ['r4'],
    folders: {
      [folderA]: {
        id: folderA,
        collectionId,
        parentId: undefined,
        relativePath: 'a',
        display: { label: 'a' },
        folderIds: [folderB],
        requestIds: ['r1'],
      },
      [folderB]: {
        id: folderB,
        collectionId,
        parentId: folderA,
        relativePath: 'a/b',
        display: { label: 'b' },
        folderIds: [],
        requestIds: ['r2', 'r3'],
      },
    },
    requests,
  };
  return freezeWorkspaceCollections({
    workspaceRoots: [
      {
        id: 'workspace:ws',
        path: 'file:///ws',
        display: { label: 'ws' },
        collectionIds: [collectionId],
      },
    ],
    collections: { [collectionId]: collection },
    discoveredAt: 1,
    issues: [],
  });
}

function multiRootAggregate(): WorkspaceCollections {
  const base = sampleAggregate();
  const collection = base.collections['collection:ws']!;
  return freezeWorkspaceCollections({
    workspaceRoots: [
      {
        id: 'workspace:app',
        path: 'file:///app',
        display: { label: 'App' },
        collectionIds: [collection.id],
      },
      {
        id: 'workspace:other',
        path: 'file:///other',
        display: { label: 'Other' },
        collectionIds: [],
      },
    ],
    collections: { [collection.id]: collection },
    discoveredAt: 1,
    issues: [],
  });
}
