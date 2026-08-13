/**
 * Project Package v1 tests: export, import, security, round-trip.
 * Scenarios are not part of the current product and must not be packaged.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';

import { COLLECTION_MARKER_FILENAME } from '../collections/constants';
import {
  exportProjectPackage,
  importProjectPackage,
  inspectProjectPackage,
  sanitizeProjectName,
} from './index';
import { packArchive, textToBytes, bytesToText } from './archive';
import { MANIFEST_ENTRY_NAME, PROJECT_PACKAGE_FORMAT_VERSION } from './constants';
import { parseManifest, sha256Hex, buildManifest } from './manifest';
import {
  isAllowedArchiveEntry,
  resolveUnderDestination,
  safePathSegments,
} from './paths';
import type { PackageDirectoryEntry, PackageFilesystem } from './ports';
import { redactApiFileText } from './redact';

class MemoryPackageFilesystem implements PackageFilesystem {
  public readonly files = new Map<string, Uint8Array>();
  public readonly dirs = new Set<string>();

  private norm(path: string): string {
    return path.replace(/\\/gu, '/').replace(/\/+$/u, '');
  }

  public async exists(path: string): Promise<boolean> {
    const key = this.norm(path);
    if (this.files.has(key) || this.dirs.has(key)) {
      return true;
    }
    const prefix = `${key}/`;
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  public async createDirectory(path: string): Promise<void> {
    const key = this.norm(path);
    const absolute = key.startsWith('/');
    const parts = key.split('/').filter((part) => part.length > 0);
    let current = absolute ? '' : '';
    for (const part of parts) {
      current = absolute ? `${current}/${part}` : current.length === 0 ? part : `${current}/${part}`;
      this.dirs.add(current);
    }
  }

  public async readBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(this.norm(path));
    if (bytes === undefined) {
      throw new Error(`ENOENT ${path}`);
    }
    return bytes;
  }

  public async writeBytes(path: string, content: Uint8Array): Promise<void> {
    const key = this.norm(path);
    const slash = key.lastIndexOf('/');
    if (slash > 0) {
      await this.createDirectory(key.slice(0, slash));
    }
    this.files.set(key, content);
  }

  public async readText(path: string): Promise<string> {
    return Buffer.from(await this.readBytes(path)).toString('utf8');
  }

  public async writeText(path: string, content: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(content, 'utf8'));
  }

  public async readDirectory(path: string): Promise<readonly PackageDirectoryEntry[]> {
    const key = this.norm(path);
    const prefix = `${key}/`;
    const children = new Map<string, 'file' | 'directory'>();
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name !== undefined && name.length > 0) {
          children.set(name, 'directory');
        }
      }
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name === undefined || name.length === 0) {
          continue;
        }
        if (rest.includes('/')) {
          children.set(name, 'directory');
        } else if (!children.has(name)) {
          children.set(name, 'file');
        }
      }
    }
    return [...children.entries()].map(([name, type]) => ({ name, type }));
  }

  public async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    const key = this.norm(path);
    if (options?.recursive === true) {
      const prefix = `${key}/`;
      for (const file of [...this.files.keys()]) {
        if (file === key || file.startsWith(prefix)) {
          this.files.delete(file);
        }
      }
      for (const dir of [...this.dirs]) {
        if (dir === key || dir.startsWith(prefix)) {
          this.dirs.delete(dir);
        }
      }
      return;
    }
    this.files.delete(key);
    this.dirs.delete(key);
  }
}

const ROOT = '/ws';

async function seedMinimalProject(
  fs: MemoryPackageFilesystem,
): Promise<void> {
  await fs.writeText(
    `${ROOT}/.apihero/config.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      projectId: 'proj-1',
      collectionsDirectory: 'Collections',
    }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/.apihero/workspace.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      activeEnvironmentId: 'dev',
      variables: [
        { name: 'baseUrl', value: 'https://example.test' },
        { name: 'token', value: '', sensitive: true },
      ],
    }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/.apihero/environments/dev.json`,
    `${JSON.stringify({
      id: 'dev',
      name: 'Development',
      variables: [
        { name: 'host', value: 'example.test' },
        { name: 'password', value: 'should-not-pack', sensitive: true },
      ],
    }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/.apihero/auth/profiles.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      profiles: [
        {
          id: 'bearer-1',
          label: 'Bearer',
          providerId: 'bearer',
          token: { kind: 'literal', value: 'super-secret-bearer' },
        },
      ],
    }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/.apihero/local/variables.local.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      workspace: { token: 'workspace-secret-value' },
      environments: { dev: { password: 'env-secret-value' } },
    }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/.apihero/scenarios/hidden.scenario.json`,
    '{"schemaVersion":"1.0.0","name":"Hidden"}\n',
  );
  await fs.writeText(
    `${ROOT}/Collections/Demo/${COLLECTION_MARKER_FILENAME}`,
    `${JSON.stringify({ name: 'Demo' }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/Collections/Demo/api-hero.variables.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      variables: [
        { name: 'collVar', value: 'public' },
        { name: 'collSecret', value: 'packed-secret', sensitive: true },
      ],
    }, undefined, 2)}\n`,
  );
  await fs.writeText(
    `${ROOT}/Collections/Demo/.env`,
    'API_KEY=should-not-pack-env-file\n',
  );
  await fs.writeText(
    `${ROOT}/Collections/Demo/secret.pem`,
    '-----BEGIN PRIVATE KEY-----\nshould-not-pack-pem\n',
  );
  await fs.writeText(
    `${ROOT}/Collections/Demo/auth/Login.api`,
    [
      '@name Login',
      '@sensitive-variable token=sekrit-request-value',
      '',
      'GET https://user:pass@example.test/users/1?api_key=super-secret-query',
      'Authorization: Bearer super-secret-bearer',
      'X-Api-Key: literal-header-secret',
      'Cookie: session=abc',
      '',
    ].join('\n'),
  );
}

test('safePathSegments rejects traversal, absolute, and reserved names', () => {
  assert.equal(safePathSegments('../file'), undefined);
  assert.equal(safePathSegments('../../file'), undefined);
  assert.equal(safePathSegments('/external/file'), undefined);
  assert.equal(safePathSegments('C:/external/file'), undefined);
  assert.equal(safePathSegments('C:\\external\\file'), undefined);
  assert.equal(safePathSegments('foo/../bar'), undefined);
  assert.equal(safePathSegments('foo\\..\\bar'), undefined);
  assert.equal(safePathSegments('CON/file'), undefined);
  assert.equal(isAllowedArchiveEntry('manifest.json'), true);
  assert.equal(isAllowedArchiveEntry('project/Collections/a.api'), true);
  assert.equal(isAllowedArchiveEntry('../etc/passwd'), false);
  assert.equal(
    resolveUnderDestination('/dest', '../../file'),
    undefined,
  );
  assert.equal(
    resolveUnderDestination('/dest', 'Collections/Demo/a.api')?.endsWith(
      '/dest/Collections/Demo/a.api',
    ),
    true,
  );
});

test('export then import round-trips supported artifacts and redacts secrets', async () => {
  const source = new MemoryPackageFilesystem();
  await seedMinimalProject(source);
  const exported = await exportProjectPackage(source, ROOT, 'Demo Project');
  assert.equal(exported.ok, true);
  if (!exported.ok) {
    return;
  }
  const packed = bytesToText(exported.value.bytes);
  assert.equal(packed.includes('workspace-secret-value'), false);
  assert.equal(packed.includes('env-secret-value'), false);
  assert.equal(packed.includes('super-secret-bearer'), false);
  assert.equal(packed.includes('literal-header-secret'), false);
  assert.equal(packed.includes('super-secret-query'), false);
  assert.equal(packed.includes('should-not-pack'), false);
  assert.equal(packed.includes('packed-secret'), false);
  assert.equal(packed.includes('sekrit-request-value'), false);
  assert.equal(packed.includes('hidden.scenario'), false);
  assert.equal(packed.includes('.apihero/local/'), false);
  assert.equal(packed.includes('.apihero/scenarios/'), false);
  assert.equal(packed.includes('should-not-pack-env-file'), false);
  assert.equal(packed.includes('should-not-pack-pem'), false);

  const destination = new MemoryPackageFilesystem();
  await destination.writeText(
    '/out/.apihero/local/variables.local.json',
    '{"schemaVersion":1,"workspace":{"keep":"local-secret"}}\n',
  );
  const imported = await importProjectPackage(
    destination,
    '/out',
    exported.value.bytes,
  );
  assert.equal(imported.ok, true);
  if (!imported.ok) {
    return;
  }
  const config = JSON.parse(await destination.readText('/out/.apihero/config.json')) as {
    projectId: string;
    collectionsDirectory: string;
  };
  assert.equal(config.projectId, 'proj-1');
  assert.equal(config.collectionsDirectory, 'Collections');
  assert.equal(
    await destination.exists('/out/Collections/Demo/auth/Login.api'),
    true,
  );
  const api = await destination.readText('/out/Collections/Demo/auth/Login.api');
  assert.match(api, /Authorization: \{\{token\}\}/u);
  assert.match(api, /X-Api-Key: \{\{api_key\}\}/u);
  assert.match(api, /Cookie: \{\{cookie\}\}/u);
  assert.equal(api.includes('super-secret-bearer'), false);
  const env = JSON.parse(
    await destination.readText('/out/.apihero/environments/dev.json'),
  ) as { variables: { name: string; value: string }[] };
  const password = env.variables.find((item) => item.name === 'password');
  assert.equal(password?.value, '');
  const auth = await destination.readText('/out/.apihero/auth/profiles.json');
  assert.equal(auth.includes('super-secret-bearer'), false);
  assert.equal(auth.includes('"kind": "secret"') || auth.includes('"kind":"secret"'), true);
  assert.equal(await destination.exists('/out/.apihero/scenarios/hidden.scenario.json'), false);
  assert.equal(await destination.exists('/out/Collections/Demo/.env'), false);
  assert.equal(await destination.exists('/out/Collections/Demo/secret.pem'), false);
  assert.equal(
    await destination.readText('/out/.apihero/local/variables.local.json'),
    '{"schemaVersion":1,"workspace":{"keep":"local-secret"}}\n',
  );
  const collVars = JSON.parse(
    await destination.readText('/out/Collections/Demo/api-hero.variables.json'),
  ) as { variables: { name: string; value: string }[] };
  assert.equal(
    collVars.variables.find((item) => item.name === 'collSecret')?.value,
    '',
  );
});

test('nested collections and legacy .api files are preserved', async () => {
  const source = new MemoryPackageFilesystem();
  await source.writeText(
    `${ROOT}/.apihero/config.json`,
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  await source.writeText(
    `${ROOT}/Collections/Shop/users/Get-User.api`,
    '@name Get User\n\nGET https://example.test/users/1\n',
  );
  await source.writeText(
    `${ROOT}/orphan.api`,
    '@name Orphan\n\nGET https://example.test/orphan\n',
  );
  const exported = await exportProjectPackage(source, ROOT, 'Nested');
  assert.equal(exported.ok, true);
  if (!exported.ok) {
    return;
  }
  const dest = new MemoryPackageFilesystem();
  const imported = await importProjectPackage(dest, '/out', exported.value.bytes);
  assert.equal(imported.ok, true);
  assert.equal(await dest.exists('/out/Collections/Shop/users/Get-User.api'), true);
  assert.equal(await dest.exists('/out/orphan.api'), true);
});

test('missing manifest, malformed manifest, and unsupported version fail closed', async () => {
  const missing = zipSync({ 'project/a.api': strToU8('GET /') });
  const missingResult = await inspectProjectPackage(missing);
  assert.equal(missingResult.ok, false);
  if (missingResult.ok) {
    return;
  }
  assert.equal(missingResult.code, 'missing-manifest');

  const malformed = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes('{not json'),
  });
  const malformedResult = await inspectProjectPackage(malformed);
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) {
    assert.equal(malformedResult.code, 'malformed-manifest');
  }

  const unsupported = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(
      `${JSON.stringify({
        format: 'apihero-project',
        kind: 'project',
        formatVersion: PROJECT_PACKAGE_FORMAT_VERSION + 1,
        projectName: 'X',
        createdAt: '2026-01-01T00:00:00.000Z',
        apiHeroVersion: '2.11.0',
        collectionsDirectory: 'Collections',
        files: [],
      })}\n`,
    ),
  });
  const unsupportedResult = await inspectProjectPackage(unsupported);
  assert.equal(unsupportedResult.ok, false);
  if (!unsupportedResult.ok) {
    assert.equal(unsupportedResult.code, 'unsupported-version');
  }
});

test('path traversal and extra archive entries are rejected', async () => {
  const traversal = zipSync({
    [MANIFEST_ENTRY_NAME]: strToU8('{}'),
    '../evil.txt': strToU8('nope'),
  });
  const traversalResult = await inspectProjectPackage(traversal);
  assert.equal(traversalResult.ok, false);
  if (!traversalResult.ok) {
    assert.equal(traversalResult.code, 'unsafe-package');
  }

  const windowsAbs = zipSync({
    [MANIFEST_ENTRY_NAME]: strToU8('{}'),
    'C:/external/file.api': strToU8('GET /'),
  });
  const windowsResult = await inspectProjectPackage(windowsAbs);
  assert.equal(windowsResult.ok, false);

  const payload = textToBytes('@name X\nGET https://example.test\n');
  const archivePath = 'project/Collections/Demo/a.api';
  const configPath = 'project/.apihero/config.json';
  const configBytes = textToBytes(
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  const manifest = buildManifest({
    projectName: 'X',
    createdAt: '2026-01-01T00:00:00.000Z',
    apiHeroVersion: '2.11.0',
    collectionsDirectory: 'Collections',
    files: [
      { path: configPath, sha256: sha256Hex(configBytes) },
      { path: archivePath, sha256: sha256Hex(payload) },
    ],
  });
  const stuffed = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(`${JSON.stringify(manifest)}\n`),
    [configPath]: configBytes,
    [archivePath]: payload,
    'project/Collections/Demo/extra.api': textToBytes('GET /sneak\n'),
  });
  const stuffedResult = await inspectProjectPackage(stuffed);
  assert.equal(stuffedResult.ok, false);
  if (!stuffedResult.ok) {
    assert.equal(stuffedResult.code, 'corrupt-package');
  }
});

test('destination conflict requires overwrite; overwrite replaces collections and keeps local/', async () => {
  const source = new MemoryPackageFilesystem();
  await source.writeText(
    `${ROOT}/.apihero/config.json`,
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  await source.writeText(
    `${ROOT}/Collections/Demo/Ping.api`,
    '@name Ping\nGET https://example.test/ping\n',
  );
  const exported = await exportProjectPackage(source, ROOT, 'Conflict');
  assert.equal(exported.ok, true);
  if (!exported.ok) {
    return;
  }
  const dest = new MemoryPackageFilesystem();
  await dest.writeText(
    '/out/.apihero/config.json',
    '{"schemaVersion":1,"projectId":"old","collectionsDirectory":"Collections"}\n',
  );
  await dest.writeText('/out/Collections/Old/stale.api', 'GET https://example.test/old\n');
  await dest.writeText('/out/.apihero/local/keep.json', '{"ok":true}\n');
  const blocked = await importProjectPackage(dest, '/out', exported.value.bytes);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, 'destination-conflict');
  }
  const replaced = await importProjectPackage(dest, '/out', exported.value.bytes, {
    overwrite: true,
  });
  assert.equal(replaced.ok, true);
  assert.equal(await dest.exists('/out/Collections/Demo/Ping.api'), true);
  assert.equal(await dest.exists('/out/Collections/Old/stale.api'), false);
  assert.equal(await dest.exists('/out/.apihero/local/keep.json'), true);
});

test('overwrite replaces package-owned roots and preserves unrelated destination files', async () => {
  const source = new MemoryPackageFilesystem();
  await source.writeText(
    `${ROOT}/.apihero/config.json`,
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  await source.writeText(
    `${ROOT}/Collections/Demo/Ping.api`,
    '@name Ping\nGET https://example.test/ping\n',
  );
  const exported = await exportProjectPackage(source, ROOT, 'Owned');
  assert.equal(exported.ok, true);
  if (!exported.ok) {
    return;
  }
  const dest = new MemoryPackageFilesystem();
  await dest.writeText(
    '/out/.apihero/config.json',
    '{"schemaVersion":1,"projectId":"old","collectionsDirectory":"Collections"}\n',
  );
  await dest.writeText('/out/Collections/Old/stale.api', 'GET https://example.test/old\n');
  await dest.writeText('/out/unrelated-user-file.txt', 'keep-me\n');
  await dest.writeText('/out/unrelated-folder/notes.txt', 'also-keep\n');
  const cancelled = await importProjectPackage(dest, '/out', exported.value.bytes);
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) {
    assert.equal(cancelled.code, 'destination-conflict');
  }
  assert.equal(await dest.readText('/out/unrelated-user-file.txt'), 'keep-me\n');
  assert.equal(await dest.readText('/out/unrelated-folder/notes.txt'), 'also-keep\n');
  assert.equal(await dest.exists('/out/Collections/Old/stale.api'), true);
  const configBefore = JSON.parse(await dest.readText('/out/.apihero/config.json')) as {
    projectId: string;
  };
  assert.equal(configBefore.projectId, 'old');

  const replaced = await importProjectPackage(dest, '/out', exported.value.bytes, {
    overwrite: true,
  });
  assert.equal(replaced.ok, true);
  assert.equal(await dest.exists('/out/Collections/Demo/Ping.api'), true);
  assert.equal(await dest.exists('/out/Collections/Old/stale.api'), false);
  assert.equal(await dest.readText('/out/unrelated-user-file.txt'), 'keep-me\n');
  assert.equal(await dest.readText('/out/unrelated-folder/notes.txt'), 'also-keep\n');
  assert.equal(await dest.exists('/out/.apihero/.pkg-import'), false);
});

test('checksum mismatch does not restore any destination files', async () => {
  const configPath = 'project/.apihero/config.json';
  const configBytes = textToBytes(
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  const apiPath = 'project/Collections/Demo/a.api';
  const apiBytes = textToBytes('@name X\nGET https://example.test\n');
  const manifest = buildManifest({
    projectName: 'X',
    createdAt: '2026-01-01T00:00:00.000Z',
    apiHeroVersion: '2.11.0',
    collectionsDirectory: 'Collections',
    files: [
      { path: configPath, sha256: sha256Hex(configBytes) },
      { path: apiPath, sha256: sha256Hex(apiBytes) },
    ],
  });
  const mismatched = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(`${JSON.stringify(manifest)}\n`),
    [configPath]: configBytes,
    [apiPath]: textToBytes('@name Tampered\nGET https://example.test\n'),
  });
  const dest = new MemoryPackageFilesystem();
  await dest.writeText('/out/unrelated-user-file.txt', 'keep-me\n');
  const result = await importProjectPackage(dest, '/out', mismatched);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'corrupt-package');
  }
  assert.equal(await dest.exists('/out/.apihero/config.json'), false);
  assert.equal(await dest.exists('/out/Collections/Demo/a.api'), false);
  assert.equal(await dest.readText('/out/unrelated-user-file.txt'), 'keep-me\n');
});

test('sanitizeProjectName strips invalid filename characters', () => {
  assert.equal(sanitizeProjectName('My API Project'), 'My API Project');
  assert.equal(sanitizeProjectName('My/API:Project'), 'My-API-Project');
  assert.equal(sanitizeProjectName('   '), 'API-Hero-Project');
});

test('normalized duplicate archive paths are rejected', async () => {
  const configPath = 'project/.apihero/config.json';
  const configBytes = textToBytes(
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  const apiBytes = textToBytes('@name X\nGET https://example.test\n');
  const manifest = buildManifest({
    projectName: 'X',
    createdAt: '2026-01-01T00:00:00.000Z',
    apiHeroVersion: '2.11.0',
    collectionsDirectory: 'Collections',
    files: [
      { path: configPath, sha256: sha256Hex(configBytes) },
      { path: 'project/Collections/a.api', sha256: sha256Hex(apiBytes) },
    ],
  });
  const duplicate = zipSync({
    [MANIFEST_ENTRY_NAME]: strToU8(`${JSON.stringify(manifest)}\n`),
    [configPath]: configBytes,
    'project/Collections/a.api': apiBytes,
    'project/./Collections/a.api': strToU8('@name Evil\nGET https://example.test\n'),
  });
  const result = await inspectProjectPackage(duplicate);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'unsafe-package');
  }
});

test('invalid format identifier is rejected', async () => {
  const packed = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(
      `${JSON.stringify({
        format: 'zip',
        kind: 'project',
        formatVersion: 1,
        projectName: 'X',
        createdAt: '2026-01-01T00:00:00.000Z',
        apiHeroVersion: '2.11.0',
        collectionsDirectory: 'Collections',
        files: [],
      })}\n`,
    ),
  });
  const result = await inspectProjectPackage(packed);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'invalid-package');
  }
});

test('export without a project store fails with no-project', async () => {
  const empty = new MemoryPackageFilesystem();
  const result = await exportProjectPackage(empty, ROOT, 'Empty');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'no-project');
  }
});

test('redactApiFileText replaces Authorization, cookies, and URL secrets', () => {
  const redacted = redactApiFileText(
    [
      'GET https://user:secret@example.test/x?api_key=abcd',
      'Authorization: Bearer abcdefghijklmnop',
      'Cookie: a=1',
    ].join('\n'),
  );
  assert.equal(redacted.includes('secret'), false);
  assert.equal(redacted.includes('abcdefghijklmnop'), false);
  assert.match(redacted, /Authorization: \{\{token\}\}/u);
  assert.match(redacted, /Cookie: \{\{cookie\}\}/u);
});

test('redactApiFileText redacts @sensitive-variable and disabled headers', () => {
  const redacted = redactApiFileText(
    [
      '@sensitive-variable token=sekrit-request-value',
      '@name Login',
      '',
      'GET https://example.test/login',
      '# Authorization: Bearer disabled-secret',
      '// Cookie: session=disabled-cookie',
    ].join('\n'),
  );
  assert.equal(redacted.includes('sekrit-request-value'), false);
  assert.equal(redacted.includes('disabled-secret'), false);
  assert.equal(redacted.includes('disabled-cookie'), false);
  assert.match(redacted, /@sensitive-variable token=$/mu);
  assert.match(redacted, /# Authorization: \{\{token\}\}/u);
  assert.match(redacted, /\/\/ Cookie: \{\{cookie\}\}/u);
});

test('parseManifest rejects unknown kind', () => {
  assert.throws(() => {
    parseManifest(
      JSON.stringify({
        format: 'apihero-project',
        kind: 'collection',
        formatVersion: 1,
        projectName: 'X',
        createdAt: '2026-01-01T00:00:00.000Z',
        apiHeroVersion: '2.11.0',
        collectionsDirectory: 'Collections',
        files: [],
      }),
    );
  });
});

test('unpackArchive rejects corrupt bytes', async () => {
  const result = await inspectProjectPackage(new Uint8Array([1, 2, 3, 4]));
  assert.equal(result.ok, false);
});

test('checksum mismatch and missing listed files fail closed', async () => {
  const configPath = 'project/.apihero/config.json';
  const configBytes = textToBytes(
    '{"schemaVersion":1,"projectId":"p","collectionsDirectory":"Collections"}\n',
  );
  const apiPath = 'project/Collections/Demo/a.api';
  const apiBytes = textToBytes('@name X\nGET https://example.test\n');
  const manifest = buildManifest({
    projectName: 'X',
    createdAt: '2026-01-01T00:00:00.000Z',
    apiHeroVersion: '2.11.0',
    collectionsDirectory: 'Collections',
    files: [
      { path: configPath, sha256: sha256Hex(configBytes) },
      { path: apiPath, sha256: sha256Hex(apiBytes) },
    ],
  });
  const mismatched = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(`${JSON.stringify(manifest)}\n`),
    [configPath]: configBytes,
    [apiPath]: textToBytes('@name Tampered\nGET https://example.test\n'),
  });
  const mismatchResult = await inspectProjectPackage(mismatched);
  assert.equal(mismatchResult.ok, false);
  if (!mismatchResult.ok) {
    assert.equal(mismatchResult.code, 'corrupt-package');
  }

  const missingFile = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(`${JSON.stringify(manifest)}\n`),
    [configPath]: configBytes,
  });
  const missingResult = await inspectProjectPackage(missingFile);
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) {
    assert.equal(missingResult.code, 'corrupt-package');
  }
});

test('malformed formatVersion is rejected', async () => {
  const packed = packArchive({
    [MANIFEST_ENTRY_NAME]: textToBytes(
      `${JSON.stringify({
        format: 'apihero-project',
        kind: 'project',
        formatVersion: '1',
        projectName: 'X',
        createdAt: '2026-01-01T00:00:00.000Z',
        apiHeroVersion: '2.11.0',
        collectionsDirectory: 'Collections',
        files: [],
      })}\n`,
    ),
  });
  const result = await inspectProjectPackage(packed);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'malformed-manifest');
  }
});

test('redactApiFileText redacts refresh_token query values', () => {
  const redacted = redactApiFileText(
    'GET https://example.test/token?refresh_token=rt-secret-value',
  );
  assert.equal(redacted.includes('rt-secret-value'), false);
  assert.match(redacted, /refresh_token=\{\{api_key\}\}/u);
});
