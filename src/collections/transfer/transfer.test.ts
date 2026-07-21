import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLECTION_MARKER_FILENAME } from '../constants';
import {
  collectionExportDestinationPath,
  looksLikeCollectionRoot,
  preferredCollectionDirectoryName,
  resolveCollectionNameCollision,
} from './index';

test('resolveCollectionNameCollision uses preferred name when free', () => {
  const resolved = resolveCollectionNameCollision('Pets', ['Other'], 'rename');
  assert.deepEqual(resolved, {
    directoryName: 'Pets',
    overwrite: false,
  });
});

test('resolveCollectionNameCollision renames on collision', () => {
  const resolved = resolveCollectionNameCollision(
    'Pets',
    ['Pets', 'Pets (2)'],
    'rename',
  );
  assert.deepEqual(resolved, {
    directoryName: 'Pets (3)',
    overwrite: false,
  });
});

test('resolveCollectionNameCollision overwrites on collision', () => {
  const resolved = resolveCollectionNameCollision(
    'Pets',
    ['Pets'],
    'overwrite',
  );
  assert.deepEqual(resolved, {
    directoryName: 'Pets',
    overwrite: true,
  });
});

test('resolveCollectionNameCollision aborts on collision', () => {
  assert.equal(
    resolveCollectionNameCollision('Pets', ['Pets'], 'abort'),
    undefined,
  );
});

test('resolveCollectionNameCollision rejects unsafe names', () => {
  assert.equal(
    resolveCollectionNameCollision('../escape', [], 'rename'),
    undefined,
  );
  assert.equal(resolveCollectionNameCollision('  ', [], 'rename'), undefined);
});

test('preferredCollectionDirectoryName prefers marker name', () => {
  assert.equal(
    preferredCollectionDirectoryName({
      folderBasename: 'folder-slug',
      markerName: 'Pet Store',
    }),
    'Pet Store',
  );
});

test('preferredCollectionDirectoryName falls back to folder basename', () => {
  assert.equal(
    preferredCollectionDirectoryName({
      folderBasename: 'exported-pets',
      markerName: 'CON',
    }),
    'exported-pets',
  );
  assert.equal(
    preferredCollectionDirectoryName({
      folderBasename: 'exported-pets',
    }),
    'exported-pets',
  );
});

test('looksLikeCollectionRoot detects marker or .api files', () => {
  assert.equal(
    looksLikeCollectionRoot([COLLECTION_MARKER_FILENAME, 'readme.md']),
    true,
  );
  assert.equal(looksLikeCollectionRoot(['get-pets.api']), true);
  assert.equal(looksLikeCollectionRoot(['notes.txt', 'src']), false);
});

test('collectionExportDestinationPath joins parent and name', () => {
  assert.equal(
    collectionExportDestinationPath('/tmp/exports', 'Pets'),
    '/tmp/exports/Pets',
  );
});
