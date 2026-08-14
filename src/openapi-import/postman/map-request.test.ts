import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  HttpTransport,
  HttpTransportRequest,
  HttpTransportResponse,
} from '../../execution';
import { DefaultRequestExecutor } from '../../execution';
import {
  ExecutionOrchestrator,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatus,
  type ExecutionStatusPresenter,
} from '../../orchestration/execution-orchestrator';
import {
  parseGraphqlEditorEnvelope,
  parseSourceToRequestDocument,
} from '../../request-source';
import { extractDocumentVariables } from '../../variables';
import { mapPostmanRequest, collectScriptDiagnostics } from './map-request';

test('maps headers, query params, and JSON body', () => {
  const result = mapPostmanRequest({
    name: 'Create user',
    path: '/item/0/request',
    request: {
      method: 'POST',
      header: [
        { key: 'X-Request-Id', value: 'abc' },
        { key: 'Authorization', value: 'Bearer secret-token' },
      ],
      url: {
        raw: '{{BASE_URL}}/users?active=true&token=secret',
        query: [
          { key: 'active', value: 'true' },
          { key: 'token', value: 'secret' },
        ],
      },
      body: {
        mode: 'raw',
        raw: '{"name":"Ada","password":"nope"}',
        options: { raw: { language: 'json' } },
      },
    },
  });
  assert.equal(result.method, 'POST');
  assert.match(result.content, /POST \{\{BASE_URL\}\}\/users/);
  assert.match(result.content, /active=true/);
  assert.match(result.content, /X-Request-Id: abc/);
  assert.doesNotMatch(result.content, /Bearer secret-token/);
  assert.doesNotMatch(result.content, /"password":"nope"/);
  assert.match(result.content, /"name": "Ada"/);
});

test('maps form-urlencoded and form-data bodies', () => {
  const form = mapPostmanRequest({
    name: 'Form',
    path: '/item/0/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/form',
      body: {
        mode: 'urlencoded',
        urlencoded: [
          { key: 'a', value: '1' },
          { key: 'password', value: 'secret' },
        ],
      },
    },
  });
  assert.match(form.content, /application\/x-www-form-urlencoded/);
  assert.match(form.content, /a=1/);
  assert.doesNotMatch(form.content, /password=secret/);

  const multipart = mapPostmanRequest({
    name: 'Multi',
    path: '/item/1/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/upload',
      body: {
        mode: 'formdata',
        formdata: [
          { key: 'file', type: 'file', src: '/tmp/x.bin' },
          { key: 'note', value: 'hello' },
        ],
      },
    },
  });
  assert.match(multipart.content, /multipart\/form-data|boundary/u);
  assert.ok(
    multipart.diagnostics.some(
      (item) => item.code === 'postman-unsupported-body',
    ),
  );
});

test('preserves {{VAR}} in URL and document variables', () => {
  const result = mapPostmanRequest({
    name: 'Vars',
    path: '/item/0/request',
    documentVariables: [
      { name: 'userId', value: '{{USER_ID}}', sensitive: false },
    ],
    request: {
      method: 'GET',
      url: '{{BASE_URL}}/users/{{userId}}',
    },
  });
  assert.match(result.content, /\{\{BASE_URL\}\}\/users\/\{\{userId\}\}/);
  assert.match(result.content, /@variable userId=\{\{USER_ID\}\}/);
});

test('collectScriptDiagnostics reports prerequest and test', () => {
  const diags = collectScriptDiagnostics(
    [
      { listen: 'prerequest', script: { exec: ['1'] } },
      { listen: 'test', script: { exec: ['2'] } },
      { listen: 'prerequest', disabled: true, script: { exec: ['3'] } },
    ],
    '/event',
    'Collection',
  );
  assert.equal(diags.length, 2);
  assert.ok(diags.every((item) => item.code === 'postman-unsupported-script'));
});

test('path variables convert :id to {{id}}', () => {
  const result = mapPostmanRequest({
    name: 'By id',
    path: '/item/0/request',
    request: {
      method: 'GET',
      url: {
        host: ['{{BASE_URL}}'],
        path: ['users', ':id'],
        variable: [{ key: 'id', value: '1' }],
      },
    },
  });
  assert.match(result.content, /\{\{id\}\}/);
});

test('scrubs GraphQL and raw/text bodies before serialize', () => {
  const gql = mapPostmanRequest({
    name: 'GQL',
    path: '/item/0/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/graphql',
      body: {
        mode: 'graphql',
        graphql: {
          query: 'query { me }',
          variables: { password: 'nope', keep: 1 },
        },
      },
    },
  });
  assert.match(gql.content, /@protocol graphql/u);
  assert.doesNotMatch(gql.content, /"password":\s*"nope"/);
  assert.match(gql.content, /"keep"/);
  assert.equal(
    gql.diagnostics.some((item) => item.code === 'postman-unsupported-graphql'),
    false,
  );
  assert.doesNotMatch(
    gql.diagnostics.map((item) => item.message).join('\n'),
    /imported as raw JSON stub/u,
  );

  const raw = mapPostmanRequest({
    name: 'Raw',
    path: '/item/1/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/echo',
      body: {
        mode: 'raw',
        raw: 'Authorization: Bearer tok_live_abc123',
        options: { raw: { language: 'text' } },
      },
    },
  });
  assert.doesNotMatch(raw.content, /tok_live_abc123/);
});

test('maps GraphQL query, mutation, variables, operationName, headers, and auth', () => {
  const query = mapPostmanRequest({
    name: 'GetUsers',
    path: '/item/0/request',
    authProfileId: 'bearer-prod',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/graphql',
      header: [{ key: 'X-Request-Id', value: 'abc' }],
      body: {
        mode: 'graphql',
        graphql: {
          query: 'query GetUsers { users { id name } }',
          variables: { limit: 10 },
          operationName: 'GetUsers',
        },
      },
    },
  });
  assert.equal(query.method, 'POST');
  assert.match(query.content, /@protocol graphql/u);
  assert.match(query.content, /@auth bearer-prod/u);
  assert.match(query.content, /X-Request-Id: abc/u);
  assert.match(query.content, /"operationName": "GetUsers"/u);
  assert.match(query.content, /"limit": 10/u);
  assert.equal(query.diagnostics.length, 0);

  const mutation = mapPostmanRequest({
    name: 'UpdateUser',
    path: '/item/1/request',
    request: {
      method: 'GET',
      url: '{{BASE_URL}}/graphql',
      body: {
        mode: 'graphql',
        graphql: {
          query:
            'mutation UpdateUser($id: ID!) { updateUser(id: $id) { id } }',
          variables: '{ "id": "{{userId}}" }',
        },
      },
    },
  });
  assert.equal(mutation.method, 'POST');
  assert.match(mutation.content, /@protocol graphql/u);
  assert.match(mutation.content, /mutation UpdateUser/u);
  assert.match(mutation.content, /\{\{userId\}\}/u);
  assert.match(mutation.content, /\{\{BASE_URL\}\}\/graphql/u);
});

test('GraphQL missing query stays unsupported; invalid variables are omitted', () => {
  const missing = mapPostmanRequest({
    name: 'Missing',
    path: '/item/0/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/graphql',
      body: { mode: 'graphql', graphql: { variables: { id: 1 } } },
    },
  });
  assert.doesNotMatch(missing.content, /@protocol graphql/u);
  assert.ok(
    missing.diagnostics.some(
      (item) => item.code === 'postman-unsupported-graphql',
    ),
  );
  assert.doesNotMatch(
    missing.diagnostics.map((item) => item.message).join('\n'),
    /imported as raw JSON stub/u,
  );

  const badVars = mapPostmanRequest({
    name: 'BadVars',
    path: '/item/2/request',
    request: {
      method: 'POST',
      url: '{{BASE_URL}}/graphql',
      body: {
        mode: 'graphql',
        graphql: {
          query: 'query Q { ping }',
          variables: '{ not json',
          operationName: 'Q',
        },
      },
    },
  });
  assert.match(badVars.content, /@protocol graphql/u);
  assert.match(badVars.content, /"operationName": "Q"/u);
  assert.ok(
    badVars.diagnostics.some(
      (item) => item.code === 'postman-unsupported-graphql-variables',
    ),
  );
});

test('imported GraphQL request matches editor envelope and runs via orchestrator', async () => {
  const mapped = mapPostmanRequest({
    name: 'GetUser',
    path: '/item/0/request',
    documentVariables: [{ name: 'userId', value: 'ada', sensitive: false }],
    request: {
      method: 'POST',
      url: 'https://example.test/graphql',
      body: {
        mode: 'graphql',
        graphql: {
          query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
          variables: { id: '{{userId}}' },
          operationName: 'GetUser',
        },
      },
    },
  });
  const parsed = parseSourceToRequestDocument(mapped.content);
  assert.equal(parsed.kind, 'single');
  if (parsed.kind !== 'single') {
    return;
  }
  assert.equal(parsed.document.protocol, 'graphql');
  const envelope = parseGraphqlEditorEnvelope(parsed.document.body);
  assert.equal(
    envelope.query,
    'query GetUser($id: ID!) { user(id: $id) { name } }',
  );
  assert.equal(envelope.operationName, 'GetUser');
  assert.deepEqual(JSON.parse(envelope.variablesText), { id: '{{userId}}' });

  const graphqlOk: HttpTransportResponse = {
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
    public execute(
      request: HttpTransportRequest,
    ): Promise<HttpTransportResponse> {
      this.requests.push(request);
      return Promise.resolve(graphqlOk);
    }
  }
  class FakeStatus implements ExecutionStatusPresenter {
    public update(status: ExecutionStatus): void {
      void status;
    }
    public dispose(): void {
      /* no-op */
    }
  }
  class FakeViewer implements ExecutionResultViewer {
    public show(): void {
      /* no-op */
    }
  }
  class FakeNotifications implements ExecutionNotificationSink {
    public error(): void {
      /* no-op */
    }
  }
  class FakeProgress implements ExecutionProgressRunner {
    public run<T>(
      task: (
        signal: AbortSignal,
        reporter: { report(message: string): void },
      ) => Promise<T>,
    ): Promise<T> {
      return task(new AbortController().signal, { report: () => undefined });
    }
  }
  const transport = new FakeTransport();
  const orchestrator = new ExecutionOrchestrator(
    new DefaultRequestExecutor(transport),
    new FakeViewer(),
    new FakeStatus(),
    new FakeProgress(),
    new FakeNotifications(),
    () => ({}),
    undefined,
    undefined,
    (document) => ({
      definitions: extractDocumentVariables(document).definitions,
    }),
  );
  const result = await orchestrator.runAtSourceLocation({
    text: mapped.content,
    sourceId: 'imported-gql.api',
    offset: 0,
  });
  assert.equal(result.outcome, 'success');
  const payload = JSON.parse(
    new TextDecoder().decode(transport.requests[0]!.body!),
  ) as { query: string; operationName: string; variables: { id: string } };
  assert.match(payload.query, /query GetUser/u);
  assert.equal(payload.operationName, 'GetUser');
  assert.equal(payload.variables.id, 'ada');
});

test('masks request description and caps document variables', () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    name: `v${index}`,
    value: `val${index}`,
    sensitive: false,
  }));
  const result = mapPostmanRequest({
    name: 'Desc',
    path: '/item/0/request',
    description: 'Uses Bearer secret-token-value here',
    documentVariables: many,
    request: {
      method: 'GET',
      url: '{{BASE_URL}}/x',
    },
  });
  assert.doesNotMatch(result.content, /secret-token-value/);
  const varLines = result.content
    .split('\n')
    .filter((line) => line.startsWith('@variable '));
  assert.equal(varLines.length, 80);
});
