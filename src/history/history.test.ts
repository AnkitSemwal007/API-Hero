import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AuthenticatedRequest } from '../models';
import type { ExecutionResult } from '../execution';
import { freezeDetachedBytes } from '../shared';
import {
  HISTORY_SCHEMA_VERSION,
  HistoryExecutionStatus,
  InMemoryHistoryRepository,
  buildHistoryEntry,
  buildHistorySourceLocation,
  classifyTimeGroup,
  computeHistoryStatistics,
  DefaultHistoryRecorder,
  filterHistoryEntries,
  groupHistoryEntries,
  migrateHistoryDocument,
  resolveHistoryRerunArgument,
  sanitizeHistoryErrorMessage,
  sanitizeHistoryUrl,
  sortHistoryEntries,
  isForbiddenHistoryFieldName,
  type HistoryEntry,
} from './index';

const TIMING = Object.freeze({
  startedAt: '2026-07-20T10:00:00.000Z',
  completedAt: '2026-07-20T10:00:00.120Z',
  durationMs: 120,
});

function authenticatedRequest(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  const url = overrides.url ?? 'http://example.test/users';
  const resolution = overrides.resolution ?? {
    kind: 'resolved' as const,
    presentationUrl: url,
    sensitiveVariableNames: [],
    sensitiveHeaderNames: [],
    sensitiveQueryParameterNames: [],
  };
  return {
    id: 'test.api#request-1',
    name: 'List users',
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

function successResult(
  request: AuthenticatedRequest,
  statusCode = 200,
): ExecutionResult {
  return {
    success: true,
    requestId: request.id,
    request: { method: request.method, url: request.url },
    response: {
      requestId: request.id,
      statusCode,
      statusText: 'OK',
      headers: [],
      body: { bytes: freezeDetachedBytes(new Uint8Array([1, 2, 3])) },
      bodySizeBytes: 3,
      contentType: 'application/json',
      url: request.resolution.presentationUrl,
      redirected: false,
      redirectCount: 0,
      timing: TIMING,
    },
    timing: TIMING,
  };
}

function failureResult(
  request: AuthenticatedRequest,
  code: 'NETWORK' | 'CANCELLED' = 'NETWORK',
): ExecutionResult {
  return {
    success: false,
    requestId: request.id,
    request: { method: request.method, url: request.url },
    error: {
      code,
      message:
        code === 'CANCELLED'
          ? 'The request was cancelled.'
          : 'Authorization: Bearer secret-token failed for //user:pass@host',
      retryable: code === 'NETWORK',
    },
    timing: TIMING,
  };
}

function sampleEntry(
  overrides: Partial<HistoryEntry> & {
    readonly summary?: Partial<HistoryEntry['summary']>;
    readonly metadata?: Partial<HistoryEntry['metadata']>;
  } = {},
): HistoryEntry {
  const request = authenticatedRequest();
  const base = buildHistoryEntry({
    runId: 1,
    request,
    result: successResult(request),
    environmentName: 'Development',
    source: buildHistorySourceLocation({
      uri: 'file:///workspace/api/users.api',
      offset: 0,
      line: 0,
      character: 0,
      requestId: request.id,
    }),
  });
  return {
    ...base,
    ...overrides,
    id: overrides.id ?? base.id,
    summary: { ...base.summary, ...overrides.summary },
    metadata: { ...base.metadata, ...overrides.metadata },
  };
}

test('buildHistoryEntry captures success metadata without bodies', () => {
  const request = authenticatedRequest({
    url: 'http://user:secret@example.test/users?token=abc',
    resolution: {
      kind: 'resolved',
      presentationUrl: 'http://example.test/users?token=••••••••',
      sensitiveVariableNames: ['token'],
      sensitiveHeaderNames: ['authorization'],
      sensitiveQueryParameterNames: ['token'],
    },
  });
  const entry = buildHistoryEntry({
    runId: 7,
    request,
    result: successResult(request),
    environmentName: 'Staging',
    collectionName: 'demo',
  });

  assert.equal(entry.summary.status, HistoryExecutionStatus.Success);
  assert.equal(entry.summary.method, 'GET');
  assert.equal(entry.summary.statusCode, 200);
  assert.equal(entry.summary.url, 'http://example.test/users?token=••••••••');
  assert.equal(entry.metadata.requestName, 'List users');
  assert.equal(entry.metadata.environmentName, 'Staging');
  assert.equal(entry.metadata.collectionName, 'demo');
  assert.equal(entry.metadata.contentType, 'application/json');
  assert.equal(entry.metadata.responseSizeBytes, 3);
  assert.equal(entry.schemaVersion, HISTORY_SCHEMA_VERSION);
  assert.equal(entry.extensions, undefined);
  assert.doesNotMatch(JSON.stringify(entry), /secret|Bearer|abc|user:secret/iu);
});

test('buildHistoryEntry records cancelled and failed outcomes safely', () => {
  const request = authenticatedRequest();
  const cancelled = buildHistoryEntry({
    runId: 1,
    request,
    result: failureResult(request, 'CANCELLED'),
  });
  assert.equal(cancelled.summary.status, HistoryExecutionStatus.Cancelled);
  assert.equal(cancelled.metadata.errorCode, 'CANCELLED');

  const failed = buildHistoryEntry({
    runId: 2,
    request,
    result: failureResult(request, 'NETWORK'),
  });
  assert.equal(failed.summary.status, HistoryExecutionStatus.Failure);
  assert.equal(failed.metadata.errorCode, 'NETWORK');
  assert.match(failed.metadata.errorMessage ?? '', /\[redacted\]|Bearer \[redacted\]|\*\*\*/u);
  assert.doesNotMatch(failed.metadata.errorMessage ?? '', /secret-token/u);
  assert.doesNotMatch(failed.metadata.errorMessage ?? '', /user:pass/u);
});

test('sanitizeHistoryUrl redacts userinfo', () => {
  assert.equal(
    sanitizeHistoryUrl('https://alice:pw@example.test/path'),
    'https://***@example.test/path',
  );
});

test('sanitizeHistoryErrorMessage strips credential-bearing fragments', () => {
  const sanitized = sanitizeHistoryErrorMessage(
    [
      'Authorization: Bearer abc.def',
      'Cookie: session=1',
      'Basic dXNlcjpwYXNz',
      'Set-Cookie: id=1',
      'Proxy-Authorization: Basic xxx',
      'failed for //user:sekrit@host',
    ].join('\n'),
  );
  assert.doesNotMatch(sanitized, /abc\.def/u);
  assert.doesNotMatch(sanitized, /session=1/u);
  assert.doesNotMatch(sanitized, /dXNlcjpwYXNz/u);
  assert.doesNotMatch(sanitized, /sekrit/u);
  assert.match(sanitized, /Authorization:\s*\[redacted\]/iu);
  assert.match(sanitized, /Set-Cookie:\s*\[redacted\]/iu);
  assert.match(sanitized, /Bearer \[redacted\]|Basic \[redacted\]/iu);
});

test('isForbiddenHistoryFieldName covers secret-bearing name shapes', () => {
  for (const name of [
    'authorization',
    'Authorization',
    'proxy_authorization',
    'password',
    'userPassword',
    'secret',
    'client_secret',
    'token',
    'accessToken',
    'cookie',
    'cookies',
    'apiKey',
    'api_key',
    'x-api-key',
  ]) {
    assert.equal(isForbiddenHistoryFieldName(name), true, name);
  }
  for (const name of [
    'statusCode',
    'contentType',
    'method',
    'url',
    'durationMs',
    'requestName',
  ]) {
    assert.equal(isForbiddenHistoryFieldName(name), false, name);
  }
});

test('repository append list delete clear and retention cap', async () => {
  const repository = new InMemoryHistoryRepository(2);
  const first = sampleEntry({ id: 'a' });
  const second = sampleEntry({ id: 'b' });
  const third = sampleEntry({ id: 'c' });

  await repository.append(first);
  await repository.append(second);
  await repository.append(third);

  const listed = await repository.list();
  assert.deepEqual(
    listed.map((entry) => entry.id),
    ['c', 'b'],
  );
  assert.equal(await repository.get('a'), undefined);
  assert.equal((await repository.get('b'))?.id, 'b');

  assert.equal(await repository.delete('b'), true);
  assert.deepEqual(
    (await repository.list()).map((entry) => entry.id),
    ['c'],
  );

  await repository.clear();
  assert.equal((await repository.list()).length, 0);

  await repository.setMaxEntries(1);
  await repository.append(sampleEntry({ id: 'd' }));
  await repository.append(sampleEntry({ id: 'e' }));
  assert.deepEqual(
    (await repository.list()).map((entry) => entry.id),
    ['e'],
  );
});

test('search filter sort and group helpers', () => {
  const now = new Date('2026-07-20T18:00:00.000Z');
  const today = sampleEntry({
    id: 'today',
    summary: {
      method: 'GET',
      url: 'http://example.test/today',
      durationMs: 10,
      timestamp: '2026-07-20T12:00:00.000Z',
      status: HistoryExecutionStatus.Success,
      statusCode: 200,
    },
  });
  const yesterday = sampleEntry({
    id: 'yesterday',
    summary: {
      method: 'POST',
      url: 'http://example.test/yesterday',
      durationMs: 20,
      timestamp: '2026-07-19T12:00:00.000Z',
      status: HistoryExecutionStatus.Failure,
    },
  });
  const older = sampleEntry({
    id: 'older',
    summary: {
      method: 'GET',
      url: 'http://example.test/older',
      durationMs: 30,
      timestamp: '2026-07-01T12:00:00.000Z',
      status: HistoryExecutionStatus.Cancelled,
    },
  });

  const filtered = filterHistoryEntries([today, yesterday, older], {
    status: HistoryExecutionStatus.Success,
    query: 'today',
  });
  assert.deepEqual(
    filtered.map((entry) => entry.id),
    ['today'],
  );

  const sorted = sortHistoryEntries([older, today, yesterday], {
    direction: 'desc',
  });
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ['today', 'yesterday', 'older'],
  );

  assert.equal(classifyTimeGroup(today.summary.timestamp, now), 'today');
  assert.equal(
    classifyTimeGroup(yesterday.summary.timestamp, now),
    'yesterday',
  );
  assert.equal(classifyTimeGroup(older.summary.timestamp, now), 'older');

  const groups = groupHistoryEntries([today, yesterday, older], now);
  assert.deepEqual(
    groups.map((group) => group.id),
    ['today', 'yesterday', 'older'],
  );

  assert.deepEqual(computeHistoryStatistics([today, yesterday, older]), {
    total: 3,
    success: 1,
    failure: 1,
    cancelled: 1,
  });
});

test('migration version accepts v1 and rejects unknown schemas', () => {
  const entry = sampleEntry({ id: 'keep' });
  const migrated = migrateHistoryDocument({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    entries: [entry],
  });
  assert.equal(migrated.schemaVersion, HISTORY_SCHEMA_VERSION);
  assert.equal(migrated.entries.length, 1);
  assert.equal(migrated.entries[0]?.id, 'keep');

  const reset = migrateHistoryDocument({
    schemaVersion: 99,
    entries: [entry],
  });
  assert.equal(reset.entries.length, 0);
  assert.equal(reset.schemaVersion, HISTORY_SCHEMA_VERSION);
});

test('migration drops forbidden keys and re-sanitizes url and errorMessage', () => {
  const migrated = migrateHistoryDocument({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    entries: [
      {
        id: 'dirty',
        schemaVersion: HISTORY_SCHEMA_VERSION,
        summary: {
          method: 'GET',
          url: 'https://alice:pw@example.test/path',
          durationMs: 10,
          timestamp: '2026-07-20T12:00:00.000Z',
          status: 'failure',
        },
        metadata: {
          errorCode: 'NETWORK',
          errorMessage: 'Authorization: Bearer secret-token failed',
          authorization: 'Bearer should-not-survive',
          apiToken: 'drop-me',
        },
        password: 'nope',
        extensions: {
          bodyPersistence: { secretValue: 'x' },
        },
      },
    ],
  });

  assert.equal(migrated.entries.length, 1);
  const entry = migrated.entries[0]!;
  assert.equal(entry.summary.url, 'https://***@example.test/path');
  assert.doesNotMatch(entry.metadata.errorMessage ?? '', /secret-token/u);
  assert.equal(
    (entry.metadata as unknown as Record<string, unknown>).authorization,
    undefined,
  );
  assert.equal(
    (entry.metadata as unknown as Record<string, unknown>).apiToken,
    undefined,
  );
  assert.equal((entry as unknown as Record<string, unknown>).password, undefined);
  assert.equal(
    (
      entry.extensions?.bodyPersistence as
        | Record<string, unknown>
        | undefined
    )?.secretValue,
    undefined,
  );
  assert.doesNotMatch(JSON.stringify(entry), /secret-token|alice:pw|Bearer should/iu);
});

test('resolveHistoryRerunArgument maps stored source location', () => {
  const entry = sampleEntry({
    metadata: {
      source: {
        uri: 'file:///workspace/demo.api',
        line: 4,
        character: 2,
        offset: 40,
      },
    },
  });
  assert.deepEqual(resolveHistoryRerunArgument(entry), {
    uri: 'file:///workspace/demo.api',
    position: { line: 4, character: 2 },
  });
  assert.equal(
    resolveHistoryRerunArgument(
      sampleEntry({ metadata: { source: { uri: 'file:///missing-position.api' } } }),
    ),
    undefined,
  );
});

test('DefaultHistoryRecorder ignores stale runs', async () => {
  const repository = new InMemoryHistoryRepository();
  const recorder = new DefaultHistoryRecorder(repository, () => 'fixed-id');
  const request = authenticatedRequest();
  const result = successResult(request);

  recorder.beginRun(1);
  recorder.beginRun(2);
  assert.equal(await recorder.record({ runId: 1, request, result }), false);
  assert.equal((await repository.list()).length, 0);

  assert.equal(await recorder.record({ runId: 2, request, result }), true);
  assert.equal((await repository.list()).length, 1);
  assert.equal((await repository.list())[0]?.id, 'fixed-id');
});
