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
  BasicAuthenticationProvider,
  BearerAuthenticationProvider,
  DefaultAuthenticationResolver,
  DefaultAuthenticationSecretRepository,
  NoneAuthenticationProvider,
  authenticationSecretKey,
  AuthenticationProfileManager,
  validateAuthenticationProfiles,
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
  assert.equal(key, 'apiRunner.auth.profile.team%2Fprofile.token');
  assert.equal(await repository.get('team/profile', 'token'), 'private');
  await repository.delete('team/profile', 'token');
  assert.equal(await repository.get('team/profile', 'token'), undefined);
  assert.equal('list' in repository, false);
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
