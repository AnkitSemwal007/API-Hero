import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AUTHENTICATION_PRESENTATION_MASK,
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
  test('renderAuthManagerHtml embeds CSP nonce and controls', () => {
    const html = renderAuthManagerHtml('authNonce');
    assert.match(html, /style-src 'nonce-authNonce'/u);
    assert.match(html, /script-src 'nonce-authNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="addProfile"/u);
    assert.match(html, /id="save"/u);
    assert.match(html, /id="duplicateProfile"/u);
    assert.match(html, /id="profileSearch"/u);
    assert.match(html, /id="authPreview"/u);
    assert.match(html, /id="missingCta"/u);
    assert.match(html, /id="setDefault"/u);
    assert.match(html, /--vscode-editor-background/u);
    assert.match(html, /Secret Storage/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
  });

  test('escapeAttribute neutralizes quote breakouts', () => {
    assert.equal(escapeAttribute(`a"b'`), 'a&quot;b&#39;');
  });

  test('parseAuthManagerMessage accepts ready, commit, and secret actions', () => {
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
    assert.deepEqual(parseAuthManagerMessage({ type: 'setDefault' }), {
      type: 'setDefault',
    });
    assert.equal(parseAuthManagerMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseAuthManagerMessage({
        type: 'setSecret',
        profileId: '',
        field: 'token',
      }),
      undefined,
    );
    assert.equal(
      parseAuthManagerMessage({
        type: 'commit',
        state: { profiles: 'bad' },
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
    assert.match(
      validateAuthManagerState({
        profiles: [{
          id: 'key',
          label: 'Key',
          providerId: 'apiKey',
          secretFields: [],
        }],
      }) ?? '',
      /requires a header or query name/u,
    );
  });

  test('isValidAuthProfileId and allocateAuthProfileId', () => {
    assert.equal(isValidAuthProfileId('bearer-prod'), true);
    assert.equal(isValidAuthProfileId('__proto__'), false);
    assert.equal(isValidAuthProfileId('1bad'), false);
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

  test('auth manager HTML wires search, duplicate, and preview controls', () => {
    const html = renderAuthManagerHtml('authNonce');
    const bearerPreview = buildAuthenticationPresentationPreview({
      providerId: 'bearer',
      secretFields: [{ field: 'token', label: 'Token', status: 'set' }],
    }).preview;
    assert.match(html, /id="profileSearch"/u);
    assert.match(html, /id="duplicateProfile"/u);
    assert.match(html, /id="authPreview"/u);
    assert.match(html, /id="validationHint"/u);
    assert.match(html, /function buildAuthPreview/u);
    assert.match(html, /duplicateProfile'\)\.addEventListener/u);
    assert.match(html, /profileSearch'\)\.addEventListener/u);
    assert.match(html, new RegExp(escapeRegExp(bearerPreview), 'u'));
    assert.match(
      html,
      new RegExp(
        `const MASK = ${JSON.stringify(AUTHENTICATION_PRESENTATION_MASK)}`,
        'u',
      ),
    );
    assert.match(html, /const SECRET_META =/u);
    assert.match(html, /"field":"token"/u);
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
