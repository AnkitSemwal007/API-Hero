import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiFileParseCache,
  COLLECTION_MARKER_FILENAME,
  COLLECTIONS_DIRECTORY_NAME,
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
  LEGACY_COLLECTION_LABEL,
  buildNavigationIndex,
  collectionIdForRoot,
  findRequestAtOffset,
  findRequestById,
  findTreeNodeByRequestId,
  formatRequestDescription,
  freezeWorkspaceCollections,
  getFilteredTreeChildren,
  getTreeChildren,
  getTreeRoots,
  isLegacyTreeTarget,
  joinPathKey,
  legacyCollectionIdForWorkspace,
  normalizeFilterQuery,
  normalizePathKey,
  normalizeRelativePath,
  parseApiFileRequests,
  parseCollectionMarker,
  requestIdFor,
  treePathToRequest,
  type ApiFileReader,
  type Collection,
  type DiscoveredApiFile,
  type DiscoveredCollectionRoot,
  type WorkspaceScanResult,
  type WorkspaceScanner,
} from './index';

interface MemoryFile {
  readonly text: string;
  readonly mtimeMs: number;
}

class MemoryWorkspace implements WorkspaceScanner, ApiFileReader {
  public constructor(
    private folders: { path: string; name: string }[],
    private files: Map<
      string,
      MemoryFile & { relativePath: string; workspaceRootPath: string }
    >,
    private collectionRoots: DiscoveredCollectionRoot[] = [],
  ) {}

  public scan(): WorkspaceScanResult {
    const apiFiles: DiscoveredApiFile[] = [];
    for (const [path, file] of this.files) {
      if (!file.relativePath.toLowerCase().endsWith('.api')) {
        continue;
      }
      apiFiles.push({
        path,
        relativePath: file.relativePath,
        workspaceRootPath: file.workspaceRootPath,
        mtimeMs: file.mtimeMs,
      });
    }
    return {
      folders: this.folders,
      apiFiles,
      collectionRoots: this.collectionRoots,
      issues: [],
    };
  }

  public readText(path: string): string {
    const file = this.files.get(path);
    if (file === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return file.text;
  }

  public setFolders(folders: { path: string; name: string }[]): void {
    this.folders = folders;
  }

  public setCollectionRoots(roots: DiscoveredCollectionRoot[]): void {
    this.collectionRoots = roots;
  }

  public setFile(
    path: string,
    relativePath: string,
    workspaceRootPath: string,
    text: string,
    mtimeMs: number,
  ): void {
    this.files.set(path, { relativePath, workspaceRootPath, text, mtimeMs });
  }

  public deleteFile(path: string): void {
    this.files.delete(path);
  }

  public clearAll(): void {
    this.folders = [];
    this.files.clear();
    this.collectionRoots = [];
  }
}

function createDiscovery(memory: MemoryWorkspace): CollectionDiscoveryService {
  return new CollectionDiscoveryService({
    scanner: memory,
    reader: memory,
    repository: new InMemoryCollectionRepository(),
    parseCache: new ApiFileParseCache(),
  });
}

function nativeRoot(
  workspacePath: string,
  name: string,
  markerPath?: string,
): DiscoveredCollectionRoot {
  return {
    path: `${workspacePath}/${COLLECTIONS_DIRECTORY_NAME}/${name}`,
    name,
    workspaceRootPath: workspacePath,
    relativePath: `${COLLECTIONS_DIRECTORY_NAME}/${name}`,
    ...(markerPath !== undefined ? { markerPath } : {}),
  };
}

test('domain models are deeply frozen after discovery', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/root.api',
        {
          relativePath: 'root.api',
          workspaceRootPath: '/ws',
          text: '@name Health\nGET /health\n',
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();

  assert.equal(Object.isFrozen(aggregate), true);
  const collection = Object.values(aggregate.collections)[0];
  assert.ok(collection);
  assert.equal(Object.isFrozen(collection), true);
  assert.equal(Object.isFrozen(collection.requests), true);
  const request = Object.values(collection.requests)[0];
  assert.ok(request);
  assert.equal(Object.isFrozen(request), true);
  assert.throws(() => {
    (request as { method: string }).method = 'POST';
  });
});

test('freezeWorkspaceCollections clones and freezes aggregates', () => {
  const frozen = freezeWorkspaceCollections({
    workspaceRoots: [],
    collections: {},
    discoveredAt: 1,
    issues: [],
  });
  assert.equal(Object.isFrozen(frozen), true);
  assert.throws(() => {
    (frozen as { discoveredAt: number }).discoveredAt = 2;
  });
});

test('files outside Collections/ project into a Legacy collection', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/project', name: 'project' }],
    new Map([
      [
        '/project/ping.api',
        {
          relativePath: 'ping.api',
          workspaceRootPath: '/project',
          text: 'GET /ping\n',
          mtimeMs: 1,
        },
      ],
      [
        '/project/api/v1/users.api',
        {
          relativePath: 'api/v1/users.api',
          workspaceRootPath: '/project',
          text: [
            '@name List users',
            'GET /users',
            '###',
            '@name Create user',
            'POST /users',
            '',
          ].join('\n'),
          mtimeMs: 2,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();

  assert.equal(aggregate.workspaceRoots.length, 1);
  assert.equal(Object.keys(aggregate.collections).length, 1);
  const collection = Object.values(aggregate.collections)[0]!;
  assert.equal(collection.kind, 'legacy');
  assert.equal(collection.id, legacyCollectionIdForWorkspace('/project'));
  assert.equal(collection.display.label, LEGACY_COLLECTION_LABEL);
  assert.equal(collection.metadata.requestCount, 3);
  assert.equal(collection.rootRequestIds.length, 1);
  const apiFolder = Object.values(collection.folders).find(
    (folder) => folder.relativePath === 'api',
  );
  const v1Folder = Object.values(collection.folders).find(
    (folder) => folder.relativePath === 'api/v1',
  );
  assert.ok(apiFolder);
  assert.ok(v1Folder);
  assert.equal(v1Folder.requestIds.length, 2);
  const labels = v1Folder.requestIds.map(
    (id) => collection.requests[id]?.display.label,
  );
  assert.deepEqual(labels, ['List users', 'Create user']);
});

test('discovers Collections/ roots with optional marker and Legacy leftovers', async () => {
  const markerPath = `/ws/${COLLECTIONS_DIRECTORY_NAME}/Petstore/${COLLECTION_MARKER_FILENAME}`;
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        markerPath,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Petstore/${COLLECTION_MARKER_FILENAME}`,
          workspaceRootPath: '/ws',
          text: JSON.stringify({
            name: 'Pet Store',
            description: 'OpenAPI pets',
            order: 1,
          }),
          mtimeMs: 1,
        },
      ],
      [
        `/ws/${COLLECTIONS_DIRECTORY_NAME}/Petstore/pets/list.api`,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Petstore/pets/list.api`,
          workspaceRootPath: '/ws',
          text: '@name List pets\nGET /pets\n',
          mtimeMs: 2,
        },
      ],
      [
        '/ws/legacy-root.api',
        {
          relativePath: 'legacy-root.api',
          workspaceRootPath: '/ws',
          text: 'GET /legacy\n',
          mtimeMs: 3,
        },
      ],
    ]),
    [
      nativeRoot('/ws', 'Petstore', markerPath),
      nativeRoot('/ws', 'Empty'),
    ],
  );

  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();

  assert.equal(Object.keys(aggregate.collections).length, 3);
  const petstoreId = collectionIdForRoot(
    `/ws/${COLLECTIONS_DIRECTORY_NAME}/Petstore`,
  );
  const emptyId = collectionIdForRoot(`/ws/${COLLECTIONS_DIRECTORY_NAME}/Empty`);
  const legacyId = legacyCollectionIdForWorkspace('/ws');

  const petstore = aggregate.collections[petstoreId];
  assert.ok(petstore);
  assert.equal(petstore.kind, 'native');
  assert.equal(petstore.display.label, 'Pet Store');
  assert.equal(petstore.metadata.description, 'OpenAPI pets');
  assert.equal(petstore.metadata.order, 1);
  assert.equal(petstore.metadata.requestCount, 1);
  const petsFolder = Object.values(petstore.folders).find(
    (folder) => folder.relativePath === 'pets',
  );
  assert.ok(petsFolder);
  assert.equal(petsFolder.requestIds.length, 1);

  const empty = aggregate.collections[emptyId];
  assert.ok(empty);
  assert.equal(empty.kind, 'native');
  assert.equal(empty.display.label, 'Empty');
  assert.equal(empty.metadata.requestCount, 0);

  const legacy = aggregate.collections[legacyId];
  assert.ok(legacy);
  assert.equal(legacy.kind, 'legacy');
  assert.equal(legacy.metadata.requestCount, 1);
  assert.deepEqual(aggregate.workspaceRoots[0]?.collectionIds, [
    petstoreId,
    emptyId,
    legacyId,
  ]);
});

test('Collections/<Name>/ without marker still becomes a native collection', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        `/ws/${COLLECTIONS_DIRECTORY_NAME}/Bare/ping.api`,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Bare/ping.api`,
          workspaceRootPath: '/ws',
          text: 'GET /ping\n',
          mtimeMs: 1,
        },
      ],
    ]),
    [nativeRoot('/ws', 'Bare')],
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  assert.equal(Object.keys(aggregate.collections).length, 1);
  const collection = Object.values(aggregate.collections)[0]!;
  assert.equal(collection.kind, 'native');
  assert.equal(collection.display.label, 'Bare');
  assert.equal(collection.rootRequestIds.length, 1);
});

test('multi-root workspaces get per-folder Legacy collections', async () => {
  const memory = new MemoryWorkspace(
    [
      { path: '/alpha', name: 'alpha' },
      { path: '/beta', name: 'beta' },
    ],
    new Map([
      [
        '/alpha/a.api',
        {
          relativePath: 'a.api',
          workspaceRootPath: '/alpha',
          text: 'GET /a\n',
          mtimeMs: 1,
        },
      ],
      [
        '/beta/b.api',
        {
          relativePath: 'b.api',
          workspaceRootPath: '/beta',
          text: 'GET /b\n',
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  assert.equal(aggregate.workspaceRoots.length, 2);
  assert.equal(Object.keys(aggregate.collections).length, 2);
  assert.equal(
    aggregate.collections[legacyCollectionIdForWorkspace('/alpha')]?.metadata
      .requestCount,
    1,
  );
  assert.equal(
    aggregate.collections[legacyCollectionIdForWorkspace('/beta')]?.metadata
      .requestCount,
    1,
  );
});

test('refresh reports no workspace and recovers after folders appear', async () => {
  const memory = new MemoryWorkspace([], new Map());
  const discovery = createDiscovery(memory);
  const empty = await discovery.refresh();
  assert.equal(empty.workspaceRoots.length, 0);
  assert.ok(empty.issues.some((issue) => issue.code === 'NO_WORKSPACE'));

  memory.setFolders([{ path: '/ws', name: 'ws' }]);
  memory.setFile('/ws/ok.api', 'ok.api', '/ws', 'GET /ok\n', 1);
  const recovered = await discovery.refresh();
  assert.equal(recovered.workspaceRoots.length, 1);
  assert.equal(Object.values(recovered.collections)[0]?.kind, 'legacy');
  assert.equal(Object.values(recovered.collections)[0]?.metadata.requestCount, 1);
});

test('unreadable files become discovery issues without crashing', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/bad.api',
        {
          relativePath: 'bad.api',
          workspaceRootPath: '/ws',
          text: 'GET /ok\n',
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const reader: ApiFileReader = {
    readText(): string {
      throw new Error('EACCES');
    },
  };
  const discovery = new CollectionDiscoveryService({
    scanner: memory,
    reader,
    repository: new InMemoryCollectionRepository(),
  });
  const aggregate = await discovery.refresh();
  assert.ok(aggregate.issues.some((issue) => issue.code === 'UNREADABLE_FILE'));
  assert.equal(Object.values(aggregate.collections)[0]?.metadata.requestCount, 0);
});

test('missing deleted files disappear after invalidateFile refresh', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/one.api',
        {
          relativePath: 'one.api',
          workspaceRootPath: '/ws',
          text: 'GET /one\n',
          mtimeMs: 1,
        },
      ],
      [
        '/ws/two.api',
        {
          relativePath: 'two.api',
          workspaceRootPath: '/ws',
          text: 'GET /two\n',
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const first = await discovery.refresh();
  assert.equal(Object.values(first.collections)[0]?.metadata.requestCount, 2);

  memory.deleteFile('/ws/two.api');
  const second = await discovery.invalidateFile('/ws/two.api');
  assert.equal(Object.values(second.collections)[0]?.metadata.requestCount, 1);
});

test('single-flight refresh coalesces concurrent calls and runs a trailing scan', async () => {
  let scanCount = 0;
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/a.api',
        {
          relativePath: 'a.api',
          workspaceRootPath: '/ws',
          text: 'GET /a\n',
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const scanner: WorkspaceScanner = {
    async scan(): Promise<WorkspaceScanResult> {
      scanCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return memory.scan();
    },
  };
  const discovery = new CollectionDiscoveryService({
    scanner,
    reader: memory,
    repository: new InMemoryCollectionRepository(),
  });

  const first = discovery.refresh();
  const second = discovery.refresh();
  memory.setFile('/ws/b.api', 'b.api', '/ws', 'GET /b\n', 2);
  const third = discovery.refresh();

  const [a, b, c] = await Promise.all([first, second, third]);
  assert.ok(scanCount >= 2);
  assert.ok(scanCount <= 3);
  assert.equal(Object.values(c.collections)[0]?.metadata.requestCount, 2);
  assert.equal(a.discoveredAt <= c.discoveredAt, true);
  assert.equal(b.discoveredAt <= c.discoveredAt, true);
});

test('parse cache reuses results until mtime changes', () => {
  const cache = new ApiFileParseCache();
  const first = cache.getOrParse('/a.api', 'GET /a\n', 10);
  const second = cache.getOrParse('/a.api', 'GET /changed\n', 10);
  assert.equal(first, second);
  assert.equal(first.requests[0]?.url, '/a');

  const third = cache.getOrParse('/a.api', 'GET /changed\n', 11);
  assert.notEqual(first, third);
  assert.equal(third.requests[0]?.url, '/changed');
  assert.equal(cache.size(), 1);
});

test('parseApiFileRequests uses @name labels and ranges', () => {
  const result = parseApiFileRequests(
    ['@name Named', 'GET /named', '###', 'POST /other'].join('\n'),
    'sample.api',
  );
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0]?.label, 'Named');
  assert.equal(result.requests[1]?.label, 'POST /other');
  assert.ok((result.requests[0]?.range.start.offset ?? -1) >= 0);
});

test('parseCollectionMarker accepts name description order and sibling arrays', () => {
  const parsed = parseCollectionMarker(
    JSON.stringify({
      name: 'A',
      description: 'B',
      order: 2,
      folderOrder: ['Authentication', 'Users'],
      requestOrder: {
        '.': ['Health.api'],
        Authentication: ['Login.api'],
      },
      extra: true,
    }),
  );
  assert.deepEqual(parsed, {
    name: 'A',
    description: 'B',
    order: 2,
    folderOrder: ['Authentication', 'Users'],
    requestOrder: {
      '.': ['Health.api'],
      Authentication: ['Login.api'],
    },
  });
  assert.equal(parseCollectionMarker('not-json'), undefined);
  assert.equal(parseCollectionMarker('[]'), undefined);
});

test('marker folderOrder materializes empty folders and sorts siblings', async () => {
  const markerPath = `/ws/${COLLECTIONS_DIRECTORY_NAME}/Ordered/${COLLECTION_MARKER_FILENAME}`;
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        markerPath,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Ordered/${COLLECTION_MARKER_FILENAME}`,
          workspaceRootPath: '/ws',
          text: JSON.stringify({
            name: 'Ordered',
            folderOrder: ['Zebra', 'Alpha'],
            requestOrder: {
              '.': ['b.api', 'a.api'],
              Alpha: ['z.api', 'm.api'],
            },
          }),
          mtimeMs: 1,
        },
      ],
      [
        `/ws/${COLLECTIONS_DIRECTORY_NAME}/Ordered/a.api`,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Ordered/a.api`,
          workspaceRootPath: '/ws',
          text: '@name A\nGET /a\n',
          mtimeMs: 2,
        },
      ],
      [
        `/ws/${COLLECTIONS_DIRECTORY_NAME}/Ordered/b.api`,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Ordered/b.api`,
          workspaceRootPath: '/ws',
          text: '@name B\nGET /b\n',
          mtimeMs: 3,
        },
      ],
      [
        `/ws/${COLLECTIONS_DIRECTORY_NAME}/Ordered/Alpha/m.api`,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Ordered/Alpha/m.api`,
          workspaceRootPath: '/ws',
          text: '@name M\nGET /m\n',
          mtimeMs: 4,
        },
      ],
      [
        `/ws/${COLLECTIONS_DIRECTORY_NAME}/Ordered/Alpha/z.api`,
        {
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/Ordered/Alpha/z.api`,
          workspaceRootPath: '/ws',
          text: '@name Z\nGET /z\n',
          mtimeMs: 5,
        },
      ],
    ]),
    [nativeRoot('/ws', 'Ordered', markerPath)],
  );

  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  const collection = Object.values(aggregate.collections)[0]!;
  const rootFolderLabels = collection.rootFolderIds.map(
    (id) => collection.folders[id]?.display.label,
  );
  assert.deepEqual(rootFolderLabels, ['Zebra', 'Alpha']);
  assert.ok(
    Object.values(collection.folders).some(
      (folder) => folder.relativePath === 'Zebra' && folder.requestIds.length === 0,
    ),
  );
  const rootRequestLabels = collection.rootRequestIds.map(
    (id) => collection.requests[id]?.display.label,
  );
  assert.deepEqual(rootRequestLabels, ['B', 'A']);
  const alpha = Object.values(collection.folders).find(
    (folder) => folder.relativePath === 'Alpha',
  )!;
  const alphaLabels = alpha.requestIds.map(
    (id) => collection.requests[id]?.display.label,
  );
  assert.deepEqual(alphaLabels, ['Z', 'M']);
});

test('navigation index maps uri + offset to request references', async () => {
  const source = ['GET /one', '###', 'POST /two'].join('\n');
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/nav.api',
        {
          relativePath: 'nav.api',
          workspaceRootPath: '/ws',
          text: source,
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  const index = buildNavigationIndex(aggregate);
  const secondOffset = source.indexOf('POST');
  const hit = findRequestAtOffset(index, '/ws/nav.api', secondOffset);
  assert.equal(hit?.method, 'POST');
  assert.equal(hit?.url, '/two');

  const byId = findRequestById(aggregate, hit!.id);
  assert.equal(byId?.id, hit?.id);
  assert.equal(
    findRequestAtOffset(index, '/ws/missing.api', 0),
    undefined,
  );
});

test('tree projection uses collections as roots', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'Workspace' }],
    new Map([
      [
        '/ws/z.api',
        {
          relativePath: 'z.api',
          workspaceRootPath: '/ws',
          text: 'GET /z\n',
          mtimeMs: 1,
        },
      ],
      [
        '/ws/folder/a.api',
        {
          relativePath: 'folder/a.api',
          workspaceRootPath: '/ws',
          text: '@name Alpha\nGET /a\n',
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  const roots = getTreeRoots(aggregate);
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.kind, 'collection');
  assert.equal(roots[0]?.label, LEGACY_COLLECTION_LABEL);

  const children = getTreeChildren(aggregate, roots[0]);
  assert.equal(children[0]?.kind, 'folder');
  assert.equal(children[0]?.label, 'folder');
  assert.equal(children.at(-1)?.kind, 'request');

  const folderChildren = getTreeChildren(aggregate, children[0]);
  assert.equal(folderChildren.length, 1);
  assert.equal(folderChildren[0]?.label, 'Alpha');
  assert.equal(folderChildren[0]?.method, 'GET');
  assert.equal(folderChildren[0]?.description, 'GET · /a');
  assert.equal(roots[0]?.description, '2 requests · Legacy');

  const requestId = folderChildren[0]?.requestId;
  assert.ok(requestId);
  assert.ok(findTreeNodeByRequestId(aggregate, requestId));
  const path = treePathToRequest(aggregate, requestId);
  assert.deepEqual(
    path.map((node) => node.kind),
    ['collection', 'folder', 'request'],
  );
  assert.equal(isLegacyTreeTarget(aggregate, roots[0]!), true);
  assert.equal(isLegacyTreeTarget(aggregate, folderChildren[0]!), true);
});

test('formatRequestDescription uses method middle-dot path', () => {
  assert.equal(formatRequestDescription('get', '/users'), 'GET · /users');
  assert.equal(formatRequestDescription('POST', ''), 'POST');
  assert.equal(formatRequestDescription('', '/x'), '/x');
});

test('normalizeFilterQuery trims empty queries to undefined', () => {
  assert.equal(normalizeFilterQuery(undefined), undefined);
  assert.equal(normalizeFilterQuery('  '), undefined);
  assert.equal(normalizeFilterQuery(' GET '), 'get');
});

test('getFilteredTreeChildren keeps ancestors of matching requests', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/Collections/Demo/users.api',
        {
          relativePath: 'Collections/Demo/users.api',
          workspaceRootPath: '/ws',
          text: '@name ListUsers\nGET /users\n',
          mtimeMs: 1,
        },
      ],
      [
        '/ws/Collections/Demo/nested/create.api',
        {
          relativePath: 'Collections/Demo/nested/create.api',
          workspaceRootPath: '/ws',
          text: '@name CreateUser\nPOST /users\n',
          mtimeMs: 1,
        },
      ],
      [
        '/ws/Collections/Other/health.api',
        {
          relativePath: 'Collections/Other/health.api',
          workspaceRootPath: '/ws',
          text: 'GET /health\n',
          mtimeMs: 1,
        },
      ],
    ]),
    [nativeRoot('/ws', 'Demo'), nativeRoot('/ws', 'Other')],
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();

  const filteredRoots = getFilteredTreeChildren(aggregate, undefined, 'POST');
  assert.equal(filteredRoots.length, 1);
  assert.equal(filteredRoots[0]?.label, 'Demo');

  const demoChildren = getFilteredTreeChildren(
    aggregate,
    filteredRoots[0],
    'POST',
  );
  assert.equal(demoChildren.length, 1);
  assert.equal(demoChildren[0]?.kind, 'folder');
  assert.equal(demoChildren[0]?.label, 'nested');

  const nestedChildren = getFilteredTreeChildren(
    aggregate,
    demoChildren[0],
    'POST',
  );
  assert.equal(nestedChildren.length, 1);
  assert.equal(nestedChildren[0]?.label, 'CreateUser');
  assert.equal(nestedChildren[0]?.description, 'POST · /users');

  const byName = getFilteredTreeChildren(aggregate, undefined, 'health');
  assert.equal(byName.length, 1);
  assert.equal(byName[0]?.label, 'Other');
});

test('path identity helpers normalize separators', () => {
  assert.equal(normalizePathKey('C:\\Api\\File.api'), normalizePathKey('c:/api/file.api'));
  assert.equal(
    requestIdFor('/ws/a.api', 0),
    `request:${normalizePathKey('/ws/a.api')}#0`,
  );
  assert.equal(
    legacyCollectionIdForWorkspace('/ws'),
    `collection:legacy:${normalizePathKey('/ws')}`,
  );
  assert.notEqual(
    legacyCollectionIdForWorkspace('/ws'),
    collectionIdForRoot('/ws'),
  );
});

test('collection metadata counts folders and requests', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/nested/deep/file.api',
        {
          relativePath: 'nested/deep/file.api',
          workspaceRootPath: '/ws',
          text: 'GET /x\n###\nGET /y\n',
          mtimeMs: 5,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  const collection = Object.values(aggregate.collections)[0] as Collection;
  assert.equal(collection.metadata.requestCount, 2);
  assert.equal(collection.metadata.folderCount, 2);
  assert.equal(collection.metadata.lastModified, 5);
  assert.equal(collection.metadata.workspacePath, '/ws');
});

test('empty workspace and duplicate request names remain discoverable', async () => {
  const empty = new MemoryWorkspace([], new Map());
  const emptyDiscovery = createDiscovery(empty);
  const emptyAggregate = await emptyDiscovery.refresh();
  assert.equal(Object.keys(emptyAggregate.collections).length, 0);
  assert.equal(emptyAggregate.workspaceRoots.length, 0);

  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map([
      [
        '/ws/dup.api',
        {
          relativePath: 'dup.api',
          workspaceRootPath: '/ws',
          text: [
            '@name Same',
            'GET /one',
            '###',
            '@name Same',
            'GET /two',
          ].join('\n'),
          mtimeMs: 1,
        },
      ],
    ]),
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  const collection = Object.values(aggregate.collections)[0] as Collection;
  assert.equal(collection.metadata.requestCount, 2);
  const labels = Object.values(collection.requests).map(
    (request) => request.display.label,
  );
  assert.deepEqual(labels.sort(), ['Same', 'Same']);
  assert.equal(new Set(Object.keys(collection.requests)).size, 2);
});

test('workspace with only empty Collections/ yields native collections and no Legacy', async () => {
  const memory = new MemoryWorkspace(
    [{ path: '/ws', name: 'ws' }],
    new Map(),
    [nativeRoot('/ws', 'Solo')],
  );
  const discovery = createDiscovery(memory);
  const aggregate = await discovery.refresh();
  assert.equal(Object.keys(aggregate.collections).length, 1);
  assert.equal(Object.values(aggregate.collections)[0]?.kind, 'native');
  assert.equal(
    aggregate.collections[legacyCollectionIdForWorkspace('/ws')],
    undefined,
  );
});

test('normalizeRelativePath and joinPathKey strip path-traversal segments', () => {
  assert.equal(normalizeRelativePath('a/../b'), 'a/b');
  assert.equal(normalizeRelativePath('../escape'), 'escape');
  assert.equal(normalizeRelativePath('a/./b//c/'), 'a/b/c');
  assert.equal(
    joinPathKey('/collections/Demo', '..', 'secret'),
    '/collections/Demo/secret',
  );
  assert.equal(
    joinPathKey('/collections/Demo', 'Auth/../../etc'),
    '/collections/Demo/Auth/etc',
  );
});
