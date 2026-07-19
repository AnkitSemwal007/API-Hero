import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateAuthenticationProfiles } from '../../auth';
import { parseApiDocument } from '../../parser';
import {
  createAuthenticationAvailabilityDiagnostics,
  createAuthenticationDiagnostics,
} from './authentication-diagnostics';

test('authentication diagnostics identify profiles without secret values', () => {
  const document = parseApiDocument(
    '@auth missing\nGET https://example.test',
    { sourceId: 'auth.api' },
  ).ast;
  const diagnostics = createAuthenticationDiagnostics(document, {
    validation: validateAuthenticationProfiles([{
      id: 'configured',
      providerId: 'bearer',
      token: { kind: 'literal', value: 'must-not-leak', unsafe: true },
    }]),
    providerIds: ['none', 'bearer'],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, 'authentication.missing-profile');
  assert.equal(JSON.stringify(diagnostics).includes('must-not-leak'), false);
});

test('authentication diagnostics reject duplicate and unsupported profiles', () => {
  const duplicateDocument = parseApiDocument(
    '@auth duplicate\nGET https://example.test',
  ).ast;
  const duplicate = createAuthenticationDiagnostics(duplicateDocument, {
    validation: validateAuthenticationProfiles([
      { id: 'duplicate', providerId: 'none' },
      { id: 'duplicate', providerId: 'none' },
    ]),
    providerIds: ['none'],
  });
  assert.equal(duplicate[0]?.code, 'authentication.duplicate-profile');

  const unsupportedDocument = parseApiDocument(
    '@auth cloud\nGET https://example.test',
  ).ast;
  const unsupported = createAuthenticationDiagnostics(unsupportedDocument, {
    validation: validateAuthenticationProfiles([
      { id: 'cloud', providerId: 'aws-signature' },
    ]),
    providerIds: ['none'],
  });
  assert.equal(unsupported[0]?.code, 'authentication.unsupported-provider');
});

test('malformed and duplicate entries never disable valid or none profiles', () => {
  const document = parseApiDocument(
    ['@auth good', 'GET https://example.test'].join('\n'),
  ).ast;
  const diagnostics = createAuthenticationDiagnostics(document, {
    validation: validateAuthenticationProfiles([
      { id: 'good', providerId: 'bearer', token: { kind: 'secret' } },
      { id: 'dup', providerId: 'none' },
      { id: 'dup', providerId: 'none' },
      { id: '', providerId: 'none' },
      { id: '__proto__', providerId: 'none' },
    ] as never),
    providerIds: ['none', 'bearer'],
  });
  assert.deepEqual(diagnostics, []);
});

test('availability diagnostics report missing secret fields without values', async () => {
  const document = parseApiDocument(
    '@auth secure\nGET https://example.test',
  ).ast;
  const reads: string[] = [];
  const diagnostics = await createAuthenticationAvailabilityDiagnostics(
    document,
    {
      validation: validateAuthenticationProfiles([{
        id: 'secure',
        providerId: 'bearer',
        token: { kind: 'secret' },
      }]),
      providerIds: ['bearer'],
      secrets: {
        async get(profileId, field) {
          reads.push(`${profileId}:${field}`);
          return undefined;
        },
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    },
  );
  assert.deepEqual(reads, ['secure:token']);
  assert.equal(diagnostics[0]?.code, 'authentication.missing-secret');
  assert.equal(JSON.stringify(diagnostics).includes('undefined'), false);
});
