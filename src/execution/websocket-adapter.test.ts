import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { WebSocketServer, type WebSocket as WsClient } from 'ws';

import type { AuthenticatedRequest, RuntimeBody } from '../models/request';
import {
  DefaultRequestExecutor,
  NodeWebSocketTransport,
  WebSocketTransportError,
  prepareWebsocketSession,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from '.';

const HTTP_OK: HttpTransportResponse = {
  statusCode: 204,
  statusText: 'No Content',
  headers: [],
  body: new Uint8Array(0),
  finalUrl: 'https://example.test/',
  redirected: false,
  redirectCount: 0,
};

class FakeHttpTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];

  public execute(
    request: HttpTransportRequest,
  ): Promise<HttpTransportResponse> {
    this.requests.push(request);
    return Promise.resolve(HTTP_OK);
  }
}

function jsonBody(value: unknown): RuntimeBody {
  const content = JSON.stringify(value);
  return {
    type: 'json',
    content,
    value: value as never,
  };
}

function runtimeRequest(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  const url = overrides.url ?? 'ws://example.test/socket';
  const resolution = overrides.resolution ?? {
    kind: 'resolved' as const,
    presentationUrl: url,
    sensitiveVariableNames: [],
    sensitiveHeaderNames: [],
    sensitiveQueryParameterNames: [],
  };
  return {
    id: 'test#ws-1',
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
    protocol: 'websocket',
    ...overrides,
    resolution,
  };
}

async function echoServer(handler?: (socket: WsClient) => void): Promise<{
  readonly url: string;
  readonly sockets: WsClient[];
  readonly close: () => Promise<void>;
}> {
  const sockets: WsClient[] = [];
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (socket) => {
    sockets.push(socket);
    if (handler !== undefined) {
      handler(socket);
      return;
    }
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        socket.send(data.toString());
      }
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('echo server has no port');
  }
  return {
    url: `ws://127.0.0.1:${address.port}`,
    sockets,
    async close() {
      for (const socket of sockets) {
        try {
          socket.terminate();
        } catch {
          // already closed
        }
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}

function allSocketsClosed(sockets: readonly WsClient[]): boolean {
  return sockets.every(
    (socket) => socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING,
  );
}

test('wss URLs are accepted without treating them as HTTP', () => {
  const prepared = prepareWebsocketSession(
    runtimeRequest({
      url: 'wss://example.test/v1',
      resolution: {
        kind: 'resolved',
        presentationUrl: 'wss://example.test/v1',
        sensitiveVariableNames: [],
        sensitiveHeaderNames: [],
        sensitiveQueryParameterNames: [],
      },
    }),
  );
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.url.startsWith('wss:'), true);
  }
});

test('prepareWebsocketSession accepts ws and wss URLs', () => {
  const ws = prepareWebsocketSession(
    runtimeRequest({ url: 'ws://example.test/v1' }),
  );
  assert.equal(ws.ok, true);
  const wss = prepareWebsocketSession(
    runtimeRequest({
      url: 'wss://example.test/v1',
      resolution: {
        kind: 'resolved',
        presentationUrl: 'wss://example.test/v1',
        sensitiveVariableNames: [],
        sensitiveHeaderNames: [],
        sensitiveQueryParameterNames: [],
      },
    }),
  );
  assert.equal(wss.ok, true);
});

test('prepareWebsocketSession rejects HTTP URLs and binary bodies', () => {
  const http = prepareWebsocketSession(
    runtimeRequest({ url: 'https://example.test/socket' }),
  );
  assert.equal(http.ok, false);
  const binary = prepareWebsocketSession(
    runtimeRequest({
      url: 'ws://example.test',
      bodyType: 'binary',
      body: { type: 'binary', content: '' },
    }),
  );
  assert.equal(binary.ok, false);
});

test('malformed WebSocket URL errors redact userinfo', () => {
  const result = prepareWebsocketSession(
    runtimeRequest({
      url: 'https://user:secret-pass@example.test/socket',
      resolution: {
        kind: 'resolved',
        presentationUrl: 'https://user:secret-pass@example.test/socket',
        sensitiveVariableNames: [],
        sensitiveHeaderNames: [],
        sensitiveQueryParameterNames: [],
      },
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.doesNotMatch(result.error.message, /secret-pass/u);
  }
});

test('HTTP requests never call the WebSocket transport', async () => {
  const http = new FakeHttpTransport();
  const result = await new DefaultRequestExecutor(
    http,
    { now: () => 1 },
    {
      execute() {
        return Promise.reject(new Error('websocket transport must not run'));
      },
    },
  ).execute(
    runtimeRequest({
      protocol: undefined,
      url: 'https://example.test/users',
      resolution: {
        kind: 'resolved',
        presentationUrl: 'https://example.test/users',
        sensitiveVariableNames: [],
        sensitiveHeaderNames: [],
        sensitiveQueryParameterNames: [],
      },
    }),
  );
  assert.equal(result.success, true);
  assert.equal(http.requests.length, 1);
});

test('WebSocket echo send/receive closes the socket', async () => {
  const server = await echoServer();
  try {
    const http = new FakeHttpTransport();
    const result = await new DefaultRequestExecutor(http).execute(
      runtimeRequest({
        url: server.url,
        body: jsonBody({ type: 'ping' }),
        bodyType: 'json',
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
    );
    assert.equal(
      result.success,
      true,
      result.success ? 'ok' : `${result.error.code}: ${result.error.message}`,
    );
    assert.equal(http.requests.length, 0);
    if (result.success) {
      assert.equal(result.websocket?.connected, true);
      assert.equal(result.websocket?.sent, true);
      assert.equal(result.websocket?.received, true);
      assert.equal(result.websocket?.closed, true);
      assert.equal(result.websocket?.sentMessage, '{"type":"ping"}');
      assert.equal(result.response.body.text, '{"type":"ping"}');
      assert.deepEqual(result.response.body.json, { type: 'ping' });
      assert.equal(result.response.statusText, 'received');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('connection failure does not leak sockets', async () => {
  const http = new FakeHttpTransport();
  const result = await new DefaultRequestExecutor(http).execute(
    runtimeRequest({
      url: 'ws://127.0.0.1:1',
      resolution: {
        kind: 'resolved',
        presentationUrl: 'ws://127.0.0.1:1',
        sensitiveVariableNames: [],
        sensitiveHeaderNames: [],
        sensitiveQueryParameterNames: [],
      },
    }),
  );
  assert.equal(result.success, false);
  assert.equal(http.requests.length, 0);
  if (!result.success) {
    assert.match(result.error.message, /WebSocket/u);
  }
});

test('receive timeout closes the socket', async () => {
  const server = await echoServer((socket) => {
    socket.on('message', () => undefined);
  });
  try {
    const result = await new DefaultRequestExecutor(
      new FakeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: server.url,
        timeoutMs: 80,
        body: { type: 'text', content: 'ping' },
        bodyType: 'text',
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, 'TIMEOUT');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('cancellation closes the socket', async () => {
  const server = await echoServer((socket) => {
    socket.on('message', () => undefined);
  });
  const controller = new AbortController();
  try {
    const pending = new DefaultRequestExecutor(new FakeHttpTransport()).execute(
      runtimeRequest({
        url: server.url,
        body: { type: 'text', content: 'ping' },
        bodyType: 'text',
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    const result = await pending;
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, 'CANCELLED');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('send failure is classified without hanging', async () => {
  const result = await new DefaultRequestExecutor(
    new FakeHttpTransport(),
    { now: () => 1 },
    {
      execute() {
        return Promise.reject(
          new WebSocketTransportError(
            'send',
            'The WebSocket message could not be sent.',
          ),
        );
      },
    },
  ).execute(runtimeRequest());
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'NETWORK');
    assert.match(result.error.message, /could not be sent/u);
    assert.equal(result.error.retryable, false);
  }
});

test('unexpected transport exception does not hang', async () => {
  const result = await new DefaultRequestExecutor(
    new FakeHttpTransport(),
    { now: () => 1 },
    {
      execute() {
        return Promise.reject(new Error('socket exploded'));
      },
    },
  ).execute(runtimeRequest());
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'UNEXPECTED');
  }
});

test('binary frames are rejected and the socket is closed', async () => {
  const server = await echoServer((socket) => {
    socket.on('message', () => {
      socket.send(Buffer.from([1, 2, 3]), { binary: true });
    });
  });
  try {
    const result = await new DefaultRequestExecutor(
      new FakeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: server.url,
        body: { type: 'text', content: 'ping' },
        bodyType: 'text',
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, 'UNSUPPORTED_BODY');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('transport exception path terminates the socket', async () => {
  const server = await echoServer((socket) => {
    socket.on('message', () => undefined);
  });
  try {
    const transport = new NodeWebSocketTransport();
    const controller = new AbortController();
    const pending = transport.execute(
      {
        url: server.url,
        headers: [],
        message: 'ping',
        ssl: { verifyCertificates: true, extensions: {} },
      },
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assert.rejects(pending);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('the first of two text frames is the response', async () => {
  const server = await echoServer((socket) => {
    socket.on('message', () => {
      socket.send('first');
      socket.send('second');
    });
  });
  try {
    const result = await new DefaultRequestExecutor(
      new FakeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: server.url,
        body: { type: 'text', content: 'ping' },
        bodyType: 'text',
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.body.text, 'first');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('omitted outgoing message still receives one text frame', async () => {
  const server = await echoServer((socket) => {
    socket.send('hello');
  });
  try {
    const result = await new DefaultRequestExecutor(
      new FakeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: server.url,
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.body.text, 'hello');
      assert.equal(result.websocket?.sent, false);
      assert.equal(result.websocket?.sentMessage, undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});

test('malformed JSON is kept as text without a parsed json body', async () => {
  const server = await echoServer((socket) => {
    socket.on('message', () => {
      socket.send('{not-json');
    });
  });
  try {
    const result = await new DefaultRequestExecutor(
      new FakeHttpTransport(),
    ).execute(
      runtimeRequest({
        url: server.url,
        body: { type: 'text', content: 'ping' },
        bodyType: 'text',
        resolution: {
          kind: 'resolved',
          presentationUrl: server.url,
          sensitiveVariableNames: [],
          sensitiveHeaderNames: [],
          sensitiveQueryParameterNames: [],
        },
      }),
    );
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.response.body.text, '{not-json');
      assert.equal(result.response.body.json, undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(allSocketsClosed(server.sockets), true);
  } finally {
    await server.close();
  }
});
