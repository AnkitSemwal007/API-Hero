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
  InsomniaImportProvider,
  createDefaultImportProviderRegistry,
  maskImportSecretText,
  runImportPipeline,
  type WorkspaceFileWriter,
} from '../index';
import { DefaultVariableResolver } from '../../variables';
import type { VariableDefinition } from '../../models';
import { isInsomniaExportRoot, parseInsomniaExport } from './parse';
import { rewriteInsomniaEnvRefs } from './map-variables';

function minimalExport(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _type: 'export',
    __export_format: 4,
    __export_source: 'insomnia.desktop.app:v2023.5.8',
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        description: 'Demo workspace',
        parentId: null,
      },
      {
        _id: 'env_1',
        _type: 'environment',
        name: 'Base',
        parentId: 'wrk_1',
        data: {
          BASE_URL: 'https://api.example.com',
        },
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'List users',
        method: 'GET',
        url: '{{ _.BASE_URL }}/users',
        headers: [{ name: 'Accept', value: 'application/json' }],
        parameters: [],
        authentication: {},
      },
    ],
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

const importContext = {
  sourceText: '{}',
  limits: {
    maxFileBytes: 5_000_000,
    maxRefDepth: 64,
    maxSchemaDepth: 32,
  },
  existingEnvironments: [] as const,
  existingAuthProfiles: [] as const,
};

test('createDefaultImportProviderRegistry includes Insomnia', () => {
  const registry = createDefaultImportProviderRegistry();
  const provider = registry.get('insomnia');
  assert.ok(provider);
  assert.equal(provider!.id, 'insomnia');
  assert.equal(provider!.label, 'Insomnia Export');
});

test('canHandle detects Insomnia and rejects OpenAPI/Postman', () => {
  const provider = new InsomniaImportProvider();
  assert.equal(provider.canHandle(minimalExport()), true);
  assert.equal(
    provider.canHandle({
      openapi: '3.0.3',
      info: { title: 'X', version: '1' },
      paths: {},
    }),
    false,
  );
  assert.equal(
    provider.canHandle({
      info: {
        name: 'X',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [],
    }),
    false,
  );
  assert.equal(isInsomniaExportRoot({ foo: 1 }), false);
  assert.equal(isInsomniaExportRoot(minimalExport()), true);
});

test('parse rejects non-insomnia JSON', () => {
  const result = parseInsomniaExport({ hello: 'world' });
  assert.equal(result.export, undefined);
  assert.ok(result.diagnostics.some((item) => item.severity === 'error'));
});

test('parse rejects unsupported export format', () => {
  const result = parseInsomniaExport(
    minimalExport({ __export_format: 99 }),
  );
  assert.equal(result.export, undefined);
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === 'insomnia-unsupported-export-format',
    ),
  );
});

test('simple export maps request with rewritten {{ }} refs', async () => {
  const provider = new InsomniaImportProvider();
  const artifacts = await provider.importSpecification(
    minimalExport(),
    importContext,
  );
  assert.equal(artifacts.apiName, 'Demo API');
  assert.equal(artifacts.openapiVersion, 'insomnia-export-v4');
  assert.equal(artifacts.requestCount, 1);
  assert.ok(artifacts.outputDirectoryName.startsWith('Collections/'));
  const apiFile = artifacts.files.find((file) =>
    file.relativePath.endsWith('.api'),
  );
  assert.ok(apiFile);
  assert.match(apiFile!.content, /\{\{BASE_URL\}\}\/users/);
  assert.doesNotMatch(apiFile!.content, /\{\{\s*_\./u);
  assert.match(apiFile!.content, /Accept: application\/json/);
  assert.ok(
    artifacts.files.some((file) =>
      file.relativePath.endsWith('api-hero.collection.json'),
    ),
  );
});

test('nested folders produce nested relative paths', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'fld_users',
        _type: 'request_group',
        parentId: 'wrk_1',
        name: 'Users',
        metaSortKey: -1,
      },
      {
        _id: 'fld_admin',
        _type: 'request_group',
        parentId: 'fld_users',
        name: 'Admin',
        metaSortKey: -1,
      },
      {
        _id: 'req_admin',
        _type: 'request',
        parentId: 'fld_admin',
        name: 'Get admin',
        method: 'GET',
        url: '{{ _.BASE_URL }}/admin',
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  assert.equal(artifacts.folderCount, 2);
  assert.equal(artifacts.requestCount, 1);
  const apiFile = artifacts.files.find((file) =>
    file.relativePath.endsWith('.api'),
  );
  assert.ok(apiFile);
  assert.match(apiFile!.relativePath, /Users\/Admin\//u);
});

test('variables / environments are imported', async () => {
  const provider = new InsomniaImportProvider();
  const artifacts = await provider.importSpecification(
    minimalExport(),
    importContext,
  );
  assert.ok(artifacts.environments.length >= 1);
  const env = artifacts.environments[0]!;
  const base = env.variables.find((item) => item.name === 'BASE_URL');
  assert.ok(base);
  assert.equal(base!.value, 'https://api.example.com');
});

test('headers and query params map', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Search',
        method: 'GET',
        url: 'https://api.example.com/search',
        headers: [{ name: 'X-Client', value: 'api-hero' }],
        parameters: [
          { name: 'q', value: 'hello' },
          { name: 'page', value: '1', disabled: true },
        ],
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  const apiFile = artifacts.files.find((file) =>
    file.relativePath.endsWith('.api'),
  );
  assert.ok(apiFile);
  assert.match(apiFile!.content, /X-Client: api-hero/);
  assert.match(apiFile!.content, /q=hello|@query q/u);
});

test('JSON and form bodies map', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'req_json',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Create',
        method: 'POST',
        url: 'https://api.example.com/items',
        body: {
          mimeType: 'application/json',
          text: JSON.stringify({ name: 'widget' }),
        },
      },
      {
        _id: 'req_form',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Form',
        method: 'POST',
        url: 'https://api.example.com/form',
        body: {
          mimeType: 'application/x-www-form-urlencoded',
          params: [{ name: 'a', value: '1' }],
        },
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  assert.equal(artifacts.requestCount, 2);
  const apiFiles = artifacts.files.filter((file) =>
    file.relativePath.endsWith('.api'),
  );
  assert.equal(apiFiles.length, 2);
  const jsonFile = apiFiles.find((file) => file.content.includes('widget'));
  assert.ok(jsonFile);
  assert.match(jsonFile!.content, /POST /u);
  const formFile = apiFiles.find(
    (file) =>
      file.content.includes('a=1') ||
      file.content.includes('@form') ||
      /a\s*=\s*1/u.test(file.content),
  );
  assert.ok(formFile);
});

test('auth bearer/basic/apiKey create profiles', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'req_bearer',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Bearer',
        method: 'GET',
        url: 'https://api.example.com/bearer',
        authentication: {
          type: 'bearer',
          token: 'super-secret-token-value',
        },
      },
      {
        _id: 'req_basic',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Basic',
        method: 'GET',
        url: 'https://api.example.com/basic',
        authentication: {
          type: 'basic',
          username: 'user',
          password: 'pass',
        },
      },
      {
        _id: 'req_key',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'ApiKey',
        method: 'GET',
        url: 'https://api.example.com/key',
        authentication: {
          type: 'apikey',
          key: 'X-Api-Key',
          value: 'literal-key',
          addTo: 'header',
        },
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
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

test('unsupported scripts and resources are reported', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'jar_1',
        _type: 'cookie_jar',
        parentId: 'wrk_1',
        name: 'Jar',
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'With script',
        method: 'GET',
        url: 'https://api.example.com/ping',
        preRequestScript: 'console.log(1)',
        afterResponseScript: 'console.log(2)',
        authentication: { type: 'oauth2', grantType: 'authorization_code' },
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  const scripts = artifacts.diagnostics.filter(
    (item) => item.code === 'insomnia-unsupported-script',
  );
  assert.ok(scripts.length >= 2);
  for (const item of scripts) {
    assert.equal(item.severity, 'warning');
    assert.doesNotMatch(item.message, /console\.log\(1\)/);
  }
  assert.ok(
    artifacts.diagnostics.some(
      (item) => item.code === 'insomnia-unsupported-resource',
    ),
  );
  assert.ok(
    artifacts.diagnostics.some(
      (item) => item.code === 'insomnia-unsupported-auth',
    ),
  );
});

test('path traversal / unsafe names are sanitized', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'fld_evil',
        _type: 'request_group',
        parentId: 'wrk_1',
        name: '../../etc/passwd',
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'fld_evil',
        name: 'Evil',
        method: 'GET',
        url: 'https://api.example.com/x',
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  for (const file of artifacts.files) {
    assert.doesNotMatch(file.relativePath, /\.\./u);
    assert.doesNotMatch(file.relativePath, /^[/\\]/u);
    assert.doesNotMatch(file.relativePath, /etc[/\\]passwd/u);
  }
});

test('sensitive values masked in diagnostics / generated content', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'env_1',
        _type: 'environment',
        name: 'Base',
        parentId: 'wrk_1',
        data: {
          api_token: 'tok_live_abc123',
          BASE_URL: 'https://api.example.com',
        },
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Secret header',
        method: 'GET',
        url: '{{ _.BASE_URL }}/secure',
        headers: [
          { name: 'Authorization', value: 'Bearer tok_live_abc123' },
          { name: 'X-Api-Key', value: 'key-should-mask' },
        ],
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  const apiFile = artifacts.files.find((file) =>
    file.relativePath.endsWith('.api'),
  );
  assert.ok(apiFile);
  assert.doesNotMatch(apiFile!.content, /tok_live_abc123/);
  assert.doesNotMatch(apiFile!.content, /key-should-mask/);
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

test('large-ish export (100 requests) completes without hanging', async () => {
  const resources: Record<string, unknown>[] = [
    {
      _id: 'wrk_1',
      _type: 'workspace',
      name: 'Large',
      parentId: null,
    },
  ];
  for (let index = 0; index < 100; index += 1) {
    resources.push({
      _id: `req_${index}`,
      _type: 'request',
      parentId: 'wrk_1',
      name: `Req ${index + 1}`,
      method: index % 2 === 0 ? 'GET' : 'POST',
      url: `https://api.example.com/items/${index + 1}`,
      body:
        index % 2 === 0
          ? undefined
          : {
              mimeType: 'application/json',
              text: JSON.stringify({ id: index + 1 }),
            },
    });
  }
  const root = minimalExport({ resources });
  const provider = new InsomniaImportProvider();
  const started = performance.now();
  const artifacts = await provider.importSpecification(root, importContext);
  const elapsed = performance.now() - started;
  assert.equal(artifacts.requestCount, 100);
  assert.ok(elapsed < 5_000, `import took too long: ${elapsed}ms`);
});

test('rewriteInsomniaEnvRefs strips _. prefix and whitespace variants', () => {
  assert.deepEqual(rewriteInsomniaEnvRefs('{{ _.BASE_URL }}/users'), {
    value: '{{BASE_URL}}/users',
    rewriteCount: 1,
  });
  assert.deepEqual(rewriteInsomniaEnvRefs('{{_.token}}'), {
    value: '{{token}}',
    rewriteCount: 1,
  });
  assert.deepEqual(rewriteInsomniaEnvRefs('{{  _.host  }}/{{path}}'), {
    value: '{{host}}/{{path}}',
    rewriteCount: 1,
  });
  assert.deepEqual(rewriteInsomniaEnvRefs('{{alreadyOk}}'), {
    value: '{{alreadyOk}}',
    rewriteCount: 0,
  });
});

test('imported URLs resolve against env var names without _. prefix', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'env_1',
        _type: 'environment',
        name: 'Base',
        parentId: 'wrk_1',
        data: {
          BASE_URL: 'https://api.example.com',
          path: 'v1',
        },
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'List',
        method: 'GET',
        url: '{{ _.BASE_URL }}/{{_.path}}/users',
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  const apiFile = artifacts.files.find((file) =>
    file.relativePath.endsWith('.api'),
  );
  assert.ok(apiFile);
  assert.match(apiFile!.content, /\{\{BASE_URL\}\}\/\{\{path\}\}\/users/);
  assert.doesNotMatch(apiFile!.content, /_\./u);

  const env = artifacts.environments[0]!;
  const definitions: VariableDefinition[] = env.variables.map((item) => ({
    name: item.name,
    value: item.value,
    scope: 'environment',
    sensitive: item.sensitive,
  }));
  const resolver = new DefaultVariableResolver();
  const analysis = resolver.analyze({ definitions });
  assert.equal(analysis.values.get('BASE_URL')?.value, 'https://api.example.com');
  assert.equal(analysis.values.get('path')?.value, 'v1');
  const resolved = apiFile!.content.replace(
    /\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu,
    (_match, name: string) => analysis.values.get(name)?.value ?? `{{${name}}}`,
  );
  assert.match(resolved, /https:\/\/api\.example\.com\/v1\/users/);
});

test('folder and workspace auth inherit like Postman (child overrides parent)', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
        authentication: {
          type: 'bearer',
          token: 'workspace-token',
        },
      },
      {
        _id: 'fld_secure',
        _type: 'request_group',
        parentId: 'wrk_1',
        name: 'Secure',
        authentication: {
          type: 'basic',
          username: 'folder-user',
          password: 'folder-pass',
        },
      },
      {
        _id: 'req_inherited',
        _type: 'request',
        parentId: 'fld_secure',
        name: 'Inherited',
        method: 'GET',
        url: 'https://api.example.com/inherited',
        authentication: {},
      },
      {
        _id: 'req_override',
        _type: 'request',
        parentId: 'fld_secure',
        name: 'Override',
        method: 'GET',
        url: 'https://api.example.com/override',
        authentication: {
          type: 'apikey',
          key: 'X-Api-Key',
          value: 'req-key',
          addTo: 'header',
        },
      },
      {
        _id: 'req_workspace',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Workspace child',
        method: 'GET',
        url: 'https://api.example.com/ws',
        authentication: {},
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  const providers = artifacts.authProfiles.map(
    (item) => item.profile.providerId,
  );
  assert.ok(providers.includes('bearer'));
  assert.ok(providers.includes('basic'));
  assert.ok(providers.includes('apiKey'));

  const inherited = artifacts.files.find((file) =>
    file.content.includes('@name Inherited'),
  );
  const override = artifacts.files.find((file) =>
    file.content.includes('@name Override'),
  );
  const workspaceChild = artifacts.files.find((file) =>
    file.content.includes('@name Workspace child'),
  );
  assert.ok(inherited);
  assert.ok(override);
  assert.ok(workspaceChild);

  const basicId = artifacts.authProfiles.find(
    (item) => item.profile.providerId === 'basic',
  )!.profile.id;
  const bearerId = artifacts.authProfiles.find(
    (item) => item.profile.providerId === 'bearer',
  )!.profile.id;
  const apiKeyId = artifacts.authProfiles.find(
    (item) => item.profile.providerId === 'apiKey',
  )!.profile.id;

  assert.match(inherited!.content, new RegExp(`@auth ${basicId}`, 'u'));
  assert.match(override!.content, new RegExp(`@auth ${apiKeyId}`, 'u'));
  assert.match(workspaceChild!.content, new RegExp(`@auth ${bearerId}`, 'u'));
  assert.doesNotMatch(JSON.stringify(artifacts), /workspace-token|folder-pass|req-key/);
});

test('unmapped folder auth emits diagnostic', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'fld_oauth',
        _type: 'request_group',
        parentId: 'wrk_1',
        name: 'OAuth Folder',
        authentication: {
          type: 'oauth2',
          grantType: 'authorization_code',
        },
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'fld_oauth',
        name: 'Child',
        method: 'GET',
        url: 'https://api.example.com/oauth',
        authentication: {},
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  assert.ok(
    artifacts.diagnostics.some(
      (item) => item.code === 'insomnia-unsupported-auth',
    ),
  );
  const child = artifacts.files.find((file) =>
    file.content.includes('@name Child'),
  );
  assert.ok(child);
  assert.match(child!.content, /@auth /u);
});

test('environment parentId hierarchy emits flatten warning', async () => {
  const provider = new InsomniaImportProvider();
  const root = minimalExport({
    resources: [
      {
        _id: 'wrk_1',
        _type: 'workspace',
        name: 'Demo API',
        parentId: null,
      },
      {
        _id: 'env_base',
        _type: 'environment',
        name: 'Base',
        parentId: 'wrk_1',
        data: { BASE_URL: 'https://api.example.com' },
      },
      {
        _id: 'env_private',
        _type: 'environment',
        name: 'Private',
        parentId: 'env_base',
        data: { token: 'secret' },
      },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Ping',
        method: 'GET',
        url: 'https://api.example.com/ping',
      },
    ],
  });
  const artifacts = await provider.importSpecification(root, importContext);
  assert.ok(
    artifacts.diagnostics.some(
      (item) => item.code === 'insomnia-environment-parent-flattened',
    ),
  );
});

test('runImportPipeline imports Insomnia with skipWrite preview and write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'api-hero-insomnia-'));
  const writer = memoryWriter();
  try {
    const sourceText = JSON.stringify(minimalExport());
    const preview = await runImportPipeline({
      sourceText,
      fileName: 'demo.insomnia.json',
      targetRoot: dir,
      writer,
      skipWrite: true,
      provider: new InsomniaImportProvider(),
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
      fileName: 'demo.insomnia.json',
      targetRoot: dir,
      writer: diskWriter,
      provider: new InsomniaImportProvider(),
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
