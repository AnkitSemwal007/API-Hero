import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  RuntimeBody,
  RuntimeJsonValue,
  AuthenticatedRequest,
} from '../models/request';
import {
  DefaultRequestExecutor,
  graphqlEnvelopeFromJson,
  prepareGraphqlHttpRequest,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from '.';
import { SECRET_SCRUB_MASK } from '../shared';

const GRAPHQL_OK: HttpTransportResponse = {
  statusCode: 200,
  statusText: 'OK',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: new TextEncoder().encode('{"data":{"user":{"name":"Ada"}}}'),
  finalUrl: 'https://example.test/graphql',
  redirected: false,
  redirectCount: 0,
};

class FakeTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];

  public constructor(
    private readonly handler: (
      request: HttpTransportRequest,
    ) => Promise<HttpTransportResponse> = async () => GRAPHQL_OK,
  ) {}

  public execute(
    request: HttpTransportRequest,
  ): Promise<HttpTransportResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

function runtimeRequest(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  const url = overrides.url ?? 'https://example.test/graphql';
  const resolution = overrides.resolution ?? {
    kind: 'resolved' as const,
    presentationUrl: url,
    sensitiveVariableNames: [],
    sensitiveHeaderNames: [],
    sensitiveQueryParameterNames: [],
  };
  return {
    id: 'test#request-1',
    method: 'POST',
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

function jsonBody(value: unknown): RuntimeBody {
  const content = JSON.stringify(value);
  return {
    type: 'json',
    content,
    value: value as RuntimeJsonValue,
  };
}

function graphqlRequest(
  payload: unknown,
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  const body = jsonBody(payload);
  return runtimeRequest({
    method: 'POST',
    protocol: 'graphql',
    body,
    bodyType: 'json',
    ...overrides,
  });
}

function decodeBody(request: HttpTransportRequest | undefined): unknown {
  assert.ok(request?.body);
  return JSON.parse(new TextDecoder().decode(request.body));
}

test('HTTP request with no protocol uses transport unchanged and omits graphql', async () => {
  const transport = new FakeTransport();
  const body = jsonBody({ name: 'Ada' });
  const result = await new DefaultRequestExecutor(transport).execute(
    runtimeRequest({
      method: 'POST',
      url: 'https://example.test/users',
      body,
      bodyType: 'json',
    }),
  );
  assert.equal(result.success, true);
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0]?.method, 'POST');
  assert.equal(
    new TextDecoder().decode(transport.requests[0]!.body!),
    body.content,
  );
  if (result.success) {
    assert.equal(result.graphql, undefined);
  }
});

test('explicit @protocol http uses the HTTP path and omits graphql', async () => {
  const transport = new FakeTransport();
  const body = jsonBody({ ping: true });
  const result = await new DefaultRequestExecutor(transport).execute(
    runtimeRequest({
      protocol: 'http',
      method: 'POST',
      url: 'https://example.test/users',
      body,
      bodyType: 'json',
    }),
  );
  assert.equal(result.success, true);
  assert.equal(transport.requests.length, 1);
  if (result.success) {
    assert.equal(result.graphql, undefined);
  }
});

test('GraphQL query sends canonical JSON and attaches a data envelope', async () => {
  const transport = new FakeTransport();
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({
      query: 'query GetUser { user { name } }',
    }),
  );
  assert.equal(result.success, true);
  assert.equal(transport.requests.length, 1);
  assert.deepEqual(decodeBody(transport.requests[0]), {
    query: 'query GetUser { user { name } }',
  });
  const contentType = transport.requests[0]?.headers.find(
    (header) => header.name.toLowerCase() === 'content-type',
  );
  assert.equal(contentType?.value, 'application/json');
  if (result.success) {
    assert.deepEqual(result.graphql, {
      validEnvelope: true,
      hasData: true,
      hasErrors: false,
      errorCount: 0,
      errorMessages: [],
    });
  }
});

test('GraphQL mutation query string is sent on the HTTP path', async () => {
  const transport = new FakeTransport();
  await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({
      query: 'mutation CreateUser($name: String!) { createUser(name: $name) { id } }',
      variables: { name: 'Ada' },
    }),
  );
  const payload = decodeBody(transport.requests[0]) as { query: string };
  assert.match(payload.query, /mutation CreateUser/u);
});

test('GraphQL variables are taken from already-resolved body content', async () => {
  const transport = new FakeTransport();
  await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({
      query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
      variables: { id: 'user-42' },
    }),
  );
  const payload = decodeBody(transport.requests[0]) as {
    variables: { id: string };
  };
  assert.equal(payload.variables.id, 'user-42');
  assert.doesNotMatch(
    new TextDecoder().decode(transport.requests[0]!.body!),
    /\{\{/u,
  );
});

test('GraphQL operationName is present in the serialized transport JSON', async () => {
  const transport = new FakeTransport();
  await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({
      query: 'query GetUser { user { name } }',
      operationName: 'GetUser',
    }),
  );
  const payload = decodeBody(transport.requests[0]) as {
    operationName: string;
  };
  assert.equal(payload.operationName, 'GetUser');
});

test('empty operationName is omitted from the transport JSON', async () => {
  const transport = new FakeTransport();
  await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({
      query: 'query GetUser { user { name } }',
      operationName: '',
    }),
  );
  const payload = decodeBody(transport.requests[0]) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'operationName'), false);
});

test('Authorization header is preserved on the GraphQL HTTP request', async () => {
  const transport = new FakeTransport();
  await new DefaultRequestExecutor(transport).execute(
    graphqlRequest(
      { query: 'query { user { name } }' },
      {
        headers: [
          { name: 'Authorization', value: 'Bearer test-token' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
    ),
  );
  const auth = transport.requests[0]?.headers.find(
    (header) => header.name.toLowerCase() === 'authorization',
  );
  assert.equal(auth?.value, 'Bearer test-token');
});

test('prepareGraphqlHttpRequest keeps Authorization and adds Content-Type', () => {
  const prepared = prepareGraphqlHttpRequest(
    graphqlRequest(
      { query: 'query { user { name } }' },
      {
        headers: [{ name: 'Authorization', value: 'Bearer test-token' }],
      },
    ),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) {
    return;
  }
  const auth = prepared.headers.find(
    (header) => header.name.toLowerCase() === 'authorization',
  );
  assert.equal(auth?.value, 'Bearer test-token');
  const contentType = prepared.headers.find(
    (header) => header.name.toLowerCase() === 'content-type',
  );
  assert.equal(contentType?.value, 'application/json');
});

test('invalid GraphQL body fails before transport', async () => {
  const transport = new FakeTransport();
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({ foo: 1 }),
  );
  assert.equal(result.success, false);
  assert.equal(transport.requests.length, 0);
  if (!result.success) {
    assert.equal(result.error.code, 'UNSUPPORTED_BODY');
    assert.match(result.error.message, /query/iu);
  }
});

test('unknown protocol fails before transport and never falls through to HTTP', async () => {
  const transport = new FakeTransport();
  const request = {
    ...runtimeRequest({
      body: jsonBody({ hello: true }),
      bodyType: 'json',
    }),
    protocol: 'mqtt',
  } as unknown as AuthenticatedRequest;
  const result = await new DefaultRequestExecutor(transport).execute(request);
  assert.equal(result.success, false);
  assert.equal(transport.requests.length, 0);
  if (!result.success) {
    assert.equal(result.error.code, 'UNSUPPORTED_BODY');
    assert.match(result.error.message, /protocol/iu);
  }
});

test('malformed GraphQL errors field is an invalid envelope', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_OK,
    body: new TextEncoder().encode('{"errors":"nope"}'),
  }));
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({ query: '{ ping }' }),
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.graphql?.validEnvelope, false);
    assert.equal(result.graphql?.hasErrors, false);
  }
});

test('GraphQL HTTP 200 with errors still returns transport success plus envelope', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_OK,
    body: new TextEncoder().encode('{"errors":[{"message":"nope"}]}'),
  }));
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({ query: 'query { user { name } }' }),
  );
  assert.equal(result.success, true);
  assert.equal(transport.requests.length, 1);
  if (result.success) {
    assert.equal(result.graphql?.validEnvelope, true);
    assert.equal(result.graphql?.hasErrors, true);
    assert.equal(result.graphql?.hasData, false);
    assert.deepEqual(result.graphql?.errorMessages, ['nope']);
  }
});

test('GraphQL partial success (data and errors) is not a valid operation envelope pass', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_OK,
    body: new TextEncoder().encode(
      '{"data":{"user":{"name":"Ada"}},"errors":[{"message":"partial"}]}',
    ),
  }));
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({ query: 'query { user { name } }' }),
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.graphql?.hasData, true);
    assert.equal(result.graphql?.hasErrors, true);
    assert.equal(result.response.body.json !== undefined, true);
  }
});

test('ordinary GraphQL error messages are not over-redacted', async () => {
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_OK,
    body: new TextEncoder().encode(
      '{"errors":[{"message":"Cannot query field \\"foo\\" on type \\"Query\\""}]}',
    ),
  }));
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest({ query: 'query { foo }' }),
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.graphql?.errorMessages, [
      'Cannot query field "foo" on type "Query"',
    ]);
  }
});

test('GraphQL error messages redact Bearer, JWT, and known secrets', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signaturevaluexx';
  const token = 'sekrit-token-value';
  const apiKey = 'sk-live-not-a-jwt-or-bearer-key';
  const envelope = graphqlEnvelopeFromJson(
    {
      errors: [
        {
          message: `Unauthorized Bearer ${token} jwt ${jwt} key ${apiKey}`,
        },
        { message: 'Cannot query field "foo" on type "Query"' },
      ],
    },
    [token, apiKey],
  );
  const joined = envelope.errorMessages.join('\n');
  assert.match(joined, /Cannot query field "foo" on type "Query"/u);
  assert.doesNotMatch(joined, new RegExp(token, 'u'));
  assert.doesNotMatch(joined, new RegExp(apiKey, 'u'));
  assert.doesNotMatch(joined, /eyJhbGciOiJIUzI1NiJ9/u);
  assert.match(joined, new RegExp(SECRET_SCRUB_MASK, 'u'));
});

test('executor redacts GraphQL errors that echo sensitive headers and variables', async () => {
  const token = 'sekrit-token-value';
  const transport = new FakeTransport(async () => ({
    ...GRAPHQL_OK,
    body: new TextEncoder().encode(
      JSON.stringify({
        errors: [
          {
            message: `Variable "$token" got invalid value "${token}"`,
          },
        ],
      }),
    ),
  }));
  const result = await new DefaultRequestExecutor(transport).execute(
    graphqlRequest(
      {
        query: 'query Q($token: String!) { q }',
        variables: { token },
      },
      {
        headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
        resolution: {
          kind: 'resolved',
          presentationUrl: 'https://example.test/graphql',
          sensitiveVariableNames: ['token'],
          sensitiveHeaderNames: ['authorization'],
          sensitiveQueryParameterNames: [],
        },
      },
    ),
  );
  assert.equal(result.success, true);
  if (result.success) {
    const message = result.graphql?.errorMessages[0] ?? '';
    assert.doesNotMatch(message, new RegExp(token, 'u'));
    assert.match(message, new RegExp(SECRET_SCRUB_MASK, 'u'));
    assert.match(message, /Variable "\$token" got invalid value/u);
  }
});
