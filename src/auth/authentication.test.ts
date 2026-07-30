import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  AuthenticationProfile,
  ResolvedRequest,
  RuntimeRequest,
  VariableValue,
} from '../models';
import { DefaultVariableResolver } from '../variables';
import {
  ApiKeyAuthenticationProvider,
  AuthenticationError,
  AuthenticationProviderRegistry,
  applySessionTokensFromJson,
  AuthenticationSessionStore,
  BasicAuthenticationProvider,
  BearerAuthenticationProvider,
  DefaultAuthenticationResolver,
  DefaultAuthenticationSecretRepository,
  FORBIDDEN_IDS,
  NoneAuthenticationProvider,
  authenticationSecretKey,
  AuthenticationProfileManager,
  AUTHENTICATION_PRESENTATION_MASK,
  buildAuthenticationPresentationPreview,
  deriveAuthenticationHealth,
  detectAuthTokensInJson,
  formatAuthTestSummary,
  isValidAuthenticationProfileId,
  readJsonPathValue,
  saveAsAuthenticationProfile,
  secretFieldNamesForProvider,
  secretFieldsForProvider,
  selectAuthenticationReference,
  SESSION_SECRET_FIELDS,
  validateAuthenticationProfiles,
  validateAuthenticationProfilesForCommit,
} from '.';

class MemorySecrets {
  public readonly values = new Map<string, string>();
  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }
  public async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const registry = () => new AuthenticationProviderRegistry([
  new NoneAuthenticationProvider(),
  new BasicAuthenticationProvider(),
  new BearerAuthenticationProvider(),
  new ApiKeyAuthenticationProvider(),
]);

function resolved(
  overrides: Partial<RuntimeRequest> = {},
): ResolvedRequest {
  const request: RuntimeRequest = {
    id: 'auth-test',
    method: 'GET',
    url: 'https://example.test/items?x=1&x=2#section',
    headers: [],
    queryParameters: [
      { name: 'x', value: '1' },
      { name: 'x', value: '2' },
    ],
    pathParameters: [],
    cookies: [],
    bodyType: 'none',
    authentication: { kind: 'none', extensions: {} },
    variables: [],
    environment: { kind: 'none', extensions: {} },
    metadata: { declarationIndex: 0, tags: [], extensions: {} },
    configuration: { directives: [], extensions: {} },
    redirectPolicy: { mode: 'follow' },
    ssl: { verifyCertificates: true, extensions: {} },
    executionExtensions: {},
    ...overrides,
  };
  const result = new DefaultVariableResolver().resolveRequest(request, {
    definitions: [],
  });
  assert.equal(result.success, true);
  return result.request;
}

async function authenticate(
  profile: AuthenticationProfile | undefined,
  request = resolved(profile === undefined ? {} : {
    authentication: {
      kind: 'unresolved',
      reference: profile.id,
      extensions: {},
    },
  }),
  variables = new Map<string, VariableValue>(),
) {
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  return {
    store,
    secrets,
    result: async () => new DefaultAuthenticationResolver(registry()).resolve(
      request,
      {
        profiles: profile === undefined ? [] : [profile],
        variables,
        secrets,
      },
    ),
  };
}

test('none authentication produces a detached authenticated stage', async () => {
  const input = resolved();
  const h = await authenticate(undefined, input);
  const output = await h.result();
  assert.equal(output.authenticationStage, 'authenticated');
  assert.equal(output.authentication.scheme, 'none');
  assert.notEqual(output, input);
  assert.notEqual(output.metadata, input.metadata);
  assert.notEqual(output.configuration, input.configuration);
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output.headers));
});

test('basic rejects user IDs containing a colon without exposing input', async () => {
  const profile = {
    id: 'invalid-basic',
    providerId: 'basic',
    username: { kind: 'literal', value: 'user:name', unsafe: true },
    password: { kind: 'literal', value: 'password', unsafe: true },
  } as const;
  await assert.rejects(
    (await authenticate(profile)).result(),
    (error: unknown) => {
      assert.ok(error instanceof AuthenticationError);
      assert.equal(error.field, 'username');
      assert.equal(error.message.includes('user:name'), false);
      return true;
    },
  );
});

test('basic uses UTF-8 base64 and secret repository fields', async () => {
  const profile = {
    id: 'unicode',
    providerId: 'basic',
    username: { kind: 'secret' },
    password: { kind: 'secret' },
  } as const;
  const h = await authenticate(profile);
  await h.secrets.store(profile.id, 'username', 'føø');
  await h.secrets.store(profile.id, 'password', 'päss');
  const output = await h.result();
  assert.deepEqual(output.headers.at(-1), {
    name: 'Authorization',
    value: `Basic ${Buffer.from('føø:päss', 'utf8').toString('base64')}`,
  });
  assert.deepEqual(output.resolution.sensitiveHeaderNames, ['authorization']);
  assert.equal(JSON.stringify(output.authentication).includes('päss'), false);
});

test('bearer consumes variable-derived values only after variable resolution', async () => {
  const profile = {
    id: 'variable-token',
    providerId: 'bearer',
    token: { kind: 'variable', name: 'token' },
  } as const;
  const variables = new Map<string, VariableValue>([['token', {
    name: 'token',
    value: 'resolved-token',
    scope: 'environment',
    sensitive: true,
  }]]);
  const h = await authenticate(profile, undefined, variables);
  const output = await h.result();
  assert.equal(output.headers.at(-1)?.value, 'Bearer resolved-token');
  assert.equal(h.store.values.size, 0);
});

test('API key header validates names and rejects existing conflicts', async () => {
  const profile = {
    id: 'header-key',
    providerId: 'apiKey',
    location: 'header',
    name: 'X-API-Key',
    value: { kind: 'literal', value: 'key', unsafe: true },
  } as const;
  const output = await (await authenticate(profile)).result();
  assert.deepEqual(output.headers.at(-1), { name: 'X-API-Key', value: 'key' });
  await assert.rejects(
    (await authenticate(
      { ...profile, name: 'Bad\r\nHeader' },
    )).result(),
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === 'INVALID_PROFILE',
  );
  await assert.rejects(
    (await authenticate(
      profile,
      resolved({
        authentication: {
          kind: 'unresolved',
          reference: profile.id,
          extensions: {},
        },
        headers: [{ name: 'x-api-key', value: 'existing' }],
      }),
    )).result(),
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === 'CONFLICT',
  );
});

test('API key query preserves duplicates, encoding, and fragments while masking', async () => {
  const profile = {
    id: 'query-key',
    providerId: 'apiKey',
    location: 'query',
    name: 'api key',
    value: { kind: 'literal', value: 'a+b/c=', unsafe: true },
  } as const;
  const output = await (await authenticate(profile)).result();
  assert.equal(
    output.url,
    'https://example.test/items?x=1&x=2&api%20key=a%2Bb%2Fc%3D#section',
  );
  assert.equal(output.resolution.presentationUrl.includes('a%2Bb'), false);
  assert.match(output.resolution.presentationUrl, /api%20key=/u);
  assert.deepEqual(output.queryParameters.slice(0, 2), [
    { name: 'x', value: '1' },
    { name: 'x', value: '2' },
  ]);
});

test('credentials reject placeholders, empty bearer values, and CRLF safely', async () => {
  for (const value of ['', '{{token}}', 'token\r\nInjected: yes']) {
    const profile = {
      id: 'unsafe-token',
      providerId: 'bearer',
      token: { kind: 'literal', value, unsafe: true },
    } as const;
    await assert.rejects(
      (await authenticate(profile)).result(),
      (error: unknown) => {
        assert.ok(error instanceof AuthenticationError);
        if (value.length > 0) {
          assert.equal(error.message.includes(value), false);
        }
        return true;
      },
    );
  }
});

test('registry rejects duplicates and resolver rejects unknown providers', async () => {
  assert.throws(
    () => new AuthenticationProviderRegistry([
      new NoneAuthenticationProvider(),
      new NoneAuthenticationProvider(),
    ]),
    (error: unknown) =>
      error instanceof AuthenticationError &&
      error.code === 'DUPLICATE_PROVIDER',
  );
  const profile = { id: 'future', providerId: 'oauth2' } as const;
  await assert.rejects(
    (await authenticate(profile)).result(),
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === 'UNKNOWN_PROVIDER',
  );
});

test('secret repository has stable get/store/delete lifecycle without enumeration', async () => {
  const store = new MemorySecrets();
  const repository = new DefaultAuthenticationSecretRepository(store);
  await repository.store('team/profile', 'token', 'private');
  const key = authenticationSecretKey('team/profile', 'token');
  assert.equal(key, 'apiHero.auth.profile.team%2Fprofile.token');
  assert.equal(await repository.get('team/profile', 'token'), 'private');
  await repository.delete('team/profile', 'token');
  assert.equal(await repository.get('team/profile', 'token'), undefined);
  assert.equal('list' in repository, false);
});

test('secret repository lazily migrates legacy apiRunner keys to apiHero', async () => {
  const store = new MemorySecrets();
  const repository = new DefaultAuthenticationSecretRepository(store);
  const legacyKey = 'apiRunner.auth.profile.demo.token';
  const canonicalKey = authenticationSecretKey('demo', 'token');
  await store.set(legacyKey, 'legacy-secret');

  assert.equal(await repository.get('demo', 'token'), 'legacy-secret');
  assert.equal(await store.get(canonicalKey), 'legacy-secret');
  assert.equal(await store.get(legacyKey), undefined);
});

test('validation isolates malformed, duplicate, and prototype-sensitive ids', () => {
  const validation = validateAuthenticationProfiles([
    { id: 'valid', providerId: 'bearer', token: { kind: 'secret' } },
    { id: 'dup', providerId: 'bearer', token: { kind: 'literal', value: 'leak-1', unsafe: true } },
    { id: 'dup', providerId: 'bearer', token: { kind: 'literal', value: 'leak-2', unsafe: true } },
    { id: '', providerId: 'none' },
    { id: '__proto__', providerId: 'none' },
    { id: 'constructor', providerId: 'none' },
    { id: 'prototype', providerId: 'none' },
    { id: 'no-provider' } as never,
  ]);
  assert.deepEqual(
    validation.profiles.map((profile) => profile.id),
    ['valid'],
  );
  const codes = validation.issues.map((issue) => issue.code).sort();
  assert.deepEqual(codes, [
    'duplicate-id',
    'invalid-provider',
    'malformed-id',
    'malformed-id',
    'malformed-id',
    'malformed-id',
  ]);
  assert.equal(validation.issues.some((issue) => issue.profileId === 'dup'), true);
  assert.equal(JSON.stringify(validation.issues).includes('leak-'), false);
  assert.ok(Object.isFrozen(validation.profiles));
});

test('manager capture/list never throw on invalid or duplicate entries', () => {
  const manager = new AuthenticationProfileManager({
    getProfiles: () => [
      { id: 'ok', providerId: 'none' },
      { id: 'dup', providerId: 'none' },
      { id: 'dup', providerId: 'none' },
      { id: '__proto__', providerId: 'none' },
    ],
    onDidChange: () => ({ dispose: () => undefined }),
  });
  const snapshot = manager.capture();
  assert.deepEqual(manager.list().map((profile) => profile.id), ['ok']);
  assert.equal(snapshot.issues.length, 2);
  assert.throws(() => manager.selectDefault('dup'));
  assert.throws(() => manager.selectDefault('__proto__'));
  manager.selectDefault('ok');
  assert.equal(manager.defaultProfileId, 'ok');
});

test('resolver rejects duplicate/invalid profiles while none still resolves', async () => {
  const validation = validateAuthenticationProfiles([
    { id: 'dup', providerId: 'none' },
    { id: 'dup', providerId: 'none' },
    { id: 'valid', providerId: 'bearer', token: { kind: 'literal', value: 'tok', unsafe: true } },
  ]);
  const resolver = new DefaultAuthenticationResolver(registry());
  const secrets = new DefaultAuthenticationSecretRepository(new MemorySecrets());
  const context = {
    profiles: validation.profiles,
    issues: validation.issues,
    variables: new Map<string, VariableValue>(),
    secrets,
  };
  const duplicateRequest = resolved({
    authentication: { kind: 'unresolved', reference: 'dup', extensions: {} },
  });
  await assert.rejects(
    resolver.resolve(duplicateRequest, context),
    (error: unknown) =>
      error instanceof AuthenticationError &&
      error.code === 'INVALID_PROFILE' &&
      error.profileId === 'dup' &&
      error.message.includes('tok') === false,
  );
  const missingRequest = resolved({
    authentication: { kind: 'unresolved', reference: 'ghost', extensions: {} },
  });
  await assert.rejects(
    resolver.resolve(missingRequest, context),
    (error: unknown) =>
      error instanceof AuthenticationError && error.code === 'MISSING_PROFILE',
  );
  const noneOutput = await resolver.resolve(resolved(), context);
  assert.equal(noneOutput.authenticationStage, 'authenticated');
  assert.equal(noneOutput.authentication.scheme, 'none');
  const validOutput = await resolver.resolve(
    resolved({
      authentication: { kind: 'unresolved', reference: 'valid', extensions: {} },
    }),
    context,
  );
  assert.equal(validOutput.headers.at(-1)?.value, 'Bearer tok');
});

test('profile manager selection is session-only and refreshes listeners', () => {
  let repositoryListener: (() => void) | undefined;
  const repository = {
    getProfiles: () => [{ id: 'one', providerId: 'none' }] as const,
    onDidChange(listener: () => void) {
      repositoryListener = listener;
      return { dispose: () => { repositoryListener = undefined; } };
    },
  };
  const manager = new AuthenticationProfileManager(repository);
  let changes = 0;
  const registration = manager.onDidChange(() => { changes += 1; });
  manager.selectDefault('one');
  assert.equal(manager.capture().defaultProfileId, 'one');
  repositoryListener?.();
  assert.equal(changes, 2);
  registration.dispose();
  assert.equal(repositoryListener, undefined);
});

test('shared id primitives reject forbidden and pattern-invalid ids', () => {
  assert.equal(isValidAuthenticationProfileId('bearer-prod'), true);
  assert.equal(isValidAuthenticationProfileId(''), false);
  assert.equal(isValidAuthenticationProfileId('1bad'), false);
  assert.equal(isValidAuthenticationProfileId('team/profile'), false);
  for (const id of FORBIDDEN_IDS) {
    assert.equal(isValidAuthenticationProfileId(id), false);
  }
});

test('secret field helpers are the single source for built-in providers', () => {
  assert.deepEqual(secretFieldNamesForProvider('none'), []);
  assert.deepEqual(secretFieldNamesForProvider('bearer'), ['token']);
  assert.deepEqual(secretFieldNamesForProvider('basic'), [
    'username',
    'password',
  ]);
  assert.deepEqual(secretFieldNamesForProvider('apiKey'), ['value']);
  assert.deepEqual(secretFieldNamesForProvider('oauth2'), []);
  assert.equal(secretFieldsForProvider('bearer')[0]?.label, 'Token');
  assert.equal(secretFieldsForProvider('apiKey')[0]?.field, 'value');
});

test('buildAuthenticationPresentationPreview covers all Auth Manager providers', () => {
  const mask = AUTHENTICATION_PRESENTATION_MASK;
  assert.deepEqual(
    buildAuthenticationPresentationPreview({ providerId: 'none' }),
    {
      preview: 'No authentication headers will be added.',
      validation: '',
      headerNames: [],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'bearer',
      secretFields: [{ field: 'token', label: 'Token', status: 'missing' }],
    }),
    {
      preview: `Authorization: Bearer ${mask}`,
      validation: 'Token secret is missing.',
      headerNames: ['Authorization'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'bearer',
      secretFields: [{ field: 'token', label: 'Token', status: 'set' }],
    }),
    {
      preview: `Authorization: Bearer ${mask}`,
      validation: 'Ready — token is set.',
      headerNames: ['Authorization'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'basic',
      secretFields: [
        { field: 'username', label: 'Username', status: 'missing' },
        { field: 'password', label: 'Password', status: 'missing' },
      ],
    }),
    {
      preview: `Authorization: Basic ${mask}`,
      validation: 'Missing: Username, Password.',
      headerNames: ['Authorization'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'basic',
      secretFields: [
        { field: 'username', label: 'Username', status: 'set' },
        { field: 'password', label: 'Password', status: 'set' },
      ],
    }),
    {
      preview: `Authorization: Basic ${mask}`,
      validation: 'Ready — username and password are set.',
      headerNames: ['Authorization'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'apiKey',
      apiKeyName: 'X-API-Key',
      apiKeyLocation: 'header',
      secretFields: [{ field: 'value', label: 'API key value', status: 'missing' }],
    }),
    {
      preview: `X-API-Key: ${mask}`,
      validation: 'API key secret is missing.',
      headerNames: ['X-API-Key'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'apiKey',
      apiKeyName: '',
      apiKeyLocation: 'header',
      secretFields: [{ field: 'value', label: 'API key value', status: 'set' }],
    }),
    {
      preview: `X-API-Key: ${mask}`,
      validation:
        'Key name is empty — set a header or query parameter name.',
      headerNames: ['X-API-Key'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'apiKey',
      apiKeyName: 'X-API-Key',
      apiKeyLocation: 'header',
      secretFields: [{ field: 'value', label: 'API key value', status: 'set' }],
    }),
    {
      preview: `X-API-Key: ${mask}`,
      validation: 'Ready — API key secret is set.',
      headerNames: ['X-API-Key'],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({
      providerId: 'apiKey',
      apiKeyName: 'api_key',
      apiKeyLocation: 'query',
      secretFields: [{ field: 'value', label: 'API key value', status: 'set' }],
    }),
    {
      preview: `Query: api_key=${mask}`,
      validation: 'Ready — API key secret is set.',
      headerNames: [],
    },
  );
  assert.deepEqual(
    buildAuthenticationPresentationPreview({ providerId: 'oauth2' }),
    {
      preview: 'Unknown provider.',
      validation: 'Unsupported provider.',
      headerNames: [],
    },
  );
});

test('load-time validation stays lenient for pattern and apiKey shape', () => {
  const validation = validateAuthenticationProfiles([
    {
      id: '1legacy',
      providerId: 'bearer',
      token: { kind: 'secret' },
    },
    {
      id: 'key',
      providerId: 'apiKey',
    } as never,
  ]);
  assert.deepEqual(
    validation.profiles.map((profile) => profile.id),
    ['1legacy', 'key'],
  );
  assert.equal(validation.issues.length, 0);
});

test('commit validation enforces UI rules with stable user-facing messages', () => {
  assert.deepEqual(
    validateAuthenticationProfilesForCommit({
      profiles: [{
        id: 'prod',
        label: 'Production',
        providerId: 'bearer',
      }],
      defaultProfileId: 'prod',
    }).issues,
    [],
  );

  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{ id: '  ', label: 'X', providerId: 'none' }],
    }).issues[0]?.message,
    'Profile id is required.',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{ id: '1bad', label: 'X', providerId: 'bearer' }],
    }).issues[0]?.message,
    'Invalid profile id "1bad".',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [
        { id: 'dup', label: 'A', providerId: 'none' },
        { id: 'dup', label: 'B', providerId: 'none' },
      ],
    }).issues[0]?.message,
    'Duplicate profile id "dup".',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{ id: 'ok', label: '  ', providerId: 'none' }],
    }).issues[0]?.message,
    'Profile label is required.',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{ id: 'ok', label: 'X', providerId: 'oauth2' }],
    }).issues[0]?.message,
    'Unsupported provider "oauth2".',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{ id: 'key', label: 'Key', providerId: 'apiKey' }],
    }).issues[0]?.message,
    'API key profile "key" requires a header or query name.',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{
        id: 'key',
        label: 'Key',
        providerId: 'apiKey',
        apiKeyName: 'X-API-Key',
      }],
    }).issues[0]?.message,
    'API key profile "key" requires location header or query.',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{ id: 'ok', label: 'X', providerId: 'none' }],
      defaultProfileId: 'missing',
    }).issues[0]?.message,
    'Unknown default profile "missing".',
  );
  assert.equal(
    validateAuthenticationProfilesForCommit({
      profiles: [{
        id: 'key',
        label: 'Key',
        providerId: 'apiKey',
        apiKeyName: 'X-API-Key',
        apiKeyLocation: 'header',
      }],
      defaultProfileId: 'key',
    }).issues.length,
    0,
  );
});

test('deriveAuthenticationHealth covers never tested, healthy ago, expired, expires in', () => {
  const now = Date.parse('2026-07-30T12:00:00.000Z');
  assert.equal(
    deriveAuthenticationHealth({ session: undefined, now }).label,
    'Never tested',
  );
  assert.equal(
    deriveAuthenticationHealth({
      session: {
        authenticationId: 'p',
        status: 'ready',
        lastTestedAt: '2026-07-30T11:50:00.000Z',
      },
      now,
    }).label,
    'Healthy (10m ago)',
  );
  assert.equal(
    deriveAuthenticationHealth({
      session: {
        authenticationId: 'p',
        status: 'ready',
        expiresAt: '2026-07-30T11:00:00.000Z',
      },
      now,
    }).status,
    'expired',
  );
  assert.match(
    deriveAuthenticationHealth({
      session: {
        authenticationId: 'p',
        status: 'ready',
        accessTokenPresent: true,
        expiresAt: '2026-07-30T12:30:00.000Z',
        lastAuthenticatedAt: '2026-07-30T11:55:00.000Z',
      },
      now,
    }).label,
    /Expires in 30m/u,
  );
  assert.equal(
    deriveAuthenticationHealth({
      session: {
        authenticationId: 'p',
        status: 'ready',
        accessTokenPresent: true,
        lastAuthenticatedAt: '2026-07-30T11:55:00.000Z',
      },
      profileSecretPresent: false,
      now,
    }).status,
    'ready',
  );
  assert.match(
    deriveAuthenticationHealth({
      session: {
        authenticationId: 'p',
        status: 'ready',
        accessTokenPresent: true,
        lastAuthenticatedAt: '2026-07-30T11:55:00.000Z',
      },
      profileSecretPresent: false,
      now,
    }).label,
    /Healthy/u,
  );
  assert.equal(
    deriveAuthenticationHealth({
      session: {
        authenticationId: 'p',
        status: 'unhealthy',
        lastTestSummary: 'HTTP 500',
      },
      now,
    }).label,
    'Needs Login',
  );
});

test('explainAuthenticationResolution mirrors request → collection → workspace precedence', async () => {
  const { explainAuthenticationResolution } = await import(
    './explain-authentication-resolution.js'
  );
  assert.deepEqual(
    explainAuthenticationResolution({
      requestOverrideId: 'req',
      collectionDefaultId: 'col',
      workspaceDefaultId: 'ws',
    }),
    {
      steps: [
        {
          source: 'request',
          label: 'Request Override',
          authenticationId: 'req',
          selected: true,
        },
        {
          source: 'collection',
          label: 'Collection Default',
          authenticationId: 'col',
          selected: false,
        },
        {
          source: 'workspace',
          label: 'Workspace/Session Default',
          authenticationId: 'ws',
          selected: false,
        },
      ],
      selectedId: 'req',
      source: 'request',
    },
  );
  assert.equal(
    explainAuthenticationResolution({
      collectionDefaultId: 'col',
      workspaceDefaultId: 'ws',
    }).selectedId,
    'col',
  );
  assert.equal(
    explainAuthenticationResolution({ workspaceDefaultId: 'ws' }).source,
    'workspace',
  );
  assert.equal(explainAuthenticationResolution({}).source, 'none');
});

test('detectAuthIdentityFromJson returns email/username without tokens', async () => {
  const { detectAuthIdentityFromJson } = await import(
    './detect-auth-identity.js'
  );
  assert.equal(
    detectAuthIdentityFromJson({ email: 'a@example.com', access_token: 'x' }),
    'a@example.com',
  );
  assert.equal(
    detectAuthIdentityFromJson({ preferred_username: 'alice' }),
    'alice',
  );
  assert.equal(
    detectAuthIdentityFromJson({
      sub: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
    }),
    undefined,
  );
});

test('formatAuthTestSummary accepts richer presentation options', () => {
  assert.equal(formatAuthTestSummary(200), 'HTTP 200');
  assert.match(
    formatAuthTestSummary({
      statusCode: 200,
      url: 'https://api.example.com/me',
      latencyMs: 42,
      identity: 'a@example.com',
      rateLimitRemaining: '99',
      rateLimitLimit: '100',
    }),
    /HTTP 200 · https:\/\/api\.example\.com\/me · 42ms · user a@example\.com · rate 99\/100/u,
  );
});

test('one-shot ephemeral resolution decorates bearer without a profile', async () => {
  const output = await new DefaultAuthenticationResolver(registry()).resolve(
    resolved(),
    {
      profiles: [],
      variables: new Map(),
      secrets: new DefaultAuthenticationSecretRepository(new MemorySecrets()),
      ephemeral: {
        providerId: 'bearer',
        material: { token: 'ephemeral-token' },
      },
    },
  );
  assert.equal(output.authentication.scheme, 'bearer');
  assert.equal(
    output.headers.find((header) => header.name === 'Authorization')?.value,
    'Bearer ephemeral-token',
  );
  assert.equal(output.authentication.extensions.profileId, 'oneshot');
});

test('collection default precedes session default in selectAuthenticationReference', () => {
  const request = resolved({
    authentication: { kind: 'none', extensions: {} },
  });
  assert.equal(
    selectAuthenticationReference(request, {
      collectionDefaultAuthenticationId: 'collection-auth',
      defaultProfileId: 'session-auth',
    }),
    'collection-auth',
  );
  assert.equal(
    selectAuthenticationReference(
      resolved({
        authentication: {
          kind: 'unresolved',
          reference: 'request-auth',
          extensions: {},
        },
      }),
      {
        collectionDefaultAuthenticationId: 'collection-auth',
        defaultProfileId: 'session-auth',
      },
    ),
    'request-auth',
  );
});

test('detectAuthTokensInJson ranks access_token and nested data.accessToken', () => {
  const candidates = detectAuthTokensInJson({
    data: { accessToken: 'abc', refresh_token: 'r' },
    expires_in: 3600,
  });
  assert.ok(candidates.some((c) => c.path === 'data.accessToken'));
  assert.ok(candidates.some((c) => c.kind === 'refresh_token'));
  assert.ok(candidates.some((c) => c.kind === 'expires_in'));
  assert.equal(candidates[0]?.path.includes('accessToken') || candidates[0]?.kind === 'access_token' || candidates[0]?.kind === 'generic_token', true);
});

test('session access token is preferred when decorating bearer', async () => {
  const profile = {
    id: 'svc',
    providerId: 'bearer',
    token: { kind: 'secret' },
  } as const;
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  await secrets.store(profile.id, 'token', 'static-token');
  await secrets.store(profile.id, SESSION_SECRET_FIELDS.accessToken, 'session-token');
  const sessions = new AuthenticationSessionStore();
  sessions.patch(profile.id, {
    status: 'ready',
    accessTokenPresent: true,
  });
  const output = await new DefaultAuthenticationResolver(registry()).resolve(
    resolved({
      authentication: {
        kind: 'unresolved',
        reference: profile.id,
        extensions: {},
      },
    }),
    {
      profiles: [profile],
      variables: new Map(),
      secrets,
      sessions,
    },
  );
  assert.equal(
    output.headers.find((header) => header.name === 'Authorization')?.value,
    'Bearer session-token',
  );
});

test('leftover session secret is ignored when accessTokenPresent is false', async () => {
  const profile = {
    id: 'svc',
    providerId: 'bearer',
    token: { kind: 'secret' },
  } as const;
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  await secrets.store(profile.id, 'token', 'static-token');
  await secrets.store(profile.id, SESSION_SECRET_FIELDS.accessToken, 'stale-session');
  const sessions = new AuthenticationSessionStore();
  sessions.patch(profile.id, {
    status: 'unknown',
    accessTokenPresent: false,
  });
  const output = await new DefaultAuthenticationResolver(registry()).resolve(
    resolved({
      authentication: {
        kind: 'unresolved',
        reference: profile.id,
        extensions: {},
      },
    }),
    {
      profiles: [profile],
      variables: new Map(),
      secrets,
      sessions,
    },
  );
  assert.equal(
    output.headers.find((header) => header.name === 'Authorization')?.value,
    'Bearer static-token',
  );
});

test('applySessionTokensFromJson clears stale expiresAt and failed secrets', async () => {
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  const sessions = new AuthenticationSessionStore();
  sessions.patch('svc', {
    status: 'ready',
    accessTokenPresent: true,
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  await secrets.store('svc', SESSION_SECRET_FIELDS.accessToken, 'old');

  const applied = await applySessionTokensFromJson({
    authenticationId: 'svc',
    body: { access_token: 'new-token' },
    secrets,
    sessions,
    now: new Date('2026-07-30T12:00:00.000Z'),
  });
  assert.equal(applied.session.accessTokenPresent, true);
  assert.equal(applied.session.expiresAt, undefined);
  assert.equal(await secrets.get('svc', SESSION_SECRET_FIELDS.accessToken), 'new-token');

  const failed = await applySessionTokensFromJson({
    authenticationId: 'svc',
    body: { unrelated: true },
    secrets,
    sessions,
  });
  assert.equal(failed.session.accessTokenPresent, false);
  assert.equal(failed.session.expiresAt, undefined);
  assert.equal(await secrets.get('svc', SESSION_SECRET_FIELDS.accessToken), undefined);
});

test('saveAsAuthenticationProfile stores secret-backed bearer profile', async () => {
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  const result = await saveAsAuthenticationProfile({
    id: 'saved',
    label: 'Saved',
    ephemeral: {
      providerId: 'bearer',
      material: { token: 'paste-me' },
    },
    existingProfiles: [],
    secrets,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.profile.providerId, 'bearer');
    assert.equal(await secrets.get('saved', 'token'), 'paste-me');
  }
});

test('Use as Authentication path stores profile token secret not session access token', async () => {
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  const body = { access_token: 'from-response' };
  const accessPath = 'access_token';
  const tokenValue = readJsonPathValue(body, accessPath);
  assert.equal(tokenValue, 'from-response');
  const secretField = secretFieldNamesForProvider('bearer')[0] ?? 'token';
  await secrets.store('svc', secretField, String(tokenValue));
  assert.equal(await secrets.get('svc', 'token'), 'from-response');
  assert.equal(
    await secrets.get('svc', SESSION_SECRET_FIELDS.accessToken),
    undefined,
  );
});

test('saveAsAuthenticationProfile rejects empty basic credentials', async () => {
  const store = new MemorySecrets();
  const secrets = new DefaultAuthenticationSecretRepository(store);
  const emptyUser = await saveAsAuthenticationProfile({
    id: 'basic1',
    label: 'Basic',
    ephemeral: {
      providerId: 'basic',
      material: { username: '', password: 'x' },
    },
    existingProfiles: [],
    secrets,
  });
  assert.equal(emptyUser.ok, false);
  const emptyPass = await saveAsAuthenticationProfile({
    id: 'basic2',
    label: 'Basic',
    ephemeral: {
      providerId: 'basic',
      material: { username: 'u', password: '' },
    },
    existingProfiles: [],
    secrets,
  });
  assert.equal(emptyPass.ok, false);
});

test('presentation preview still masks bearer and oneshot-ready copy', () => {
  assert.equal(
    buildAuthenticationPresentationPreview({
      providerId: 'bearer',
      secretFields: [{ field: 'token', label: 'Token', status: 'set' }],
    }).preview,
    `Authorization: Bearer ${AUTHENTICATION_PRESENTATION_MASK}`,
  );
});
