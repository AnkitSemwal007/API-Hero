import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  PostmanImportProvider,
  createDefaultImportProviderRegistry,
  maskImportSecretText,
  runImportPipeline,
  type WorkspaceFileWriter,
} from '../index';
import { isPostmanCollectionRoot, parsePostmanCollection } from './parse';

const SCHEMA_V21 =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

function minimalCollection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    info: {
      name: 'Demo API',
      schema: SCHEMA_V21,
      version: '1.0.0',
    },
    item: [
      {
        name: 'List users',
        request: {
          method: 'GET',
          header: [{ key: 'Accept', value: 'application/json' }],
          url: '{{BASE_URL}}/users',
        },
      },
    ],
    variable: [{ key: 'BASE_URL', value: 'https://api.example.com' }],
    ...overrides,
  };
}

function memoryWriter(): WorkspaceFileWriter & {
  readonly files: Map<string, string>;
} {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir(): Promise<void> {
      /* no-op */
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      files.set(absolutePath.replace(/\\/gu, '/'), content);
    },
    async deleteFile(absolutePath: string): Promise<void> {
      files.delete(absolutePath.replace(/\\/gu, '/'));
    },
    async removeDirectory(): Promise<void> {
      /* no-op */
    },
    async isNonEmptyDirectory(): Promise<boolean> {
      return false;
    },
    async listDirectory(): Promise<readonly string[]> {
      return [];
    },
  };
}

test('createDefaultImportProviderRegistry includes Postman', () => {
  const registry = createDefaultImportProviderRegistry();
  const provider = registry.get('postman');
  assert.ok(provider);
  assert.equal(provider!.id, 'postman');
  assert.equal(provider!.label, 'Postman Collection');
});

test('canHandle detects Postman and rejects OpenAPI', () => {
  const provider = new PostmanImportProvider();
  assert.equal(provider.canHandle(minimalCollection()), true);
  assert.equal(
    provider.canHandle({
      openapi: '3.0.3',
      info: { title: 'X', version: '1' },
      paths: {},
    }),
    false,
  );
  assert.equal(isPostmanCollectionRoot({ foo: 1 }), false);
  assert.equal(
    isPostmanCollectionRoot({
      info: { name: 'X', schema: SCHEMA_V21 },
      item: [],
    }),
    true,
  );
});

test('parse rejects non-postman JSON', () => {
  const result = parsePostmanCollection({ hello: 'world' });
  assert.equal(result.collection, undefined);
  assert.ok(
    result.diagnostics.some((item) => item.severity === 'error'),
  );
});

test('simple collection maps request with preserved {{VAR}}', async () => {
  const provider = new PostmanImportProvider();
  const artifacts = await provider.importSpecification(minimalCollection(), {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  assert.equal(artifacts.apiName, 'Demo API');
  assert.equal(artifacts.openapiVersion, 'postman-collection-v2.1');
  assert.equal(artifacts.requestCount, 1);
  assert.ok(artifacts.outputDirectoryName.startsWith('Collections/'));
  const apiFile = artifacts.files.find((file) => file.relativePath.endsWith('.api'));
  assert.ok(apiFile);
  assert.match(apiFile!.content, /GET \{\{BASE_URL\}\}\/users/);
  assert.match(apiFile!.content, /Accept: application\/json/);
  assert.ok(
    artifacts.files.some((file) =>
      file.relativePath.endsWith('api-hero.collection.json'),
    ),
  );
});

test('nested folders produce nested relative paths', async () => {
  const provider = new PostmanImportProvider();
  const root = minimalCollection({
    item: [
      {
        name: 'Users',
        item: [
          {
            name: 'Admin',
            item: [
              {
                name: 'Get admin',
                request: {
                  method: 'GET',
                  url: '{{BASE_URL}}/admin',
                },
              },
            ],
          },
        ],
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  assert.equal(artifacts.folderCount, 2);
  assert.equal(artifacts.requestCount, 1);
  const apiFile = artifacts.files.find((file) => file.relativePath.endsWith('.api'));
  assert.ok(apiFile);
  assert.match(apiFile!.relativePath, /Users\/Admin\//u);
});

test('unsupported scripts are reported', async () => {
  const provider = new PostmanImportProvider();
  const root = minimalCollection({
    item: [
      {
        name: 'With script',
        event: [
          {
            listen: 'prerequest',
            script: { exec: ['console.log(1)'] },
          },
          {
            listen: 'test',
            script: { exec: ['pm.test("ok", function () {})'] },
          },
        ],
        request: {
          method: 'GET',
          url: '{{BASE_URL}}/ping',
        },
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  const scripts = artifacts.diagnostics.filter(
    (item) => item.code === 'postman-unsupported-script',
  );
  assert.ok(scripts.length >= 2);
  for (const item of scripts) {
    assert.equal(item.severity, 'warning');
    assert.doesNotMatch(item.message, /console\.log\(1\)/);
  }
});

test('auth bearer/basic/apiKey create profiles', async () => {
  const provider = new PostmanImportProvider();
  const root = minimalCollection({
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: 'super-secret-token-value' }],
    },
    item: [
      {
        name: 'Basic',
        request: {
          method: 'GET',
          url: '{{BASE_URL}}/basic',
          auth: {
            type: 'basic',
            basic: [
              { key: 'username', value: 'user' },
              { key: 'password', value: 'pass' },
            ],
          },
        },
      },
      {
        name: 'ApiKey',
        request: {
          method: 'GET',
          url: '{{BASE_URL}}/key',
          auth: {
            type: 'apikey',
            apikey: [
              { key: 'key', value: 'X-Api-Key' },
              { key: 'value', value: 'literal-key' },
              { key: 'in', value: 'header' },
            ],
          },
        },
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  const providers = new Set(
    artifacts.authProfiles.map((item) => item.profile.providerId),
  );
  assert.ok(providers.has('bearer'));
  assert.ok(providers.has('basic'));
  assert.ok(providers.has('apiKey'));
  const serialized = JSON.stringify(artifacts);
  assert.doesNotMatch(serialized, /super-secret-token-value/);
  assert.doesNotMatch(serialized, /literal-key/);
});

test('path traversal / unsafe names are sanitized', async () => {
  const provider = new PostmanImportProvider();
  const root = minimalCollection({
    item: [
      {
        name: '../../etc/passwd',
        item: [
          {
            name: 'Evil',
            request: {
              method: 'GET',
              url: '{{BASE_URL}}/x',
            },
          },
        ],
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  for (const file of artifacts.files) {
    assert.doesNotMatch(file.relativePath, /\.\./u);
    assert.doesNotMatch(file.relativePath, /^[/\\]/u);
    assert.doesNotMatch(file.relativePath, /etc[/\\]passwd/u);
  }
});

test('sensitive values masked in diagnostics / generated content', async () => {
  const provider = new PostmanImportProvider();
  const root = minimalCollection({
    variable: [
      { key: 'api_token', value: 'tok_live_abc123', type: 'secret' },
      { key: 'BASE_URL', value: 'https://api.example.com' },
    ],
    item: [
      {
        name: 'Secret header',
        request: {
          method: 'GET',
          header: [
            { key: 'Authorization', value: 'Bearer tok_live_abc123' },
            { key: 'X-Api-Key', value: 'key-should-mask' },
          ],
          url: '{{BASE_URL}}/secure',
        },
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  const apiFile = artifacts.files.find((file) => file.relativePath.endsWith('.api'));
  assert.ok(apiFile);
  assert.doesNotMatch(apiFile!.content, /tok_live_abc123/);
  assert.doesNotMatch(apiFile!.content, /key-should-mask/);
  assert.match(apiFile!.content, /\{\{token\}\}|\{\{X_Api_Key\}\}|\{\{api_token\}\}/u);
  const env = artifacts.environments[0];
  assert.ok(env);
  const secretVar = env!.variables.find((item) => item.name === 'api_token');
  assert.ok(secretVar);
  assert.equal(secretVar!.sensitive, true);
  assert.doesNotMatch(secretVar!.value, /tok_live_abc123/);
  assert.equal(
    maskImportSecretText('Authorization: Bearer tok_live_abc123').includes(
      'tok_live_abc123',
    ),
    false,
  );
});

test('large-ish collection (100 requests) completes without hanging', async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    name: `Req ${index + 1}`,
    request: {
      method: index % 2 === 0 ? 'GET' : 'POST',
      url: `{{BASE_URL}}/items/${index + 1}`,
      body:
        index % 2 === 0
          ? undefined
          : {
              mode: 'raw',
              raw: JSON.stringify({ id: index + 1 }),
              options: { raw: { language: 'json' } },
            },
    },
  }));
  const root = minimalCollection({ item: items });
  const provider = new PostmanImportProvider();
  const started = performance.now();
  const artifacts = await provider.importSpecification(root, {
    sourceText: '{}',
    limits: {
      maxFileBytes: 5_000_000,
      maxRefDepth: 64,
      maxSchemaDepth: 32,
    },
    existingEnvironments: [],
    existingAuthProfiles: [],
  });
  const elapsed = performance.now() - started;
  assert.equal(artifacts.requestCount, 100);
  assert.ok(elapsed < 5_000, `import took too long: ${elapsed}ms`);
});

test('runImportPipeline imports Postman with skipWrite preview and write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'api-hero-postman-'));
  const writer = memoryWriter();
  try {
    const sourceText = JSON.stringify(minimalCollection());
    const preview = await runImportPipeline({
      sourceText,
      fileName: 'demo.postman_collection.json',
      targetRoot: dir,
      writer,
      skipWrite: true,
      provider: new PostmanImportProvider(),
    });
    assert.equal(preview.summary.success, true);
    assert.equal(preview.summary.writtenFiles.length, 0);
    assert.equal(preview.summary.requestCount, 1);
    assert.ok(preview.artifacts);

    const diskWriter: WorkspaceFileWriter = {
      async mkdir(absolutePath: string): Promise<void> {
        await mkdir(absolutePath, { recursive: true });
      },
      async writeFile(absolutePath: string, content: string): Promise<void> {
        await mkdir(join(absolutePath, '..'), { recursive: true });
        await writeFile(absolutePath, content, 'utf8');
      },
      async deleteFile(absolutePath: string): Promise<void> {
        await unlink(absolutePath);
      },
      async removeDirectory(absolutePath: string): Promise<void> {
        await rmdir(absolutePath);
      },
      async isNonEmptyDirectory(absolutePath: string): Promise<boolean> {
        try {
          const { readdir } = await import('node:fs/promises');
          const entries = await readdir(absolutePath);
          return entries.length > 0;
        } catch {
          return false;
        }
      },
      async listDirectory(absolutePath: string): Promise<readonly string[]> {
        const { readdir } = await import('node:fs/promises');
        return readdir(absolutePath);
      },
    };

    const written = await runImportPipeline({
      sourceText,
      fileName: 'demo.postman_collection.json',
      targetRoot: dir,
      writer: diskWriter,
      provider: new PostmanImportProvider(),
    });
    assert.equal(written.summary.success, true);
    assert.ok(written.summary.writtenFiles.length > 0);
    const markerPath = written.summary.writtenFiles.find((path) =>
      path.replace(/\\/gu, '/').endsWith('api-hero.collection.json'),
    );
    assert.ok(markerPath);
    const marker = await readFile(markerPath!, 'utf8');
    assert.match(marker, /Demo API/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
