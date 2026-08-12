import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePostmanImportWizardMessage } from './postman-import-wizard-html';

test('parsePostmanImportWizardMessage accepts known messages', () => {
  assert.deepEqual(parsePostmanImportWizardMessage({ type: 'ready' }), {
    type: 'ready',
  });
  assert.deepEqual(
    parsePostmanImportWizardMessage({
      type: 'analyze',
      outputDirectoryName: 'Collections/demo',
    }),
    { type: 'analyze', outputDirectoryName: 'Collections/demo' },
  );
  assert.deepEqual(
    parsePostmanImportWizardMessage({
      type: 'selectWorkspace',
      path: 'D:/ws',
    }),
    { type: 'selectWorkspace', path: 'D:/ws' },
  );
  assert.equal(
    parsePostmanImportWizardMessage({ type: 'selectWorkspace' }),
    undefined,
  );
  assert.equal(
    parsePostmanImportWizardMessage({ type: 'fetchUrl', url: 'https://x' }),
    undefined,
  );
});
