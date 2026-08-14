import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseCollectionRunSetupMessage,
  renderCollectionRunSetupHtml,
} from './collection-run-setup-html';

describe('collection-run-setup-html', () => {
  test('renderCollectionRunSetupHtml embeds CSP nonce, title, and section markers', () => {
    const html = renderCollectionRunSetupHtml('setupNonce');
    assert.match(html, /style-src 'nonce-setupNonce'/u);
    assert.match(html, /script-src 'nonce-setupNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /id="root"/u);
    assert.match(html, /Loading run setup/u);
    assert.match(html, /<title>Run Collection<\/title>/u);
    assert.match(html, /--vscode-editor-background/u);
    assert.match(html, /button\.primary/u);
    assert.match(html, /setup-collection/u);
    assert.match(html, /setup-environment/u);
    assert.match(html, /setup-variables/u);
    assert.match(html, /setup-authentication/u);
    assert.match(html, /auth-ui-summary/u);
    assert.match(html, /AUTH_KIND_LABELS/u);
    assert.match(html, /"none":"No Auth"/u);
    assert.match(html, /perRequestOverrideHint/u);
    assert.match(html, /@auth still overrides/u);
    assert.doesNotMatch(html, /OAuth/u);
    assert.match(html, /setup-requests/u);
    assert.match(html, /setup-options/u);
    assert.match(html, /setup-footer/u);
    assert.match(html, /img-src 'none'/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
    assert.doesNotMatch(html, /img-src data:/u);
    assert.match(html, /model\.canRun === false/u);
  });

  test('parseCollectionRunSetupMessage accepts allowlisted actions only', () => {
    assert.deepEqual(parseCollectionRunSetupMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseCollectionRunSetupMessage({ type: 'run' }), {
      type: 'run',
    });
    assert.deepEqual(parseCollectionRunSetupMessage({ type: 'cancel' }), {
      type: 'cancel',
    });
    assert.deepEqual(parseCollectionRunSetupMessage({ type: 'focusCollections' }), {
      type: 'focusCollections',
    });
    assert.deepEqual(parseCollectionRunSetupMessage({ type: 'toggleAllRequests' }), {
      type: 'toggleAllRequests',
    });
    assert.deepEqual(
      parseCollectionRunSetupMessage({
        type: 'selectEnvironment',
        environmentId: '',
      }),
      { type: 'selectEnvironment', environmentId: '' },
    );
    assert.deepEqual(
      parseCollectionRunSetupMessage({
        type: 'selectEnvironment',
        environmentId: 'env-dev',
      }),
      { type: 'selectEnvironment', environmentId: 'env-dev' },
    );
    assert.deepEqual(
      parseCollectionRunSetupMessage({
        type: 'setAuthenticationPreference',
        preference: 'resolved',
      }),
      { type: 'setAuthenticationPreference', preference: 'resolved' },
    );
    assert.deepEqual(
      parseCollectionRunSetupMessage({
        type: 'toggleRequest',
        requestId: 'r1',
      }),
      { type: 'toggleRequest', requestId: 'r1' },
    );
    assert.deepEqual(
      parseCollectionRunSetupMessage({
        type: 'toggleFolder',
        folderId: 'folder:a',
      }),
      { type: 'toggleFolder', folderId: 'folder:a' },
    );
    assert.deepEqual(
      parseCollectionRunSetupMessage({
        type: 'setFailurePolicy',
        failurePolicy: 'stop-on-first-error',
      }),
      { type: 'setFailurePolicy', failurePolicy: 'stop-on-first-error' },
    );

    assert.equal(parseCollectionRunSetupMessage({ type: 'nope' }), undefined);
    assert.equal(
      parseCollectionRunSetupMessage({ type: 'ready', extra: true }),
      undefined,
    );
    assert.equal(
      parseCollectionRunSetupMessage({ type: 'run', extra: true }),
      undefined,
    );
    assert.equal(
      parseCollectionRunSetupMessage({
        type: 'setAuthenticationPreference',
        preference: 'oauth',
      }),
      undefined,
    );
    assert.equal(
      parseCollectionRunSetupMessage({
        type: 'setFailurePolicy',
        failurePolicy: 'skip-invalid-requests',
      }),
      undefined,
    );
    assert.equal(
      parseCollectionRunSetupMessage({ type: 'toggleRequest', requestId: '' }),
      undefined,
    );
    assert.equal(
      parseCollectionRunSetupMessage({
        type: 'toggleRequest',
        requestId: 'r1',
        extra: true,
      }),
      undefined,
    );
    assert.equal(parseCollectionRunSetupMessage(null), undefined);
  });
});
