import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatVariablePreviewError } from './format-variable-preview-error';

test('formatVariablePreviewError uses human messages not codes', () => {
  assert.equal(
    formatVariablePreviewError({
      message: 'Variable "baseUrl" is not defined.',
    }),
    'Variable "baseUrl" is not defined.',
  );
  assert.equal(
    formatVariablePreviewError({ message: '   ' }),
    'Variable could not be resolved',
  );
  assert.doesNotMatch(
    formatVariablePreviewError({
      message: 'Variable "token" is not defined.',
    }),
    /MISSING_VARIABLE/,
  );
});
