import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMMAND_IDS,
  LEGACY_COMMAND_IDS,
  toLegacyCommandId,
} from '../constants';

test('every COMMAND_IDS value has a matching LEGACY_COMMAND_IDS counterpart', () => {
  const canonicalKeys = Object.keys(COMMAND_IDS).sort();
  const legacyKeys = Object.keys(LEGACY_COMMAND_IDS).sort();
  assert.deepEqual(legacyKeys, canonicalKeys);

  for (const key of canonicalKeys as (keyof typeof COMMAND_IDS)[]) {
    const canonical = COMMAND_IDS[key];
    const legacy = LEGACY_COMMAND_IDS[key];
    assert.equal(
      legacy,
      toLegacyCommandId(canonical),
      `legacy mismatch for ${key}`,
    );
    assert.match(canonical, /^apiHero\./);
    assert.match(legacy, /^apiRunner\./);
    assert.equal(
      canonical.slice('apiHero.'.length),
      legacy.slice('apiRunner.'.length),
    );
  }
});

test('toLegacyCommandId only maps apiHero.* ids', () => {
  assert.equal(toLegacyCommandId('apiHero.runRequest'), 'apiRunner.runRequest');
  assert.equal(toLegacyCommandId('apiRunner.runRequest'), undefined);
  assert.equal(toLegacyCommandId('other.command'), undefined);
});
