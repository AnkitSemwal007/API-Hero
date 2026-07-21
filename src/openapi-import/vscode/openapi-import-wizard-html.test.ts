import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  OPENAPI_IMPORT_WIZARD_STEPS,
  escapeAttribute,
  parseOpenApiImportWizardMessage,
  renderOpenApiImportWizardHtml,
} from './openapi-import-wizard-html';

describe('openapi-import-wizard-html', () => {
  test('OPENAPI_IMPORT_WIZARD_STEPS lists the five wizard stages', () => {
    assert.deepEqual([...OPENAPI_IMPORT_WIZARD_STEPS], [
      'workspace',
      'file',
      'preview',
      'progress',
      'summary',
    ]);
  });

  test('renderOpenApiImportWizardHtml uses nonce CSP and step panels', () => {
    const html = renderOpenApiImportWizardHtml('wizardNonce');
    assert.match(html, /style-src 'nonce-wizardNonce'/u);
    assert.match(html, /script-src 'nonce-wizardNonce'/u);
    assert.match(html, /default-src 'none'/u);
    assert.match(html, /--vscode-editor-background/u);
    assert.match(html, /id="step-workspace"/u);
    assert.match(html, /id="step-file"/u);
    assert.match(html, /id="step-preview"/u);
    assert.match(html, /id="step-progress"/u);
    assert.match(html, /id="step-summary"/u);
    assert.match(html, /id="manageAuth"/u);
    assert.match(html, /Manage Auth Profiles/u);
    assert.match(html, /id="previewImport"/u);
    assert.match(html, /id="outputDirectory"/u);
    assert.doesNotMatch(html, /connect-src [^']*https/u);
  });

  test('escapeAttribute neutralizes quote breakouts', () => {
    assert.equal(escapeAttribute(`a"b'`), 'a&quot;b&#39;');
  });

  test('parseOpenApiImportWizardMessage accepts wizard actions', () => {
    assert.deepEqual(parseOpenApiImportWizardMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(parseOpenApiImportWizardMessage({ type: 'cancel' }), {
      type: 'cancel',
    });
    assert.deepEqual(parseOpenApiImportWizardMessage({ type: 'close' }), {
      type: 'close',
    });
    assert.deepEqual(parseOpenApiImportWizardMessage({ type: 'pickFile' }), {
      type: 'pickFile',
    });
    assert.deepEqual(
      parseOpenApiImportWizardMessage({ type: 'cancelImport' }),
      { type: 'cancelImport' },
    );
    assert.deepEqual(
      parseOpenApiImportWizardMessage({ type: 'manageAuthProfiles' }),
      { type: 'manageAuthProfiles' },
    );
    assert.deepEqual(
      parseOpenApiImportWizardMessage({
        type: 'selectWorkspace',
        path: 'D:/ws',
      }),
      { type: 'selectWorkspace', path: 'D:/ws' },
    );
    assert.deepEqual(
      parseOpenApiImportWizardMessage({
        type: 'analyze',
        outputDirectoryName: 'Collections/api',
      }),
      { type: 'analyze', outputDirectoryName: 'Collections/api' },
    );
    assert.deepEqual(
      parseOpenApiImportWizardMessage({
        type: 'startImport',
        outputDirectoryName: 'Collections/api',
      }),
      { type: 'startImport', outputDirectoryName: 'Collections/api' },
    );
    assert.deepEqual(
      parseOpenApiImportWizardMessage({ type: 'back', to: 'file' }),
      { type: 'back', to: 'file' },
    );
  });

  test('parseOpenApiImportWizardMessage rejects junk and bad steps', () => {
    assert.equal(parseOpenApiImportWizardMessage(null), undefined);
    assert.equal(parseOpenApiImportWizardMessage({ type: 'analyze' }), undefined);
    assert.equal(
      parseOpenApiImportWizardMessage({ type: 'back', to: 'unknown' }),
      undefined,
    );
    assert.equal(
      parseOpenApiImportWizardMessage({ type: 'selectWorkspace' }),
      undefined,
    );
  });
});
