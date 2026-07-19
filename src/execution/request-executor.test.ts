import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import type {
  RuntimeBody,
  AuthenticatedRequest,
} from '../models/request';
import {
  DefaultRequestExecutor,
  HttpTransportError,
  HttpTransportInvariantError,
  NodeHttpTransport,
  type ExecutionClock,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from '.';

const EMPTY_RESPONSE: HttpTransportResponse = {
  statusCode: 204,
  statusText: 'No Content',
  headers: [],
  body: new Uint8Array(0),
  finalUrl: 'http://example.test/resource',
  redirected: false,
  redirectCount: 0,
};

class FakeTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];
  public readonly contexts: { readonly signal: AbortSignal; readonly maxResponseBytes?: number }[] =
    [];

  public constructor(
    private readonly handler: (
      request: HttpTransportRequest,
      signal: AbortSignal,
    ) => Promise<HttpTransportResponse> = async () => EMPTY_RESPONSE,
  ) {}

  public execute(
    request: HttpTransportRequest,
    context: { readonly signal: AbortSignal; readonly maxResponseBytes?: number },
  ): Promise<HttpTransportResponse> {
    this.requests.push(request);
    this.contexts.push(context);
    return this.handler(request, context.signal);
  }
}

class SequenceClock implements ExecutionClock {
  public constructor(private readonly values: number[]) {}

  public now(): number {
    const value = this.values.shift();
    assert.notEqual(value, undefined);
    return value!;
  }
}

function runtimeRequest(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  const url = overrides.url ?? 'http://example.test/resource';
  const resolution = overrides.resolution ?? {
    kind: 'resolved' as const,
    presentationUrl: url,
    sensitiveVariableNames: [],
    sensitiveHeaderNames: [],
    sensitiveQueryParameterNames: [],
  };
  return {
    id: 'test#request-1',
    method: 'GET',
    url,
    headers: [],
    queryParameters: [],
    pathParameters: [],
    cookies: [],
    bodyType: 'none',
    authentication: {
      kind: 'resolved',
      scheme: 'none',
      material: {},
      extensions: {},
    },
    variables: [],
    environment: { kind: 'none', extensions: {} },
    metadata: { declarationIndex: 0, tags: [], extensions: {} },
    configuration: { directives: [], extensions: {} },
    redirectPolicy: { mode: 'follow' },
    ssl: { verifyCertificates: true, extensions: {} },
    executionExtensions: {},
    authenticationStage: 'authenticated',
    ...overrides,
    resolution,
  };
}

test('executes every supported HTTP method', async (t) => {
  for (const method of [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ] as const) {
    await t.test(method, async () => {
      const transport = new FakeTransport();
      const result = await new DefaultRequestExecutor(transport).execute(
        runtimeRequest({ method }),
      );
      assert.equal(result.success, true);
      assert.equal(transport.requests[0]?.method, method);
    });
  }
});

test('uses masked resolution URLs in results while transport receives the real URL', async () => {
  const transport = new FakeTransport(async (sent) => ({
    ...EMPTY_RESPONSE,
    finalUrl: sent.url,
  }));
  const request = runtimeRequest({
    url: 'http://example.test/?token=private',
    resolution: {
      kind: 'resolved',
      presentationUrl: 'http://example.test/?token=••••••••',
      sensitiveVariableNames: ['token'],
      sensitiveHeaderNames: [],
      sensitiveQueryParameterNames: ['token'],
    },
  });

  const result = await new DefaultRequestExecutor(transport).execute(request);

  assert.equal(transport.requests[0]?.url, 'http://example.test/?token=private');
  assert.equal(result.request?.url, 'http://example.test/?token=••••••••');
  assert.equal(result.success && result.response.url, 'http://example.test/?token=••••••••');
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('uses URL query as authoritative and preserves ordered duplicate headers', async () => {
  const transport = new FakeTransport();
  const request = runtimeRequest({
    url: 'http://example.test/items?x=1&x=2&flag',
    queryParameters: [
      { name: 'x', value: '1' },
      { name: 'x', value: '2' },
      { name: 'flag' },
    ],
    headers: [
      { name: 'X-Value', value: 'one' },
      { name: 'x-value', value: 'two' },
    ],
  });

  await new DefaultRequestExecutor(transport).execute(request);

  assert.equal(
    transport.requests[0]?.url,
    'http://example.test/items?x=1&x=2&flag',
  );
  assert.deepEqual(transport.requests[0]?.headers, request.headers);
});

test('serializes JSON, text, raw, form, and empty bodies from authoritative content', async (t) => {
  const cases: readonly [string, RuntimeBody | undefined, string][] = [
    ['json', { type: 'json', content: '{"x":1}', value: { x: 1 } }, '{"x":1}'],
    ['text', { type: 'text', content: 'hello' }, 'hello'],
    ['raw', { type: 'raw', content: '\u0000raw' }, '\u0000raw'],
    [
      'form',
      {
        type: 'form',
        content: 'x=1&x=2&flag',
        fields: [{ name: 'different', value: 'projection' }],
      },
      'x=1&x=2&flag',
    ],
    ['empty', undefined, ''],
  ];
  for (const [name, body, expected] of cases) {
    await t.test(name, async () => {
      const transport = new FakeTransport();
      await new DefaultRequestExecutor(transport).execute(
        runtimeRequest({
          ...(body === undefined ? {} : { body }),
          bodyType: body?.type ?? 'none',
        }),
      );
      const bytes = transport.requests[0]?.body;
      assert.equal(
        bytes === undefined ? '' : new TextDecoder().decode(bytes),
        expected,
      );
    });
  }
});

test('supports only an explicitly empty multipart placeholder', async () => {
  const transport = new FakeTransport();
  const executor = new DefaultRequestExecutor(transport);
  const empty = await executor.execute(
    runtimeRequest({
      bodyType: 'multipart',
      body: { type: 'multipart', content: '', parts: [] },
    }),
  );
  const nonEmpty = await executor.execute(
    runtimeRequest({
      bodyType: 'multipart',
      body: {
        type: 'multipart',
        content: 'part',
        parts: [],
      },
    }),
  );

  assert.equal(empty.success, true);
  assert.equal(transport.requests[0]?.body?.byteLength, 0);
  assert.equal(nonEmpty.success, false);
  if (!nonEmpty.success) {
    assert.equal(nonEmpty.error.code, 'UNSUPPORTED_BODY');
  }
  assert.equal(transport.requests.length, 1);
});

test('returns a structured unsupported failure for binary bodies', async () => {
  const result = await new DefaultRequestExecutor(new FakeTransport()).execute(
    runtimeRequest({
      bodyType: 'binary',
      body: { type: 'binary', content: './file.bin' },
    }),
  );
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'UNSUPPORTED_BODY');
  }
});

test('projects response metadata, text, JSON, size, timing, and duplicate headers immutably', async () => {
  const raw: HttpTransportResponse = {
    statusCode: 201,
    statusText: 'Created',
    headers: [
      { name: 'Content-Type', value: 'application/problem+json; charset=utf-8' },
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Set-Cookie', value: 'b=2' },
    ],
    body: new TextEncoder().encode('{"ok":true}'),
    finalUrl: 'http://example.test/final',
    redirected: true,
    redirectCount: 2,
  };
  const executor = new DefaultRequestExecutor(
    new FakeTransport(async () => raw),
    new SequenceClock([1_000, 1_025]),
  );

  const result = await executor.execute(runtimeRequest());

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.request, {
      method: 'GET',
      url: 'http://example.test/resource',
    });
    assert.equal(result.response.statusCode, 201);
    assert.equal(result.response.contentType, raw.headers[0]?.value);
    assert.equal(result.response.body.text, '{"ok":true}');
    assert.deepEqual(result.response.body.json, { ok: true });
    assert.equal(result.response.bodySizeBytes, 11);
    assert.equal(result.response.url, 'http://example.test/final');
    assert.equal(result.response.redirected, true);
    assert.equal(result.response.redirectCount, 2);
    assert.equal(result.timing.durationMs, 25);
    assert.equal(result.timing, result.response.timing);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.response));
    assert.ok(Object.isFrozen(result.response.headers));
    assert.ok(Object.isFrozen(result.response.body.bytes));
    assert.ok(Object.isFrozen(result.response.body.json));
  }
  raw.body[0] = 0;
  assert.equal(result.success && result.response.body.text, '{"ok":true}');
  assert.equal(result.success && result.response.body.bytes.at(0), '{'.charCodeAt(0));
});

test('does not decode an untyped binary response as text', async () => {
  const result = await new DefaultRequestExecutor(
    new FakeTransport(async () => ({
      ...EMPTY_RESPONSE,
      statusCode: 200,
      body: Uint8Array.from([0, 255]),
    })),
  ).execute(runtimeRequest());
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(
      [...result.response.body.bytes],
      [0, 255],
    );
    assert.equal(result.response.body.text, undefined);
  }
});

test('handles empty bodies and unexpected content types', async () => {
  const empty = await new DefaultRequestExecutor(
    new FakeTransport(async () => ({
      ...EMPTY_RESPONSE,
      statusCode: 204,
      statusText: 'No Content',
      headers: [],
      body: new Uint8Array(0),
    })),
  ).execute(runtimeRequest());
  assert.equal(empty.success, true);
  if (empty.success) {
    assert.equal(empty.response.bodySizeBytes, 0);
    assert.equal(empty.response.body.text, undefined);
    assert.equal(empty.response.contentType, undefined);
  }

  const weird = await new DefaultRequestExecutor(
    new FakeTransport(async () => ({
      ...EMPTY_RESPONSE,
      statusCode: 200,
      headers: [{ name: 'Content-Type', value: 'application/x-unknown-binary' }],
      body: Uint8Array.from([1, 2, 3]),
    })),
  ).execute(runtimeRequest());
  assert.equal(weird.success, true);
  if (weird.success) {
    assert.equal(weird.response.contentType, 'application/x-unknown-binary');
    assert.equal(weird.response.body.text, undefined);
    assert.deepEqual([...weird.response.body.bytes], [1, 2, 3]);
  }
});

test('classifies malformed and non-HTTP URLs without invoking transport', async (t) => {
  for (const url of ['not a url', 'file:///tmp/value']) {
    await t.test(url, async () => {
      const transport = new FakeTransport();
      const result = await new DefaultRequestExecutor(transport).execute(
        runtimeRequest({ url }),
      );
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, 'MALFORMED_URL');
        assert.ok(Object.isFrozen(result.error.cause));
      }
      assert.equal(transport.requests.length, 0);
    });
  }
});

test('redacts URL userinfo in malformed-URL messages', async () => {
  const result = await new DefaultRequestExecutor(new FakeTransport()).execute(
    runtimeRequest({ url: 'http://secret:token@exa mple.test/' }),
  );
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'MALFORMED_URL');
    assert.equal(result.error.message.includes('secret'), false);
    assert.equal(result.error.message.includes('token'), false);
    assert.equal(result.error.message.includes('***@'), true);
  }
});

test('classifies transport and unexpected errors without leaking mutable causes', async (t) => {
  const cases: readonly [
    string,
    Error,
    'DNS' | 'SSL_TLS' | 'CONNECTION_REFUSED' | 'NETWORK' | 'REDIRECT' | 'RESPONSE_TOO_LARGE' | 'UNEXPECTED',
    boolean,
  ][] = [
    ['dns', new HttpTransportError('dns', 'lookup failed', 'ENOTFOUND'), 'DNS', true],
    ['ssl', new HttpTransportError('ssl-tls', 'certificate failed', 'CERT_X'), 'SSL_TLS', false],
    [
      'refused',
      new HttpTransportError('connection-refused', 'refused', 'ECONNREFUSED'),
      'CONNECTION_REFUSED',
      true,
    ],
    ['network', new HttpTransportError('network', 'socket closed', 'EPIPE'), 'NETWORK', true],
    [
      'redirect',
      new HttpTransportError('redirect', 'redirect rejected by policy'),
      'REDIRECT',
      false,
    ],
    [
      'response-too-large',
      new HttpTransportError('response-too-large', 'too big', 'RESPONSE_TOO_LARGE'),
      'RESPONSE_TOO_LARGE',
      false,
    ],
    ['unexpected', new Error('secret implementation detail'), 'UNEXPECTED', false],
  ];
  for (const [name, error, expected, retryable] of cases) {
    await t.test(name, async () => {
      const result = await new DefaultRequestExecutor(
        new FakeTransport(async () => {
          throw error;
        }),
      ).execute(runtimeRequest());
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, expected);
        assert.equal(result.error.retryable, retryable);
        assert.ok(Object.isFrozen(result.error));
        assert.ok(Object.isFrozen(result.error.cause));
        if (expected === 'UNEXPECTED') {
          assert.equal(result.error.message.includes(error.message), false);
        }
      }
    });
  }
});

test('times out promptly even when a transport ignores cancellation', async () => {
  const transport = new FakeTransport(
    async () => new Promise<HttpTransportResponse>(() => undefined),
  );
  const result = await new DefaultRequestExecutor(transport).execute(
    runtimeRequest({ timeoutMs: 5 }),
  );
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'TIMEOUT');
  }
  assert.equal(transport.requests[0] !== undefined, true);
});

test('caller cancellation takes effect and reaches the transport signal', async () => {
  let observedSignal: AbortSignal | undefined;
  const transport = new FakeTransport(
    async (_request, signal) => {
      observedSignal = signal;
      return new Promise<HttpTransportResponse>(() => undefined);
    },
  );
  const controller = new AbortController();
  const execution = new DefaultRequestExecutor(transport).execute(
    runtimeRequest({ timeoutMs: 10_000 }),
    { signal: controller.signal },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await execution;

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'CANCELLED');
  }
  assert.equal(observedSignal?.aborted, true);
});

test('an already-cancelled call wins before URL validation or transport work', async () => {
  const controller = new AbortController();
  controller.abort();
  const transport = new FakeTransport();
  const result = await new DefaultRequestExecutor(transport).execute(
    runtimeRequest({ url: 'invalid' }),
    { signal: controller.signal },
  );
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'CANCELLED');
  }
  assert.equal(transport.requests.length, 0);
});

test('per-call timeout overrides the request timeout', async () => {
  const result = await new DefaultRequestExecutor(
    new FakeTransport(
      async () => new Promise<HttpTransportResponse>(() => undefined),
    ),
  ).execute(runtimeRequest({ timeoutMs: 10_000 }), { timeoutMs: 5 });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'TIMEOUT');
  }
});

test('invalid timeout is a programming invariant failure', async () => {
  await assert.rejects(
    new DefaultRequestExecutor(new FakeTransport()).execute(runtimeRequest(), {
      timeoutMs: -1,
    }),
    TypeError,
  );
});

test('invalid transport responses throw a transport invariant failure', async () => {
  const invalid = {
    ...EMPTY_RESPONSE,
    statusCode: 0,
  };
  await assert.rejects(
    new DefaultRequestExecutor(
      new FakeTransport(async () => invalid),
    ).execute(runtimeRequest()),
    HttpTransportInvariantError,
  );
});

test('late transport completion cannot alter a returned timeout result', async () => {
  let resolveTransport!: (response: HttpTransportResponse) => void;
  const resultPromise = new DefaultRequestExecutor(
    new FakeTransport(
      async () =>
        new Promise<HttpTransportResponse>((resolve) => {
          resolveTransport = resolve;
        }),
    ),
  ).execute(runtimeRequest(), { timeoutMs: 5 });
  const result = await resultPromise;
  resolveTransport({ ...EMPTY_RESPONSE, statusCode: 200 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'TIMEOUT');
  }
  assert.ok(Object.isFrozen(result));
});

test('Node transport executes loopback requests and follows redirects', async () => {
  const received: { method?: string; body?: string; header?: string } = {};
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/final' });
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      received.method = request.method;
      received.body = Buffer.concat(chunks).toString('utf8');
      received.header = request.headers['x-test'] as string | undefined;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Set-Cookie', ['a=1', 'b=2']);
      response.end('{"local":true}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    const base = `http://127.0.0.1:${(address as { port: number }).port}`;
    const result = await new DefaultRequestExecutor(
      new NodeHttpTransport(),
    ).execute(
      runtimeRequest({
        method: 'POST',
        url: `${base}/redirect`,
        headers: [{ name: 'X-Test', value: 'preserved' }],
        bodyType: 'text',
        body: { type: 'text', content: 'payload' },
      }),
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.statusCode, 200);
      assert.equal(result.response.redirectCount, 1);
      assert.equal(result.response.url, `${base}/final`);
      assert.deepEqual(result.response.body.json, { local: true });
      assert.equal(
        result.response.headers.filter(
          (header) => header.name.toLowerCase() === 'set-cookie',
        ).length,
        2,
      );
    }
    assert.equal(received.method, 'GET');
    assert.equal(received.body, '');
    assert.equal(received.header, 'preserved');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('Node transport manual redirect returns the original response', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(307, { Location: '/never-followed' });
    response.end('redirect');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    const result = await new DefaultRequestExecutor(
      new NodeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: `http://127.0.0.1:${(address as { port: number }).port}/start`,
        redirectPolicy: { mode: 'manual' },
      }),
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.statusCode, 307);
      assert.equal(result.response.redirected, false);
      assert.equal(result.response.redirectCount, 0);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('preserves sensitive headers on same-origin redirects', async () => {
  const received: Record<string, string | string[] | undefined> = {};
  const server = http.createServer((request, response) => {
    if (request.url === '/start') {
      response.writeHead(302, { Location: '/final' });
      response.end();
      return;
    }
    received.authorization = request.headers.authorization;
    received.cookie = request.headers.cookie;
    received['proxy-authorization'] = request.headers['proxy-authorization'];
    received.host = request.headers.host;
    response.end('ok');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    const port = (address as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const result = await new DefaultRequestExecutor(
      new NodeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: `${base}/start`,
        headers: [
          { name: 'AUTHORIZATION', value: 'Bearer same-origin' },
          { name: 'Cookie', value: 'session=1' },
          { name: 'Proxy-Authorization', value: 'Basic abc' },
          { name: 'Host', value: `127.0.0.1:${port}` },
        ],
      }),
    );
    assert.equal(result.success, true);
    assert.equal(received.authorization, 'Bearer same-origin');
    assert.equal(received.cookie, 'session=1');
    assert.equal(received['proxy-authorization'], 'Basic abc');
    assert.equal(received.host, `127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('strips sensitive headers and Host on cross-origin redirects', async () => {
  const originA = http.createServer((request, response) => {
    assert.equal(request.url, '/start');
    const addressB = originB.address();
    assert.notEqual(addressB, null);
    assert.equal(typeof addressB, 'object');
    const portB = (addressB as { port: number }).port;
    response.writeHead(302, {
      Location: `http://127.0.0.1:${portB}/final`,
    });
    response.end();
  });
  const received: Record<string, string | string[] | undefined> = {};
  const originB = http.createServer((request, response) => {
    received.authorization = request.headers.authorization;
    received.cookie = request.headers.cookie;
    received['proxy-authorization'] = request.headers['proxy-authorization'];
    received.host = request.headers.host;
    received['x-custom'] = request.headers['x-custom'];
    received['x-api-key'] = request.headers['x-api-key'];
    response.end('destination');
  });

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      originA.once('error', reject);
      originA.listen(0, '127.0.0.1', resolve);
    }),
    new Promise<void>((resolve, reject) => {
      originB.once('error', reject);
      originB.listen(0, '127.0.0.1', resolve);
    }),
  ]);

  try {
    const addressA = originA.address();
    const addressB = originB.address();
    assert.notEqual(addressA, null);
    assert.notEqual(addressB, null);
    assert.equal(typeof addressA, 'object');
    assert.equal(typeof addressB, 'object');
    const portA = (addressA as { port: number }).port;
    const portB = (addressB as { port: number }).port;
    assert.notEqual(portA, portB);

    const result = await new DefaultRequestExecutor(
      new NodeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: `http://127.0.0.1:${portA}/start`,
        headers: [
          { name: 'AuThOrIzAtIoN', value: 'Bearer cross-origin' },
          { name: 'COOKIE', value: 'session=secret' },
          { name: 'proxy-authorization', value: 'Basic xyz' },
          { name: 'Host', value: `127.0.0.1:${portA}` },
          { name: 'X-Custom', value: 'kept' },
          { name: 'X-API-Key', value: 'auth-added-secret' },
        ],
        resolution: {
          kind: 'resolved',
          presentationUrl: `http://127.0.0.1:${portA}/start`,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: ['x-api-key'],
          sensitiveQueryParameterNames: [],
        },
      }),
    );

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.url, `http://127.0.0.1:${portB}/final`);
      assert.equal(result.response.redirectCount, 1);
    }
    assert.equal(received.authorization, undefined);
    assert.equal(received.cookie, undefined);
    assert.equal(received['proxy-authorization'], undefined);
    assert.equal(received.host, `127.0.0.1:${portB}`);
    assert.equal(received['x-custom'], 'kept');
    assert.equal(received['x-api-key'], undefined);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        originA.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ),
      new Promise<void>((resolve, reject) =>
        originB.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ),
    ]);
  }
});

test('classifies redirect policy, limit, and invalid targets as non-retryable REDIRECT', async (t) => {
  await t.test('policy rejection', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { Location: '/elsewhere' });
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      assert.notEqual(address, null);
      assert.equal(typeof address, 'object');
      const result = await new DefaultRequestExecutor(
        new NodeHttpTransport(),
      ).execute(
        runtimeRequest({
          url: `http://127.0.0.1:${(address as { port: number }).port}/`,
          redirectPolicy: { mode: 'error' },
        }),
      );
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, 'REDIRECT');
        assert.equal(result.error.retryable, false);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  });

  await t.test('redirect limit', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { Location: '/loop' });
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      assert.notEqual(address, null);
      assert.equal(typeof address, 'object');
      const result = await new DefaultRequestExecutor(
        new NodeHttpTransport(),
      ).execute(
        runtimeRequest({
          url: `http://127.0.0.1:${(address as { port: number }).port}/loop`,
          redirectPolicy: { mode: 'follow', maxRedirects: 1 },
        }),
      );
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, 'REDIRECT');
        assert.equal(result.error.retryable, false);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  });

  await t.test('unsupported redirect protocol', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { Location: 'ftp://example.test/file' });
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      assert.notEqual(address, null);
      assert.equal(typeof address, 'object');
      const result = await new DefaultRequestExecutor(
        new NodeHttpTransport(),
      ).execute(
        runtimeRequest({
          url: `http://127.0.0.1:${(address as { port: number }).port}/`,
        }),
      );
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.code, 'REDIRECT');
        assert.equal(result.error.retryable, false);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  });
});

test('rejects responses that exceed maxResponseBytes while buffering', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.write(Buffer.alloc(8, 1));
    response.write(Buffer.alloc(8, 2));
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    const result = await new DefaultRequestExecutor(
      new NodeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: `http://127.0.0.1:${(address as { port: number }).port}/`,
      }),
      { maxResponseBytes: 10 },
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, 'RESPONSE_TOO_LARGE');
      assert.equal(result.error.retryable, false);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  }
});

test('passes maxResponseBytes through to the transport context', async () => {
  const transport = new FakeTransport();
  await new DefaultRequestExecutor(transport).execute(
    runtimeRequest(),
    { maxResponseBytes: 128 },
  );
  assert.equal(transport.contexts[0]?.maxResponseBytes, 128);
});

test('treats maxResponseBytes 0 as unlimited', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(Buffer.alloc(32, 9));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    const result = await new DefaultRequestExecutor(
      new NodeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: `http://127.0.0.1:${(address as { port: number }).port}/`,
      }),
      { maxResponseBytes: 0 },
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.bodySizeBytes, 32);
      assert.equal(result.response.body.bytes.at(0), 9);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  }
});
