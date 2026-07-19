import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { COMMAND_IDS } from '../constants';
import {
  parseRunRequestCommandArgument,
} from './run-request-argument';

test('accepts only the stable Run Request argument schema', () => {
  const valid = {
    uri: 'file:///requests.api',
    position: { line: 3, character: 2 },
  };
  assert.deepEqual(parseRunRequestCommandArgument(valid), valid);

  for (const invalid of [
    null,
    {},
    { ...valid, extra: true },
    { uri: '', position: valid.position },
    { uri: valid.uri, position: { line: -1, character: 0 } },
    { uri: valid.uri, position: { line: 0, character: 0, extra: true } },
  ]) {
    assert.equal(parseRunRequestCommandArgument(invalid), undefined);
  }
});

test('manifest entry points converge on the one Run Request command', () => {
  const manifest = JSON.parse(
    readFileSync('package.json', 'utf8'),
  ) as {
    contributes: {
      commands: { command: string }[];
      menus: { 'editor/context': { command: string; when: string }[] };
      keybindings: { command: string; when: string }[];
    };
  };
  assert.equal(
    manifest.contributes.commands.filter(
      (command) => command.command === COMMAND_IDS.runRequest,
    ).length,
    1,
  );
  assert.equal(
    manifest.contributes.menus['editor/context'][0]?.command,
    COMMAND_IDS.runRequest,
  );
  assert.match(
    manifest.contributes.menus['editor/context'][0]?.when ?? '',
    /editorLangId == api/,
  );
  assert.equal(
    manifest.contributes.keybindings[0]?.command,
    COMMAND_IDS.runRequest,
  );
  assert.match(
    manifest.contributes.keybindings[0]?.when ?? '',
    /editorTextFocus/,
  );
});
