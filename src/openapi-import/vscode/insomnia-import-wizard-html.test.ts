import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  INSOMNIA_IMPORT_WIZARD_STEPS,
  parseInsomniaImportWizardMessage,
  renderInsomniaImportWizardHtml,
} from './insomnia-import-wizard-html';
import { renderPostmanImportWizardHtml } from './postman-import-wizard-html';

describe('insomnia-import-wizard-html', () => {
  test('INSOMNIA_IMPORT_WIZARD_STEPS lists the five wizard stages', () => {
    assert.deepEqual([...INSOMNIA_IMPORT_WIZARD_STEPS], [
      'workspace',
      'file',
      'preview',
      'progress',
      'summary',
    ]);
  });

  test('renderInsomniaImportWizardHtml applies CSP nonces', () => {
    const html = renderInsomniaImportWizardHtml('wizardNonce');
    assert.match(html, /style-src 'nonce-wizardNonce'/u);
    assert.match(html, /script-src 'nonce-wizardNonce'/u);
    assert.match(html, /Import Insomnia Export/u);
  });

  test('parseInsomniaImportWizardMessage accepts wizard actions', () => {
    assert.deepEqual(parseInsomniaImportWizardMessage({ type: 'ready' }), {
      type: 'ready',
    });
    assert.deepEqual(
      parseInsomniaImportWizardMessage({
        type: 'analyze',
        outputDirectoryName: 'Collections/demo',
      }),
      { type: 'analyze', outputDirectoryName: 'Collections/demo' },
    );
    assert.equal(
      parseInsomniaImportWizardMessage({ type: 'analyze' }),
      undefined,
    );
  });

  test('collection wizard error handler does not force preview step', () => {
    const insomniaHtml = renderInsomniaImportWizardHtml('n');
    const postmanHtml = renderPostmanImportWizardHtml('n');
    for (const html of [insomniaHtml, postmanHtml]) {
      assert.match(
        html,
        /if \(message\.type === 'error'\) \{\s*\/\/ Stay on the current step/u,
      );
      assert.doesNotMatch(
        html,
        /if \(message\.type === 'error'\) \{[^}]*showStep\('preview'\)/u,
      );
    }
  });
});
