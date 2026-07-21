import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  OpenApiRefResolver,
  collectionsImportOutputDirectory,
  detectSpecFormat,
  evaluateImportSourceSize,
  generateAuthProfiles,
  generateRequestSource,
  loadSpecification,
  maskImportSecretText,
  parseOpenApiDocument,
  resolveUnderTarget,
  runImportPipeline,
  safeJoinRelative,
  sanitizePathSegment,
  validateOpenApiDocument,
  writeImportArtifacts,
  type WorkspaceFileWriter,
} from './index';

const MINIMAL_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  tags: [{ name: 'pets' }],
  paths: {
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        tags: ['pets'],
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'verbose',
            in: 'query',
            schema: { type: 'boolean' },
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Pet',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
              example: { id: '1', name: 'Rex' },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: 'Rex' },
        },
      },
      Node: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          next: { $ref: '#/components/schemas/Node' },
        },
      },
    },
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
      BasicAuth: {
        type: 'http',
        scheme: 'basic',
      },
      ApiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
      CookieKey: {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
      },
      OAuth: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: 'https://auth.example.com/token',
            scopes: { read: 'Read' },
          },
        },
      },
    },
  },
});

const MINIMAL_YAML = `
openapi: "3.1.0"
info:
  title: YAML API
  version: "2.0.0"
servers:
  - url: https://yaml.example.com
paths:
  /health:
    get:
      operationId: healthCheck
      responses:
        "200":
          description: ok
`;

function memoryWriter(root: string): WorkspaceFileWriter {
  return {
    async mkdir(absolutePath: string): Promise<void> {
      await mkdir(absolutePath, { recursive: true });
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      assert.ok(
        absolutePath.replace(/\\/gu, '/').startsWith(root.replace(/\\/gu, '/')),
        `write escaped root: ${absolutePath}`,
      );
      await writeFile(absolutePath, content, 'utf8');
    },
  };
}

test('detects JSON and YAML formats', () => {
  assert.equal(detectSpecFormat('{"openapi":"3.0.0"}'), 'json');
  assert.equal(detectSpecFormat('openapi: "3.0.0"', 'spec.yaml'), 'yaml');
  assert.equal(detectSpecFormat('openapi: "3.0.0"', 'spec.yml'), 'yaml');
  assert.equal(detectSpecFormat('{"a":1}', 'spec.json'), 'json');
});

test('loads JSON and YAML fixtures', () => {
  const json = loadSpecification(MINIMAL_JSON, { fileName: 'pet.json' });
  assert.equal(json.diagnostics.length, 0);
  assert.ok(json.root);

  const yaml = loadSpecification(MINIMAL_YAML, { fileName: 'api.yaml' });
  assert.equal(yaml.diagnostics.length, 0);
  assert.ok(yaml.root);
});

test('rejects oversized and malformed specifications', () => {
  const oversized = loadSpecification('{"openapi":"3.0.0"}', {
    limits: { maxFileBytes: 4 },
  });
  assert.ok(oversized.diagnostics.some((item) => item.code === 'file-too-large'));

  const malformed = loadSpecification('{not-json', { fileName: 'bad.json' });
  assert.ok(malformed.diagnostics.some((item) => item.code === 'malformed-json'));

  const badYaml = loadSpecification('[1, 2', { fileName: 'bad.yaml' });
  assert.ok(badYaml.diagnostics.some((item) => item.code === 'malformed-yaml'));
});

test('validates OpenAPI version and required info', () => {
  const swagger = parseOpenApiDocument({
    swagger: '2.0',
    info: { title: 'Old', version: '1' },
  });
  assert.ok(swagger.document);
  const swaggerValidation = validateOpenApiDocument(swagger.document!);
  assert.equal(swaggerValidation.ok, false);

  const ok = parseOpenApiDocument(JSON.parse(MINIMAL_JSON));
  assert.ok(ok.document);
  assert.equal(validateOpenApiDocument(ok.document!).ok, true);
});

test('resolves $ref and detects circular refs', () => {
  const root = JSON.parse(MINIMAL_JSON) as unknown;
  const resolver = new OpenApiRefResolver(root);
  const pet = resolver.resolveRef('#/components/schemas/Pet');
  assert.ok(pet.value);
  assert.equal(pet.circular, false);

  const circular = resolver.resolveRef('#/components/schemas/Node');
  assert.ok(circular.value);

  // Sample path that walks Node → next → Node
  const again = resolver.resolve(
    { $ref: '#/components/schemas/Node' },
    ['#/components/schemas/Node'],
  );
  assert.equal(again.circular, true);
  assert.ok(again.diagnostics.some((item) => item.code === 'circular-ref'));

  const missing = resolver.resolveRef('#/components/schemas/Missing');
  assert.ok(missing.diagnostics.some((item) => item.code === 'missing-ref'));
});

test('sanitizes paths and rejects traversal', () => {
  assert.equal(sanitizePathSegment('..'), 'item');
  assert.equal(sanitizePathSegment('pets'), 'pets');
  assert.equal(safeJoinRelative('imported', '../etc/passwd'), undefined);
  assert.equal(safeJoinRelative('imported', 'pets/get-pet.api'), 'imported/pets/get-pet.api');
  assert.equal(
    resolveUnderTarget('/workspace', 'imported/../secret'),
    undefined,
  );
  assert.ok(
    resolveUnderTarget('/workspace', 'imported/petstore/pets/get.api')?.includes(
      'imported/petstore',
    ),
  );
});

test('collectionsImportOutputDirectory targets Collections/<slug>/', () => {
  assert.equal(
    collectionsImportOutputDirectory('petstore'),
    'Collections/petstore',
  );
});

test('imports JSON OpenAPI into .api files, env, and auth profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-import-'));
  try {
    const result = await runImportPipeline({
      sourceText: MINIMAL_JSON,
      fileName: 'petstore.json',
      targetRoot: root,
      writer: memoryWriter(root),
    });

    assert.equal(result.summary.success, true);
    assert.equal(result.summary.cancelled, false);
    assert.ok(result.summary.requestCount >= 2);
    assert.ok(result.summary.authProfileCount >= 3);
    assert.ok(result.summary.environmentCount >= 1);
    assert.ok(result.summary.writtenFiles.length >= 2);
    assert.match(
      result.summary.targetDirectory.replace(/\\/gu, '/'),
      /\/Collections\/[^/]+$/u,
    );
    assert.ok(
      result.summary.writtenFiles.some((path) =>
        path.replace(/\\/gu, '/').endsWith('/api-hero.collection.json'),
      ),
      'expected api-hero.collection.json marker',
    );

    const samplePath = result.summary.writtenFiles.find((path) =>
      path.replace(/\\/gu, '/').includes('get-getpet.api') ||
      path.replace(/\\/gu, '/').includes('get-getPet.api') ||
      /get-.*pet.*\.api$/iu.test(path),
    );
    assert.ok(samplePath, 'expected a getPet .api file');
    const content = await readFile(samplePath!, 'utf8');
    assert.match(content, /@name /u);
    assert.match(content, /@auth /u);
    assert.match(content, /# operationId:/u);
    // serializeRequestDocument inserts a blank line before METHOD.
    assert.match(
      content,
      /\n\nGET \{\{baseUrl\}\}\/pets\/\{\{petId\}\}\?verbose=\{\{verbose\}\}\n/u,
    );
    assert.match(content, /Accept:\s*application\/json/u);

    const postPath = result.summary.writtenFiles.find((path) =>
      /post-.*\.api$/iu.test(path),
    );
    assert.ok(postPath);
    const postContent = await readFile(postPath!, 'utf8');
    assert.match(postContent, /"name": "Rex"/u);

    assert.ok(result.settingsPatch);
    const bearer = result.settingsPatch!.authenticationProfiles.find(
      (profile) => profile.providerId === 'bearer',
    );
    assert.ok(bearer);
    assert.equal(
      (bearer as { token?: { kind: string } }).token?.kind,
      'secret',
    );

    const env = result.settingsPatch!.environments.find((item) =>
      item.id.startsWith('imported-'),
    );
    assert.ok(env);
    assert.ok(env!.variables.some((variable) => variable.name === 'baseUrl'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('imports YAML OpenAPI 3.1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-yaml-'));
  try {
    const result = await runImportPipeline({
      sourceText: MINIMAL_YAML,
      fileName: 'api.yaml',
      targetRoot: root,
      writer: memoryWriter(root),
    });
    assert.equal(result.summary.success, true);
    assert.equal(result.summary.openapiVersion, '3.1.0');
    assert.equal(result.summary.requestCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects path traversal during write via unsafe relative paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-trav-'));
  try {
    const written = await writeImportArtifacts({
      targetRoot: root,
      outputDirectoryName: 'imported/safe',
      files: [
        { relativePath: '../escape.api', content: 'GET /' },
        { relativePath: 'ok/get.api', content: 'GET /\n' },
      ],
      writer: memoryWriter(root),
    });
    assert.ok(
      written.diagnostics.some((item) => item.code === 'path-traversal'),
    );
    assert.equal(written.writtenFiles.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handles cancellation between stages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-cancel-'));
  try {
    const cancellation = { isCancellationRequested: true };
    const result = await runImportPipeline({
      sourceText: MINIMAL_JSON,
      fileName: 'petstore.json',
      targetRoot: root,
      writer: memoryWriter(root),
      cancellation,
    });
    assert.equal(result.summary.cancelled, true);
    assert.equal(result.summary.success, false);
    assert.equal(result.summary.writtenFiles.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skipWrite previews counts without writing files or settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'api-hero-preview-'));
  try {
    const writes: string[] = [];
    const result = await runImportPipeline({
      sourceText: MINIMAL_JSON,
      fileName: 'petstore.json',
      targetRoot: root,
      skipWrite: true,
      writer: {
        async mkdir(): Promise<void> {
          writes.push('mkdir');
        },
        async writeFile(path: string): Promise<void> {
          writes.push(path);
        },
      },
    });
    assert.equal(result.summary.success, true);
    assert.equal(result.summary.writtenFiles.length, 0);
    assert.equal(result.settingsPatch, undefined);
    assert.ok((result.summary.requestCount ?? 0) >= 2);
    assert.ok(result.artifacts?.outputDirectoryName.includes('Collections'));
    assert.deepEqual(writes, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('smoke: large-ish generated spec imports within a reasonable budget', async () => {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < 80; index += 1) {
    paths[`/items/${index}`] = {
      get: {
        operationId: `getItem${index}`,
        tags: [`group${index % 8}`],
        responses: { '200': { description: 'ok' } },
      },
    };
  }
  const large = JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Large', version: '1.0.0' },
    servers: [{ url: 'https://large.example.com' }],
    paths,
  });

  const root = await mkdtemp(join(tmpdir(), 'api-hero-large-'));
  try {
    const started = performance.now();
    const result = await runImportPipeline({
      sourceText: large,
      fileName: 'large.json',
      targetRoot: root,
      writer: memoryWriter(root),
    });
    const elapsed = performance.now() - started;
    assert.equal(result.summary.success, true);
    assert.equal(result.summary.requestCount, 80);
    // Hang detector only — not a tight performance SLA.
    assert.ok(elapsed < 60_000, `import hang detector: ${elapsed}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('masks secrets in diagnostic messages', () => {
  const masked = maskImportSecretText(
    'Authorization: Bearer super-secret-token-value',
  );
  assert.ok(!masked.includes('super-secret-token-value'));
});

test('success is false and nothing is written when a $ref is missing', async () => {
  const spec = JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Broken Refs', version: '1.0.0' },
    servers: [{ url: 'https://example.com' }],
    paths: {
      '/things': {
        post: {
          operationId: 'createThing',
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Missing' },
              },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: { schemas: {} },
  });

  const root = await mkdtemp(join(tmpdir(), 'api-hero-missing-ref-'));
  try {
    const result = await runImportPipeline({
      sourceText: spec,
      fileName: 'broken.json',
      targetRoot: root,
      writer: memoryWriter(root),
    });
    assert.equal(result.summary.success, false);
    assert.equal(result.summary.writtenFiles.length, 0);
    assert.equal(result.settingsPatch, undefined);
    assert.ok(
      result.summary.diagnostics.some((item) => item.code === 'missing-ref'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('evaluateImportSourceSize rejects oversized files before decode', () => {
  const ok = evaluateImportSourceSize(100, 1_000);
  assert.equal(ok.ok, true);

  const rejected = evaluateImportSourceSize(5_000, 1_000);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostic.code, 'file-too-large');
    assert.equal(rejected.diagnostic.severity, 'error');
  }
});

test('Authorization header examples are scrubbed to placeholders', () => {
  const document = {
    openapi: '3.0.3',
    info: { title: 'Auth Header', version: '1.0.0' },
    paths: {},
  };
  const resolver = new OpenApiRefResolver(document);
  const generated = generateRequestSource({
    document,
    resolver,
    pathKey: '/secure',
    method: 'get',
    pathItem: {},
    operation: {
      operationId: 'secureGet',
      parameters: [
        {
          name: 'Authorization',
          in: 'header',
          example: 'Bearer literal-secret-token',
          schema: { type: 'string' },
        },
        {
          name: 'X-API-Key',
          in: 'header',
          example: 'super-secret-key-value',
          schema: { type: 'string' },
        },
      ],
      responses: { '200': { description: 'ok' } },
    },
    schemeToProfileId: new Map(),
  });

  assert.ok(!generated.content.includes('literal-secret-token'));
  assert.ok(!generated.content.includes('super-secret-key-value'));
  assert.match(generated.content, /Authorization:\s*\{\{token\}\}/u);
  assert.match(generated.content, /X-API-Key:\s*\{\{/u);
  // Intentional serialize layout: blank line before METHOD.
  assert.match(generated.content, /@name secureGet\n\nGET \{\{baseUrl\}\}\/secure\n/u);
});

test('external $ref is rejected without fetching', () => {
  const root = {
    openapi: '3.0.3',
    info: { title: 'Ext', version: '1.0.0' },
    components: { schemas: {} },
  };
  const resolver = new OpenApiRefResolver(root);
  const resolved = resolver.resolveRef('./other.yaml#/components/schemas/Pet');
  assert.equal(resolved.value, undefined);
  assert.ok(
    resolved.diagnostics.some((item) => item.code === 'external-ref'),
  );
  assert.ok(
    resolver.getDiagnostics().some((item) => item.code === 'external-ref'),
  );
});

test('unknown http auth scheme maps to none with warning', () => {
  const document = {
    openapi: '3.0.3',
    info: { title: 'Digest API', version: '1.0.0' },
    components: {
      securitySchemes: {
        Digest: { type: 'http', scheme: 'digest' },
      },
    },
  };
  const resolver = new OpenApiRefResolver(document);
  const result = generateAuthProfiles(
    document as never,
    resolver,
    'digest-api',
    new Set(),
  );
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0]?.profile.providerId, 'none');
  assert.ok(
    result.diagnostics.some((item) => item.code === 'unsupported-http-scheme'),
  );
});

test('handles duplicate operationIds, empty paths, invalid YAML, and absolute traversal', async () => {
  assert.equal(safeJoinRelative('/absolute/path'), undefined);
  assert.equal(safeJoinRelative('C:/windows/system32'), undefined);
  assert.equal(safeJoinRelative('ok', '..', 'escape'), undefined);

  const invalidYaml = await runImportPipeline({
    sourceText: 'openapi: [\n  broken',
    fileName: 'broken.yaml',
    targetRoot: '/tmp',
    writer: {
      async mkdir(): Promise<void> {
        /* no-op: invalid import must not create dirs */
      },
      async writeFile() {
        assert.fail('must not write on invalid YAML');
      },
    },
  });
  assert.equal(invalidYaml.summary.success, false);
  assert.ok(invalidYaml.summary.diagnostics.length > 0);

  const emptyRoot = await mkdtemp(join(tmpdir(), 'api-hero-empty-paths-'));
  try {
    const emptyPaths = await runImportPipeline({
      sourceText: JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Empty', version: '1.0.0' },
        paths: {},
      }),
      fileName: 'empty.json',
      targetRoot: emptyRoot,
      writer: memoryWriter(emptyRoot),
    });
    assert.equal(emptyPaths.summary.requestCount, 0);
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }

  const root = await mkdtemp(join(tmpdir(), 'api-hero-dup-ops-'));
  try {
    const result = await runImportPipeline({
      sourceText: JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Dup', version: '1.0.0' },
        servers: [{ url: 'https://example.test' }],
        paths: {
          '/a': {
            get: {
              operationId: 'sameOp',
              responses: { '200': { description: 'ok' } },
            },
          },
          '/b': {
            get: {
              operationId: 'sameOp',
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
      fileName: 'dup.json',
      targetRoot: root,
      writer: memoryWriter(root),
    });
    assert.equal(result.summary.success, true);
    assert.equal(result.summary.requestCount, 2);
    const relativePaths = result.summary.writtenFiles
      .filter((file) => file.endsWith('.api'))
      .map((file) => file.replace(/\\/gu, '/'));
    assert.equal(new Set(relativePaths).size, relativePaths.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
