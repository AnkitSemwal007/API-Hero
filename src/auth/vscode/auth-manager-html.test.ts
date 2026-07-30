import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AUTHENTICATION_PRESENTATION_MASK,
  AUTHENTICATION_SECRET_FIELD_MASK,
  buildAuthenticationPresentationPreview,
} from '../authentication-presentation-preview';
import {
  allocateAuthProfileId,
  escapeAttribute,
  isValidAuthProfileId,
  parseAuthManagerMessage,
  renderAuthManagerHtml,
  secretFieldsForProvider,
  validateAuthManagerState,
  type AuthManagerState,
} from './auth-manager-html';

describe('auth-manager-html', () => {
  test('renderAuthManagerHtml embeds CSP nonce and Phase 2 controls', () => {
    const html = renderAuthManagerHtml('authNonce');
    assert.match(html, /style-src 'nonce-authNonce'/u);
    assert.match(html, /script-src 'nonce-authNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="addProfile"/u);
    assert.match(html, /\+ New Authentication/u);
    assert.match(html, /<title>Manage Authentication<\/title>/u);
    assert.match(html, /<h1>Authentication<\/h1>/u);
    assert.match(html, /No Authentication yet/u);
    assert.match(html, /empty-state/u);
    assert.match(html, /id="loginWizard"/u);
    assert.match(html, /id="templateDialog"/u);
    assert.match(html, /id="wizardOverwriteConfirm"/u);
    assert.match(html, /cancelLoginWizard/u);
    assert.match(html, /JWT Login/u);
    assert.match(html, /Coming soon/u);
    assert.match(html, /id="save"/u);
    assert.match(html, /id="authPreview"/u);
    assert.match(html, /Copy header name/u);
    assert.match(html, /SECRET_MASK/u);
    assert.match(html, /storeSecret/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
  });

  test('escapeAttribute neutralizes quote breakouts', () => {
    assert.equal(escapeAttribute(`a"b'`), 'a&quot;b&#39;');
  });

  test('parseAuthManagerMessage accepts ready, commit, storeSecret, and actions', () => {
    assert.deepEqual(parseAuthManagerMessage({ type: 'ready' }), {
      type: 'ready',
    });
    const state = sampleState();
    assert.deepEqual(
      parseAuthManagerMessage({ type: 'commit', state }),
      { type: 'commit', state },
    );
    assert.deepEqual(
      parseAuthManagerMessage({
        type: 'storeSecret',
        profileId: 'prod',
        field: 'token',
        value: 'ephemeral',
      }),
      {
        type: 'storeSecret',
        profileId: 'prod',
        field: 'token',
        value: 'ephemeral',
      },
    );
    assert.deepEqual(
      parseAuthManagerMessage({
        type: 'setSecret',
        profileId: 'prod',
        field: 'token',
      }),
      { type: 'setSecret', profileId: 'prod', field: 'token' },
    );
    assert.deepEqual(
      parseAuthManagerMessage({
        type: 'clearSecret',
        profileId: 'prod',
        field: 'token',
      }),
      { type: 'clearSecret', profileId: 'prod', field: 'token' },
    );
    assert.deepEqual(
      parseAuthManagerMessage({ type: 'setDefault', profileId: 'prod' }),
      { type: 'setDefault', profileId: 'prod' },
    );
    assert.deepEqual(
      parseAuthManagerMessage({
        type: 'testAuth',
        profileId: 'prod',
        testUrl: 'https://api.example.com/me',
      }),
      {
        type: 'testAuth',
        profileId: 'prod',
        testUrl: 'https://api.example.com/me',
      },
    );
    assert.deepEqual(
      parseAuthManagerMessage({
        type: 'applyLoginTokens',
        profileId: 'prod',
        accessTokenPath: 'access_token',
        confirmOverwrite: true,
      }),
      {
        type: 'applyLoginTokens',
        profileId: 'prod',
        accessTokenPath: 'access_token',
        confirmOverwrite: true,
      },
    );
    assert.deepEqual(
      parseAuthManagerMessage({
        type: 'cancelLoginWizard',
        profileId: 'prod',
      }),
      { type: 'cancelLoginWizard', profileId: 'prod' },
    );
    assert.equal(parseAuthManagerMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseAuthManagerMessage({
        type: 'storeSecret',
        profileId: '',
        field: 'token',
        value: 'x',
      }),
      undefined,
    );
  });

  test('validateAuthManagerState rejects bad ids and unknown default', () => {
    assert.equal(validateAuthManagerState(sampleState()), undefined);
    assert.match(
      validateAuthManagerState({
        ...sampleState(),
        profiles: [{
          id: '1bad',
          label: 'Bad',
          providerId: 'bearer',
          secretFields: [],
        }],
      }) ?? '',
      /Invalid profile id/u,
    );
    assert.match(
      validateAuthManagerState({
        ...sampleState(),
        defaultProfileId: 'missing',
      }) ?? '',
      /Unknown default profile/u,
    );
  });

  test('isValidAuthProfileId and allocateAuthProfileId', () => {
    assert.equal(isValidAuthProfileId('bearer-prod'), true);
    assert.equal(isValidAuthProfileId('__proto__'), false);
    assert.equal(allocateAuthProfileId('My Token', new Set()), 'my-token');
    assert.equal(
      allocateAuthProfileId('My Token', new Set(['my-token'])),
      'my-token-2',
    );
  });

  test('secretFieldsForProvider returns provider-specific fields', () => {
    assert.deepEqual(secretFieldsForProvider('none'), []);
    assert.equal(secretFieldsForProvider('bearer')[0]?.field, 'token');
    assert.equal(secretFieldsForProvider('basic').length, 2);
    assert.equal(secretFieldsForProvider('apiKey')[0]?.field, 'value');
  });

  test('commit payloads never require secret values', () => {
    const message = parseAuthManagerMessage({
      type: 'commit',
      state: sampleState(),
    });
    assert.equal(message?.type, 'commit');
    if (message?.type !== 'commit') {
      return;
    }
    const serialized = JSON.stringify(message.state);
    assert.doesNotMatch(serialized, /sekrit|password-value|token-value/iu);
    assert.match(serialized, /"status":"missing"/u);
  });

  test('auth manager HTML wires preview and secret field mask', () => {
    const html = renderAuthManagerHtml('authNonce');
    const bearerPreview = buildAuthenticationPresentationPreview({
      providerId: 'bearer',
      secretFields: [{ field: 'token', label: 'Token', status: 'set' }],
    }).preview;
    assert.match(html, /id="profileSearch"/u);
    assert.match(html, /id="duplicateProfile"/u);
    assert.match(html, /id="authPreview"/u);
    assert.match(html, /function buildAuthPreview/u);
    assert.match(html, /Identity: /u);
    assert.doesNotMatch(html, /Authenticated User:/u);
    assert.match(html, new RegExp(escapeRegExp(bearerPreview), 'u'));
    assert.match(
      html,
      new RegExp(
        `const MASK = ${JSON.stringify(AUTHENTICATION_PRESENTATION_MASK)}`,
        'u',
      ),
    );
    assert.match(
      html,
      new RegExp(
        escapeRegExp(
          `const SECRET_MASK = ${JSON.stringify(AUTHENTICATION_SECRET_FIELD_MASK)}`,
        ),
        'u',
      ),
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sampleState(): AuthManagerState {
  return {
    profiles: [
      {
        id: 'prod',
        label: 'Production Bearer',
        providerId: 'bearer',
        secretFields: [
          { field: 'token', label: 'Token', status: 'missing' },
        ],
      },
      {
        id: 'key',
        label: 'API Key',
        providerId: 'apiKey',
        apiKeyName: 'X-API-Key',
        apiKeyLocation: 'header',
        secretFields: [
          { field: 'value', label: 'API key value', status: 'set' },
        ],
      },
    ],
    defaultProfileId: 'prod',
    selectedId: 'prod',
  };
}
