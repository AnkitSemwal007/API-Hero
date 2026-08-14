import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { AuthenticationProfile } from '../../models';
import { AUTHENTICATION_PRESENTATION_MASK } from '../authentication-presentation-preview';
import {
  AUTHENTICATION_UI_KINDS,
  AUTHENTICATION_UI_KIND_LABELS,
  authenticationUiKindFromProviderId,
  buildAuthenticationUiState,
  displayAuthenticationValueSource,
  isAuthenticationUiKind,
  renderAuthenticationUiControlsHtml,
  renderAuthenticationUiKindOptionsHtml,
  summarizeAuthenticationProfileForUi,
} from './authentication-ui';

const LITERAL_TOKEN = 'super-secret-literal-token';
const LITERAL_PASSWORD = 'hunter2-should-never-leak';
const LITERAL_API_KEY = 'ak_live_do_not_show';

describe('authentication-ui', () => {
  test('kinds are the four implemented live providers with product labels', () => {
    assert.deepEqual([...AUTHENTICATION_UI_KINDS], [
      'none',
      'bearer',
      'basic',
      'apiKey',
    ]);
    assert.equal(AUTHENTICATION_UI_KIND_LABELS.none, 'No Auth');
    assert.equal(AUTHENTICATION_UI_KIND_LABELS.bearer, 'Bearer Token');
    assert.equal(AUTHENTICATION_UI_KIND_LABELS.basic, 'Basic Auth');
    assert.equal(AUTHENTICATION_UI_KIND_LABELS.apiKey, 'API Key');
    assert.equal(isAuthenticationUiKind('oauth'), false);
    assert.equal(isAuthenticationUiKind('oauth2'), false);
    assert.equal(authenticationUiKindFromProviderId('oauth2'), 'none');
    const options = renderAuthenticationUiKindOptionsHtml();
    assert.match(options, /No Auth/u);
    assert.match(options, /Bearer Token/u);
    assert.match(options, /Basic Auth/u);
    assert.match(options, /API Key/u);
    assert.doesNotMatch(options, /OAuth/u);
  });

  test('value display shows variables and masks secrets and literals', () => {
    assert.deepEqual(
      displayAuthenticationValueSource({ kind: 'variable', name: 'authToken' }),
      { display: '{{authToken}}', sourceKind: 'variable' },
    );
    assert.deepEqual(displayAuthenticationValueSource({ kind: 'secret' }), {
      display: AUTHENTICATION_PRESENTATION_MASK,
      sourceKind: 'secret',
    });
    assert.deepEqual(
      displayAuthenticationValueSource({
        kind: 'literal',
        value: LITERAL_TOKEN,
        unsafe: true,
      }),
      { display: AUTHENTICATION_PRESENTATION_MASK, sourceKind: 'literal' },
    );
    assert.deepEqual(displayAuthenticationValueSource(undefined), {
      display: '',
      sourceKind: 'empty',
    });
    const literalDisplay = displayAuthenticationValueSource({
      kind: 'literal',
      value: LITERAL_TOKEN,
      unsafe: true,
    });
    assert.equal(literalDisplay.display.includes(LITERAL_TOKEN), false);
  });

  test('No Auth when nothing applies', () => {
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [],
    });
    assert.equal(state.selectedKind, 'none');
    assert.equal(state.inheriting, false);
    assert.equal(state.canInherit, false);
    assert.equal(state.override, false);
    assert.equal(state.effectiveLabel, 'No Auth');
    assert.equal(state.resolution.source, 'none');
    assert.equal(state.preview.preview, 'No authentication headers will be added.');
    assert.equal(state.fields.length, 0);
    assert.deepEqual([...state.availableKinds], [...AUTHENTICATION_UI_KINDS]);
  });

  test('Bearer / Basic / API Key field displays and add-to options', () => {
    const bearer = buildAuthenticationUiState({
      surface: 'request',
      profiles: [bearerProfile()],
      requestOverrideId: 'auth-bearer',
    });
    assert.equal(bearer.selectedKind, 'bearer');
    assert.equal(bearer.selectedProfileId, 'auth-bearer');
    assert.equal(bearer.override, true);
    assert.equal(bearer.inheriting, false);
    assert.equal(bearer.fields[0]?.label, 'Token');
    assert.equal(bearer.fields[0]?.display, AUTHENTICATION_PRESENTATION_MASK);
    assert.equal(bearer.addTo[0]?.id, 'authorization-header');
    assert.equal(bearer.addTo[0]?.readOnly, true);
    assert.match(bearer.preview.preview, /Authorization: Bearer/u);

    const basic = buildAuthenticationUiState({
      surface: 'request',
      profiles: [basicProfile()],
      requestOverrideId: 'auth-basic',
    });
    assert.equal(basic.selectedKind, 'basic');
    const labels = basic.fields.map((field) => field.label);
    assert.deepEqual(labels, ['Username', 'Password']);
    assert.equal(basic.fields[0]?.display, '{{basicUser}}');
    assert.equal(basic.fields[1]?.display, AUTHENTICATION_PRESENTATION_MASK);
    assert.equal(JSON.stringify(basic).includes(LITERAL_PASSWORD), false);

    const apiKey = buildAuthenticationUiState({
      surface: 'request',
      profiles: [apiKeyProfile()],
      requestOverrideId: 'auth-key',
    });
    assert.equal(apiKey.selectedKind, 'apiKey');
    assert.equal(apiKey.fields[0]?.label, 'Key');
    assert.equal(apiKey.fields[0]?.display, 'X-API-Key');
    assert.equal(apiKey.fields[1]?.label, 'Value');
    assert.equal(apiKey.fields[1]?.display, AUTHENTICATION_PRESENTATION_MASK);
    assert.equal(apiKey.selectedAddToId, 'header');
    assert.deepEqual(
      apiKey.addTo.map((option) => option.id),
      ['header', 'query'],
    );
    assert.equal(JSON.stringify(apiKey).includes(LITERAL_API_KEY), false);
  });

  test('request-level override vs collection-level default', () => {
    const profiles = [bearerProfile(), basicProfile()];
    const request = buildAuthenticationUiState({
      surface: 'request',
      profiles,
      requestOverrideId: 'auth-bearer',
      collectionDefaultId: 'auth-basic',
      workspaceDefaultId: 'auth-bearer',
    });
    assert.equal(request.resolution.source, 'request');
    assert.equal(request.selectedKind, 'bearer');
    assert.equal(request.override, true);
    assert.equal(request.inheriting, false);
    assert.equal(request.canInherit, true);

    const collection = buildAuthenticationUiState({
      surface: 'collection',
      profiles,
      collectionDefaultId: 'auth-basic',
    });
    assert.equal(collection.surface, 'collection');
    assert.equal(collection.selectedKind, 'basic');
    assert.equal(collection.selectedProfileId, 'auth-basic');
    assert.equal(collection.resolution.source, 'collection');
    assert.equal(collection.inheriting, false);
    assert.equal(collection.canInherit, false);
  });

  test('inherits from collection when request has no @auth', () => {
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [bearerProfile(), basicProfile()],
      collectionDefaultId: 'auth-basic',
      workspaceDefaultId: 'auth-bearer',
    });
    assert.equal(state.inheriting, true);
    assert.equal(state.canInherit, true);
    assert.equal(state.override, false);
    assert.equal(state.inheritLabel, 'Inherited from Collection');
    assert.equal(state.selectedKind, 'basic');
    assert.equal(state.selectedProfileId, 'auth-basic');
    assert.equal(state.resolution.source, 'collection');
    assert.equal(state.effectiveLabel, 'Inherited from Collection');
  });

  test('inherits from session when no request or collection default', () => {
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [bearerProfile()],
      workspaceDefaultId: 'auth-bearer',
    });
    assert.equal(state.inheriting, true);
    assert.equal(state.inheritLabel, 'Inherited from Session');
    assert.equal(state.selectedKind, 'bearer');
    assert.equal(state.resolution.source, 'workspace');
  });

  test('override uses request Type even when collection default exists', () => {
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [bearerProfile(), basicProfile()],
      collectionDefaultId: 'auth-basic',
      override: true,
      selectedKind: 'bearer',
      selectedProfileId: 'auth-bearer',
    });
    assert.equal(state.inheriting, false);
    assert.equal(state.override, true);
    assert.equal(state.selectedKind, 'bearer');
    assert.equal(state.selectedProfileId, 'auth-bearer');
  });

  test('environment variable {{authToken}} is shown, never the secret', () => {
    const profile: AuthenticationProfile = {
      id: 'env-bearer',
      label: 'Env Bearer',
      providerId: 'bearer',
      token: { kind: 'variable', name: 'authToken' },
    };
    const summary = summarizeAuthenticationProfileForUi(profile);
    assert.equal(summary.fields[0]?.display, '{{authToken}}');
    assert.equal(summary.fields[0]?.sourceKind, 'variable');
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [profile],
      requestOverrideId: 'env-bearer',
    });
    assert.equal(state.fields[0]?.display, '{{authToken}}');
    assert.equal(JSON.stringify(state).includes('authToken'), true);
  });

  test('literal credential values never appear in the view model', () => {
    const profile: AuthenticationProfile = {
      id: 'lit',
      label: 'Literal Bearer',
      providerId: 'bearer',
      token: { kind: 'literal', value: LITERAL_TOKEN, unsafe: true },
    };
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [profile],
      requestOverrideId: 'lit',
    });
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes(LITERAL_TOKEN), false);
    assert.equal(state.fields[0]?.display, AUTHENTICATION_PRESENTATION_MASK);
    assert.equal(state.fields[0]?.sourceKind, 'literal');
  });

  test('availableKinds is unchanged across REST, GraphQL, and WebSocket', () => {
    for (const protocol of ['http', 'graphql', 'websocket']) {
      const state = buildAuthenticationUiState({
        surface: 'request',
        profiles: [bearerProfile(), basicProfile(), apiKeyProfile()],
        protocol,
      });
      assert.deepEqual([...state.availableKinds], [...AUTHENTICATION_UI_KINDS]);
    }
  });

  test('Run Setup collection-default vs resolved preference mapping', () => {
    const profiles = [basicProfile(), bearerProfile()];
    const collectionDefault = buildAuthenticationUiState({
      surface: 'run-setup',
      profiles,
      collectionDefaultId: 'auth-basic',
      workspaceDefaultId: 'auth-bearer',
      authenticationPreference: 'collection-default',
    });
    assert.equal(collectionDefault.resolution.source, 'collection');
    assert.equal(collectionDefault.selectedKind, 'basic');
    assert.equal(collectionDefault.effectiveLabel, 'Collection default');
    assert.equal(collectionDefault.selectedProfileId, 'auth-basic');

    const resolved = buildAuthenticationUiState({
      surface: 'run-setup',
      profiles,
      collectionDefaultId: 'auth-basic',
      workspaceDefaultId: 'auth-bearer',
      authenticationPreference: 'resolved',
    });
    assert.equal(resolved.resolution.source, 'workspace');
    assert.equal(resolved.selectedKind, 'bearer');
    assert.equal(resolved.effectiveLabel, 'Prod Bearer');
    assert.equal(resolved.selectedProfileId, 'auth-bearer');

    const none = buildAuthenticationUiState({
      surface: 'run-setup',
      profiles,
      authenticationPreference: 'resolved',
    });
    assert.equal(none.selectedKind, 'none');
    assert.equal(none.effectiveLabel, 'None');
    assert.equal(none.resolution.source, 'none');
  });

  test('none profiles map to No Auth', () => {
    const state = buildAuthenticationUiState({
      surface: 'request',
      profiles: [
        { id: 'nope', label: 'Skip', providerId: 'none' },
      ],
      requestOverrideId: 'nope',
    });
    assert.equal(state.selectedKind, 'none');
    assert.equal(state.fields.length, 0);
  });

  test('collection controls HTML lists types, never OAuth, and has no secret values', () => {
    const html = renderAuthenticationUiControlsHtml('collection');
    assert.match(html, /id="authKind"/u);
    assert.match(html, /Bearer Token/u);
    assert.match(html, /Basic Auth/u);
    assert.match(html, /API Key/u);
    assert.match(html, /No Auth/u);
    assert.doesNotMatch(html, /OAuth/u);
    assert.doesNotMatch(html, /oneshotToken/u);
    assert.match(html, /authTokenDisplay/u);
    assert.equal(html.includes(LITERAL_TOKEN), false);
  });

  test('request controls HTML includes Override, one-shot inputs, and Add to', () => {
    const html = renderAuthenticationUiControlsHtml('request');
    assert.match(html, /id="authOverride"/u);
    assert.match(html, />Override</u);
    assert.match(html, /id="oneshotToken"/u);
    assert.match(html, /id="oneshotUsername"/u);
    assert.match(html, /id="oneshotPassword"/u);
    assert.match(html, /id="oneshotApiKeyName"/u);
    assert.match(html, /id="oneshotApiKeyValue"/u);
    assert.match(html, /id="authAddTo"/u);
    assert.match(html, /Authorization Header/u);
    assert.doesNotMatch(html, /OAuth/u);
  });
});

function bearerProfile(): AuthenticationProfile {
  return {
    id: 'auth-bearer',
    label: 'Prod Bearer',
    providerId: 'bearer',
    token: { kind: 'secret' },
  };
}

function basicProfile(): AuthenticationProfile {
  return {
    id: 'auth-basic',
    label: 'Basic Prod',
    providerId: 'basic',
    username: { kind: 'variable', name: 'basicUser' },
    password: { kind: 'literal', value: LITERAL_PASSWORD, unsafe: true },
  };
}

function apiKeyProfile(): AuthenticationProfile {
  return {
    id: 'auth-key',
    label: 'API Key Prod',
    providerId: 'apiKey',
    name: 'X-API-Key',
    location: 'header',
    value: { kind: 'literal', value: LITERAL_API_KEY, unsafe: true },
  };
}
