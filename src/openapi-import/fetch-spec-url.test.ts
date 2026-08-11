import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  HttpTransportError,
  NodeHttpTransport,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from '../execution';
import {
  deriveFileNameHint,
  fetchOpenApiSpecUrl,
  validateOpenApiSpecUrl,
} from './fetch-spec-url';
import { runImportPipeline, type WorkspaceFileWriter } from './index';

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'URL Petstore', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
});

const OPENAPI_YAML = `
openapi: "3.1.0"
info:
  title: YAML From URL
  version: "1.0.0"
servers:
  - url: https://yaml.example.com
paths:
  /health:
    get:
      operationId: health
      responses:
        "200":
          description: ok
`.trim();

class FakeTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];
  public readonly contexts: {
    readonly signal: AbortSignal;
    readonly maxResponseBytes?: number;
  }[] = [];

  public constructor(
    private readonly handler: (
      request: HttpTransportRequest,
      context: { readonly signal: AbortSignal; readonly maxResponseBytes?: number },
    ) => Promise<HttpTransportResponse>,
  ) {}

  public execute(
    request: HttpTransportRequest,
    context: { readonly signal: AbortSignal; readonly maxResponseBytes?: number },
  ): Promise<HttpTransportResponse> {
    this.requests.push(request);
    this.contexts.push(context);
    return this.handler(request, context);
  }
}

function okResponse(
  overrides: Partial<HttpTransportResponse> & { readonly body: Uint8Array },
): HttpTransportResponse {
  return {
    statusCode: 200,
    statusText: 'OK',
    headers: [],
    finalUrl: 'https://example.com/openapi.json',
    redirected: false,
    redirectCount: 0,
    ...overrides,
  };
}

function memoryWriter(): WorkspaceFileWriter {
  return {
    async mkdir(): Promise<void> {
      /* preview / skipWrite unused */
    },
    async writeFile(): Promise<void> {
      /* unused in skipWrite */
    },
    async deleteFile(): Promise<void> {
      /* unused in skipWrite */
    },
    async removeDirectory(): Promise<void> {
      /* unused in skipWrite */
    },
    async isNonEmptyDirectory(): Promise<boolean> {
      return false;
    },
    async listDirectory(): Promise<readonly string[]> {
      return [];
    },
  };
}

test('fetchOpenApiSpecUrl loads valid OpenAPI JSON', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      body: Buffer.from(OPENAPI_JSON, 'utf8'),
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      finalUrl: 'https://example.com/specs/api.json',
    }),
  );
  const result = await fetchOpenApiSpecUrl('https://example.com/specs/api.json', {
    transport,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.text, OPENAPI_JSON);
  assert.equal(result.fileName, 'api.json');
  assert.equal(result.contentType, 'application/json');
  assert.equal(transport.requests[0]?.method, 'GET');
  assert.equal(transport.requests[0]?.headers.length, 0);
  assert.deepEqual(transport.requests[0]?.redirectPolicy, {
    mode: 'follow',
    maxRedirects: 10,
  });
  assert.equal(transport.requests[0]?.ssl.verifyCertificates, true);
});

test('fetchOpenApiSpecUrl loads valid OpenAPI YAML', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      body: Buffer.from(OPENAPI_YAML, 'utf8'),
      headers: [{ name: 'Content-Type', value: 'application/yaml' }],
      finalUrl: 'https://example.com/openapi.yaml',
    }),
  );
  const result = await fetchOpenApiSpecUrl('https://example.com/openapi.yaml', {
    transport,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.text, OPENAPI_YAML);
  assert.equal(result.fileName, 'openapi.yaml');
});

test('fetchOpenApiSpecUrl maps HTTP 404', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      statusCode: 404,
      statusText: 'Not Found',
      body: Buffer.from('missing', 'utf8'),
    }),
  );
  const result = await fetchOpenApiSpecUrl('https://example.com/missing.json', {
    transport,
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.message, 'OpenAPI document returned HTTP 404.');
});

test('fetchOpenApiSpecUrl maps HTTP 500', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      statusCode: 500,
      statusText: 'Internal Server Error',
      body: Buffer.from('err', 'utf8'),
    }),
  );
  const result = await fetchOpenApiSpecUrl('https://example.com/openapi.json', {
    transport,
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.message, 'OpenAPI document returned HTTP 500.');
});

test('fetchOpenApiSpecUrl maps network HttpTransportError', async () => {
  const transport = new FakeTransport(async () => {
    throw new HttpTransportError('dns', 'lookup failed', 'ENOTFOUND');
  });
  const result = await fetchOpenApiSpecUrl('https://missing.example/openapi.json', {
    transport,
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(
    result.message,
    'Unable to fetch OpenAPI document from the provided URL.',
  );
  assert.equal(result.code, 'dns');
});

test('validateOpenApiSpecUrl rejects invalid URL', () => {
  const result = validateOpenApiSpecUrl('not a url');
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.message, 'Invalid OpenAPI URL.');
});

test('validateOpenApiSpecUrl rejects unsupported protocols', () => {
  for (const url of [
    'file:///tmp/openapi.json',
    'ftp://example.com/openapi.json',
    'data:application/json,{}',
  ]) {
    const result = validateOpenApiSpecUrl(url);
    assert.equal(result.ok, false);
    if (result.ok) {
      continue;
    }
    assert.equal(result.message, 'Only HTTP and HTTPS URLs are supported.');
  }
});

test('validateOpenApiSpecUrl rejects embedded credentials', () => {
  const result = validateOpenApiSpecUrl(
    'https://user:secret@example.com/openapi.json',
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.message, /Authenticated specification URLs are not supported/u);
});

test('fetchOpenApiSpecUrl rejects credentialed finalUrl after redirect', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      body: Buffer.from(OPENAPI_JSON, 'utf8'),
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      redirected: true,
      redirectCount: 1,
      finalUrl: 'https://user:secret@cdn.example.com/openapi.json',
    }),
  );
  const result = await fetchOpenApiSpecUrl('https://example.com/redirect', {
    transport,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'credentials-unsupported');
  }
});

test('fetchOpenApiSpecUrl requests follow redirect policy', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      body: Buffer.from(OPENAPI_JSON, 'utf8'),
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      redirected: true,
      redirectCount: 1,
      finalUrl: 'https://cdn.example.com/openapi.json',
    }),
  );
  const result = await fetchOpenApiSpecUrl('https://example.com/redirect', {
    transport,
  });
  assert.equal(result.ok, true);
  assert.equal(transport.requests[0]?.redirectPolicy.mode, 'follow');
  assert.equal(transport.requests[0]?.redirectPolicy.maxRedirects, 10);
  if (result.ok) {
    assert.equal(result.sourceUrl, 'https://cdn.example.com/openapi.json');
  }
});

test('Content-Type preferred over misleading URL extension for fileName', () => {
  assert.equal(
    deriveFileNameHint(
      'https://example.com/spec.yaml',
      'application/json; charset=utf-8',
    ),
    'spec.json',
  );
});

test('fileName omitted when neither Content-Type nor extension helps', () => {
  assert.equal(
    deriveFileNameHint('https://example.com/v1/openapi', undefined),
    undefined,
  );
  assert.equal(
    deriveFileNameHint('https://example.com/v1/openapi', 'text/plain'),
    undefined,
  );
});

test('fetchOpenApiSpecUrl maps 401 and 403 as auth unsupported', async () => {
  for (const status of [401, 403] as const) {
    const transport = new FakeTransport(async () =>
      okResponse({
        statusCode: status,
        statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
        body: Buffer.from('denied', 'utf8'),
      }),
    );
    const result = await fetchOpenApiSpecUrl('https://example.com/secure.json', {
      transport,
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      continue;
    }
    assert.match(result.message, /Authenticated OpenAPI URLs are not supported/u);
  }
});

test('URL fetch result and direct pipeline produce equivalent artifacts', async () => {
  const transport = new FakeTransport(async () =>
    okResponse({
      body: Buffer.from(OPENAPI_JSON, 'utf8'),
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      finalUrl: 'https://example.com/openapi.json',
    }),
  );
  const fetched = await fetchOpenApiSpecUrl('https://example.com/openapi.json', {
    transport,
  });
  assert.equal(fetched.ok, true);
  if (!fetched.ok) {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'api-hero-url-equiv-'));
  try {
    const writer = memoryWriter();
    const fromUrl = await runImportPipeline({
      sourceText: fetched.text,
      sourcePath: fetched.sourceUrl,
      fileName: fetched.fileName,
      targetRoot: root,
      writer,
      skipWrite: true,
    });
    const direct = await runImportPipeline({
      sourceText: OPENAPI_JSON,
      fileName: 'openapi.json',
      targetRoot: root,
      writer,
      skipWrite: true,
    });
    assert.equal(fromUrl.summary.success, true);
    assert.equal(direct.summary.success, true);
    assert.equal(fromUrl.summary.requestCount, direct.summary.requestCount);
    assert.deepEqual(
      fromUrl.artifacts?.files.map((file) => ({
        relativePath: file.relativePath,
        content: file.content,
      })),
      direct.artifacts?.files.map((file) => ({
        relativePath: file.relativePath,
        content: file.content,
      })),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('NodeHttpTransport smoke fetch against local http server', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/openapi.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(OPENAPI_JSON);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/openapi.json`;
  try {
    const result = await fetchOpenApiSpecUrl(url, {
      transport: new NodeHttpTransport(),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.text, OPENAPI_JSON);
      assert.equal(result.fileName, 'openapi.json');
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
