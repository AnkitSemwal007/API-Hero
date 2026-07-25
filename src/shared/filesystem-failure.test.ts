import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeFilesystemFailure } from './filesystem-failure';

test('maps permission codes to actionable copy', () => {
  assert.match(
    describeFilesystemFailure({ code: 'NoPermissions', message: 'x' }) ?? '',
    /read-only or permission/i,
  );
  assert.match(
    describeFilesystemFailure({ code: 'Unavailable', message: 'x' }) ?? '',
    /read-only or permission/i,
  );
});

test('maps common OS errno messages', () => {
  assert.match(
    describeFilesystemFailure(new Error('EACCES: permission denied')) ?? '',
    /writable folder/i,
  );
  assert.match(
    describeFilesystemFailure(new Error('EROFS: read-only file system')) ?? '',
    /writable folder/i,
  );
});

test('returns undefined for unrelated errors', () => {
  assert.equal(describeFilesystemFailure(new Error('disk full')), undefined);
  assert.equal(describeFilesystemFailure(null), undefined);
});
