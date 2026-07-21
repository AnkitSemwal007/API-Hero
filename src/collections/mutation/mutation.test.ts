import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTION_MARKER_FILENAME,
  COLLECTIONS_DIRECTORY_NAME,
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
  collectionIdForRoot,
  normalizeOrderMap,
  parseCollectionMarker,
  type ApiFileReader,
  type DiscoveredApiFile,
  type DiscoveredCollectionRoot,
  type WorkspaceScanResult,
  type WorkspaceScanner,
} from '../index';
import {
  CollectionMutationService,
  allocateUniqueName,
  buildPlaceholderRequestSource,
  collectionMarkerPath,
  collectionRootPath,
  sanitizeDirectoryName,
  sanitizeRequestFileName,
  type CollectionDirectoryEntry,
  type CollectionFilesystem,
} from './index';

class MemoryFs implements CollectionFilesystem {
  public readonly files = new Map<string, string>();
  public readonly directories = new Set<string>();

  public async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  public async createDirectory(path: string): Promise<void> {
    this.directories.add(path.replace(/\/+$/, ''));
    const parts = path.replace(/\/+$/, '').split('/');
    for (let i = 1; i < parts.length; i += 1) {
      this.directories.add(parts.slice(0, i + 1).join('/'));
    }
  }

  public async readText(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return text;
  }

  public async writeText(path: string, content: string): Promise<void> {
    await this.createDirectory(path.replace(/\/[^/]+$/, ''));
    this.files.set(path, content);
  }

  public async delete(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }
    if (options?.recursive === true) {
      const prefix = `${path.replace(/\/+$/, '')}/`;
      for (const key of [...this.files.keys()]) {
        if (key === path || key.startsWith(prefix)) {
          this.files.delete(key);
        }
      }
      for (const key of [...this.directories]) {
        if (key === path || key.startsWith(prefix)) {
          this.directories.delete(key);
        }
      }
      this.directories.delete(path.replace(/\/+$/, ''));
    }
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.files.has(oldPath)) {
      const text = this.files.get(oldPath)!;
      this.files.delete(oldPath);
      await this.writeText(newPath, text);
      return;
    }
    const oldPrefix = `${oldPath.replace(/\/+$/, '')}/`;
    const newPrefix = `${newPath.replace(/\/+$/, '')}/`;
    const fileMoves: Array<[string, string]> = [];
    for (const key of this.files.keys()) {
      if (key === oldPath || key.startsWith(oldPrefix)) {
        fileMoves.push([
          key,
          key === oldPath ? newPath : `${newPrefix}${key.slice(oldPrefix.length)}`,
        ]);
      }
    }
    for (const [from, to] of fileMoves) {
      const text = this.files.get(from)!;
      this.files.delete(from);
      await this.writeText(to, text);
    }
    const dirMoves = [...this.directories].filter(
      (key) => key === oldPath || key.startsWith(oldPrefix),
    );
    for (const key of dirMoves) {
      this.directories.delete(key);
      const next =
        key === oldPath ? newPath : `${newPrefix}${key.slice(oldPrefix.length)}`;
      this.directories.add(next.replace(/\/+$/, ''));
    }
    this.directories.add(newPath.replace(/\/+$/, ''));
  }

  public async copy(oldPath: string, newPath: string): Promise<void> {
    if (this.files.has(oldPath)) {
      await this.writeText(newPath, this.files.get(oldPath)!);
      return;
    }
    const oldPrefix = `${oldPath.replace(/\/+$/, '')}/`;
    const newPrefix = `${newPath.replace(/\/+$/, '')}/`;
    await this.createDirectory(newPath);
    for (const [key, text] of this.files) {
      if (key.startsWith(oldPrefix)) {
        await this.writeText(`${newPrefix}${key.slice(oldPrefix.length)}`, text);
      }
    }
  }

  public async readDirectory(
    path: string,
  ): Promise<readonly CollectionDirectoryEntry[]> {
    const prefix = `${path.replace(/\/+$/, '')}/`;
    const names = new Map<string, 'file' | 'directory'>();
    for (const key of this.directories) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name !== undefined && name.length > 0) {
          names.set(name, 'directory');
        }
      }
    }
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name !== undefined && name.length > 0 && !rest.includes('/')) {
          names.set(name, 'file');
        } else if (name !== undefined && name.length > 0 && !names.has(name)) {
          names.set(name, 'directory');
        }
      }
    }
    return [...names.entries()].map(([name, type]) => ({ name, type }));
  }
}

class MemoryScanAdapter implements WorkspaceScanner, ApiFileReader {
  public constructor(private readonly fs: MemoryFs, private readonly workspaceRoot: string) {}

  public scan(): WorkspaceScanResult {
    const apiFiles: DiscoveredApiFile[] = [];
    const collectionRoots: DiscoveredCollectionRoot[] = [];
    const collectionsPrefix = `${this.workspaceRoot}/${COLLECTIONS_DIRECTORY_NAME}/`;
    for (const dir of this.fs.directories) {
      if (
        dir.startsWith(collectionsPrefix) &&
        !dir.slice(collectionsPrefix.length).includes('/')
      ) {
        const name = dir.slice(collectionsPrefix.length);
        const markerPath = `${dir}/${COLLECTION_MARKER_FILENAME}`;
        collectionRoots.push({
          path: dir,
          name,
          workspaceRootPath: this.workspaceRoot,
          relativePath: `${COLLECTIONS_DIRECTORY_NAME}/${name}`,
          ...(this.fs.files.has(markerPath) ? { markerPath } : {}),
        });
      }
    }
    for (const [path, text] of this.fs.files) {
      if (!path.endsWith('.api')) {
        continue;
      }
      apiFiles.push({
        path,
        relativePath: path.slice(this.workspaceRoot.length + 1),
        workspaceRootPath: this.workspaceRoot,
        mtimeMs: 1,
      });
      void text;
    }
    return {
      folders: [{ path: this.workspaceRoot, name: 'ws' }],
      apiFiles,
      collectionRoots,
      issues: [],
    };
  }

  public readText(path: string): string {
    const text = this.fs.files.get(path);
    if (text === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return text;
  }
}

test('sanitize helpers reject unsafe path segments', () => {
  assert.equal(sanitizeDirectoryName('Good Name'), 'Good Name');
  assert.equal(sanitizeDirectoryName('../x'), undefined);
  assert.equal(sanitizeDirectoryName('a/b'), undefined);
  assert.equal(sanitizeRequestFileName('Login'), 'Login.api');
  assert.equal(sanitizeRequestFileName('Login.api'), 'Login.api');
  assert.equal(sanitizeRequestFileName(''), undefined);
});

test('allocateUniqueName appends numeric suffixes', () => {
  const existing = new Set(['A', 'A (2)']);
  assert.equal(
    allocateUniqueName('A', (name) => existing.has(name)),
    'A (3)',
  );
  assert.equal(
    allocateUniqueName('B.api', (name) => name === 'B.api'),
    'B (2).api',
  );
});

test('buildPlaceholderRequestSource embeds @name', () => {
  assert.match(
    buildPlaceholderRequestSource('Login'),
    /@name Login\n\nGET https:\/\/httpbin\.org\/get\n/,
  );
});

test('createCollection writes Collections/<Name>/ + marker', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  const result = await mutation.createCollection(workspaceRoot, 'User APIs');
  const root = collectionRootPath(workspaceRoot, 'User APIs');
  assert.equal(result.rootPath, root);
  assert.equal(result.collectionId, collectionIdForRoot(root));
  assert.equal(await fs.exists(root), true);
  const markerText = await fs.readText(collectionMarkerPath(root));
  const marker = parseCollectionMarker(markerText);
  assert.equal(marker?.name, 'User APIs');
  assert.equal(marker?.order, 0);

  const aggregate = discovery.snapshot!;
  assert.ok(aggregate.collections[result.collectionId]);
  assert.equal(
    aggregate.collections[result.collectionId]?.display.label,
    'User APIs',
  );
});

test('createFolder and createRequest update marker order and discovery', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  const created = await mutation.createCollection(workspaceRoot, 'Demo');
  await mutation.createFolder(created.collectionId, '', 'Auth');
  const request = await mutation.createRequest(
    created.collectionId,
    'Auth',
    'Login',
  );

  assert.equal(
    request.filePath,
    `${created.rootPath}/Auth/Login.api`,
  );
  const source = await fs.readText(request.filePath);
  assert.match(source, /@name Login/);

  const custom = await mutation.createRequest(
    created.collectionId,
    'Auth',
    'Logout',
    `@name Logout\n\nPOST https://example.test/logout\n`,
  );
  assert.equal(
    await fs.readText(custom.filePath),
    `@name Logout\n\nPOST https://example.test/logout\n`,
  );

  const marker = parseCollectionMarker(
    await fs.readText(collectionMarkerPath(created.rootPath)),
  );
  assert.deepEqual(marker?.folderOrder, ['Auth']);
  assert.deepEqual(marker?.requestOrder, {
    Auth: ['Login.api', 'Logout.api'],
  });

  const collection = discovery.snapshot!.collections[created.collectionId]!;
  const auth = Object.values(collection.folders).find(
    (folder) => folder.relativePath === 'Auth',
  );
  assert.ok(auth);
  assert.equal(auth.requestIds.length, 2);
});

test('reorderCollections writes numeric order on markers', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  await mutation.createCollection(workspaceRoot, 'Alpha');
  await mutation.createCollection(workspaceRoot, 'Beta');
  await mutation.reorderCollections(workspaceRoot, ['Beta', 'Alpha']);

  const betaMarker = parseCollectionMarker(
    await fs.readText(
      collectionMarkerPath(collectionRootPath(workspaceRoot, 'Beta')),
    ),
  );
  const alphaMarker = parseCollectionMarker(
    await fs.readText(
      collectionMarkerPath(collectionRootPath(workspaceRoot, 'Alpha')),
    ),
  );
  assert.equal(betaMarker?.order, 0);
  assert.equal(alphaMarker?.order, 1);

  const ids = discovery.snapshot!.workspaceRoots[0]!.collectionIds;
  assert.equal(
    discovery.snapshot!.collections[ids[0]!]?.display.label,
    'Beta',
  );
  assert.equal(
    discovery.snapshot!.collections[ids[1]!]?.display.label,
    'Alpha',
  );
});

test('moveRequest from legacy into native updates target marker', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  await fs.writeText(`${workspaceRoot}/orphan.api`, '@name Orphan\nGET /x\n');
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  await discovery.refresh();
  const created = await mutation.createCollection(workspaceRoot, 'Home');
  const legacy = Object.values(discovery.snapshot!.collections).find(
    (collection) => collection.kind === 'legacy',
  )!;
  const legacyRequest = Object.values(legacy.requests)[0]!;

  const moved = await mutation.moveRequest(
    legacy.id,
    legacyRequest.filePath,
    created.collectionId,
    '',
  );
  assert.equal(moved.filePath, `${created.rootPath}/orphan.api`);
  assert.equal(await fs.exists(`${workspaceRoot}/orphan.api`), false);
  const marker = parseCollectionMarker(
    await fs.readText(collectionMarkerPath(created.rootPath)),
  );
  assert.deepEqual(marker?.requestOrder, { '.': ['orphan.api'] });
});

test('cross-collection moveFolder remaps nested folderOrder and requestOrder', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  const source = await mutation.createCollection(workspaceRoot, 'Source');
  const target = await mutation.createCollection(workspaceRoot, 'Target');
  await mutation.createFolder(source.collectionId, '', 'Auth');
  await mutation.createFolder(source.collectionId, 'Auth', 'Nested');
  await mutation.createRequest(source.collectionId, 'Auth', 'Login');
  await mutation.createRequest(source.collectionId, 'Auth/Nested', 'Deep');

  const moved = await mutation.moveFolder(
    source.collectionId,
    'Auth',
    target.collectionId,
    '',
  );
  assert.equal(moved.relativePath, 'Auth');
  assert.equal(await fs.exists(`${source.rootPath}/Auth`), false);
  assert.equal(await fs.exists(`${target.rootPath}/Auth/Login.api`), true);
  assert.equal(
    await fs.exists(`${target.rootPath}/Auth/Nested/Deep.api`),
    true,
  );

  const sourceMarker = parseCollectionMarker(
    await fs.readText(collectionMarkerPath(source.rootPath)),
  );
  const targetMarker = parseCollectionMarker(
    await fs.readText(collectionMarkerPath(target.rootPath)),
  );
  const sourceFolderOrder = normalizeOrderMap(sourceMarker?.folderOrder);
  const sourceRequestOrder = normalizeOrderMap(sourceMarker?.requestOrder);
  assert.equal(sourceFolderOrder['Auth'], undefined);
  assert.equal(sourceRequestOrder['Auth'], undefined);
  assert.deepEqual(normalizeOrderMap(targetMarker?.folderOrder), {
    '.': ['Auth'],
    Auth: ['Nested'],
  });
  assert.deepEqual(normalizeOrderMap(targetMarker?.requestOrder), {
    Auth: ['Login.api'],
    'Auth/Nested': ['Deep.api'],
  });
});

test('exportCollection copies tree and marker to destination', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  const created = await mutation.createCollection(workspaceRoot, 'Pets');
  await mutation.createRequest(created.collectionId, '', 'List');
  const exported = await mutation.exportCollection(
    created.collectionId,
    '/exports',
  );
  assert.equal(exported.exportPath, '/exports/Pets');
  assert.equal(await fs.exists('/exports/Pets/api-hero.collection.json'), true);
  assert.equal(await fs.exists('/exports/Pets/List.api'), true);
});

test('importCollection copies into Collections/ and refreshes discovery', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  await fs.createDirectory('/bundle/Shared');
  await fs.writeText(
    '/bundle/api-hero.collection.json',
    `${JSON.stringify({ name: 'Shared APIs' }, undefined, 2)}\n`,
  );
  await fs.writeText('/bundle/ping.api', '@name Ping\nGET /ping\n');

  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  const imported = await mutation.importCollection(workspaceRoot, '/bundle');
  assert.equal(imported.rootPath, `${workspaceRoot}/Collections/Shared APIs`);
  assert.equal(
    await fs.exists(`${imported.rootPath}/api-hero.collection.json`),
    true,
  );
  assert.equal(await fs.exists(`${imported.rootPath}/ping.api`), true);
  const collection = discovery.snapshot!.collections[imported.collectionId];
  assert.ok(collection);
  assert.equal(collection.kind, 'native');
  assert.equal(collection.display.label, 'Shared APIs');
});

test('importCollection renames on collision when requested', async () => {
  const fs = new MemoryFs();
  const workspaceRoot = '/ws';
  const adapter = new MemoryScanAdapter(fs, workspaceRoot);
  const repository = new InMemoryCollectionRepository();
  const discovery = new CollectionDiscoveryService({
    scanner: adapter,
    reader: adapter,
    repository,
  });
  const mutation = new CollectionMutationService({
    filesystem: fs,
    getSnapshot: () => discovery.snapshot,
    refresh: () => discovery.refresh(),
  });

  await mutation.createCollection(workspaceRoot, 'Pets');
  await fs.writeText(
    '/incoming/api-hero.collection.json',
    `${JSON.stringify({ name: 'Pets' }, undefined, 2)}\n`,
  );
  await fs.writeText('/incoming/get.api', '@name Get\nGET /\n');

  const imported = await mutation.importCollection(workspaceRoot, '/incoming', {
    collision: 'rename',
  });
  assert.equal(imported.rootPath, `${workspaceRoot}/Collections/Pets (2)`);
});
