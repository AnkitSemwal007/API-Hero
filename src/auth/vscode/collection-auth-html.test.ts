import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AUTHENTICATION_PRESENTATION_MASK } from '../authentication-presentation-preview';
import {
  buildCollectionAuthState,
  parseCollectionAuthMessage,
  renderCollectionAuthHtml,
  resolveCollectionAuthSaveProfileId,
} from './collection-auth-html';

const LITERAL = 'collection-auth-secret-must-not-leak';

describe('collection-auth-html', () => {
  test('renderCollectionAuthHtml embeds CSP, types, and no OAuth', () => {
    const html = renderCollectionAuthHtml('colAuthNonce');
    assert.match(html, /style-src 'nonce-colAuthNonce'/u);
    assert.match(html, /script-src 'nonce-colAuthNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /<title>Collection Authentication<\/title>/u);
    assert.match(html, /<h1>Collection Authentication<\/h1>/u);
    assert.match(html, /id="authKind"/u);
    assert.match(html, /No Auth/u);
    assert.match(html, /Bearer Token/u);
    assert.match(html, /Basic Auth/u);
    assert.match(html, /API Key/u);
    assert.match(html, /Manage Authentication/u);
    assert.match(html, /id="save"/u);
    assert.match(html, /id="cancel"/u);
    assert.doesNotMatch(html, /OAuth/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
    assert.equal(html.includes(LITERAL), false);
  });

  test('parseCollectionAuthMessage allowlists ready, save, cancel, manage', () => {
    assert.deepEqual(parseCollectionAuthMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseCollectionAuthMessage({ type: 'cancel' }), {
      type: 'cancel',
    });
    assert.deepEqual(parseCollectionAuthMessage({ type: 'manageAuthentication' }), {
      type: 'manageAuthentication',
    });
    assert.deepEqual(parseCollectionAuthMessage({ type: 'save' }), {
      type: 'save',
    });
    assert.deepEqual(
      parseCollectionAuthMessage({ type: 'save', profileId: 'auth-bearer' }),
      { type: 'save', profileId: 'auth-bearer' },
    );
    assert.equal(parseCollectionAuthMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseCollectionAuthMessage({ type: 'ready', extra: true }),
      undefined,
    );
    assert.equal(
      parseCollectionAuthMessage({ type: 'save', profileId: '' }),
      undefined,
    );
    assert.equal(
      parseCollectionAuthMessage({
        type: 'save',
        profileId: 'auth-bearer',
        extra: true,
      }),
      undefined,
    );
  });

  test('buildCollectionAuthState never includes secret literals', () => {
    const state = buildCollectionAuthState({
      collectionName: 'Payments',
      collectionId: 'collection:pay',
      defaultAuthenticationId: 'auth-bearer',
      profiles: [
        {
          id: 'auth-bearer',
          label: 'Prod Bearer',
          providerId: 'bearer',
          fields: [
            {
              name: 'token',
              label: 'Token',
              display: AUTHENTICATION_PRESENTATION_MASK,
              sourceKind: 'literal',
            },
          ],
        },
      ],
    });
    assert.equal(state.ui.selectedKind, 'bearer');
    assert.equal(state.ui.selectedProfileId, 'auth-bearer');
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes(LITERAL), false);
    assert.equal(serialized.includes(AUTHENTICATION_PRESENTATION_MASK), true);
    assert.equal(state.profiles, state.ui.profiles);
  });

  test('resolveCollectionAuthSaveProfileId accepts None and known ids only', () => {
    const known = ['auth-bearer', 'auth-basic'];
    assert.deepEqual(resolveCollectionAuthSaveProfileId(undefined, known), {
      ok: true,
    });
    assert.deepEqual(resolveCollectionAuthSaveProfileId('auth-bearer', known), {
      ok: true,
      profileId: 'auth-bearer',
    });
    assert.deepEqual(resolveCollectionAuthSaveProfileId('missing-profile', known), {
      ok: false,
      message: 'Unknown Authentication profile.',
    });
    assert.deepEqual(resolveCollectionAuthSaveProfileId('1bad', known), {
      ok: false,
      message: 'Invalid Authentication id.',
    });
    assert.deepEqual(resolveCollectionAuthSaveProfileId('__proto__', known), {
      ok: false,
      message: 'Invalid Authentication id.',
    });
  });
});
