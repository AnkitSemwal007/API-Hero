import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { COMMAND_IDS } from '../../constants';

interface ViewTitleEntry {
  readonly command: string;
  readonly when?: string;
  readonly group?: string;
}

test('Collections view/title keeps navigation + overflow only', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: {
      menus: {
        'view/title': ViewTitleEntry[];
      };
    };
  };

  const collectionsEntries = manifest.contributes.menus['view/title'].filter(
    (entry) => entry.when === 'view == apiHero.collections',
  );

  const navigation = collectionsEntries
    .filter((entry) => entry.group?.startsWith('navigation') === true)
    .map((entry) => entry.command);
  assert.deepEqual(navigation, [
    COMMAND_IDS.createRequest,
    COMMAND_IDS.createCollection,
    COMMAND_IDS.filterCollections,
    COMMAND_IDS.refreshCollections,
  ]);

  const overflow = new Set(
    collectionsEntries
      .filter((entry) => entry.group?.startsWith('navigation') !== true)
      .map((entry) => entry.command),
  );
  assert.deepEqual(
    [...overflow].sort(),
    [
      COMMAND_IDS.createFolder,
      COMMAND_IDS.importCollection,
      COMMAND_IDS.importOpenApi,
      COMMAND_IDS.revealActiveRequest,
    ].sort(),
  );

  for (const removed of [
    COMMAND_IDS.manageEnvironments,
    COMMAND_IDS.manageAuthProfiles,
    COMMAND_IDS.openSettings,
    COMMAND_IDS.recentRequests,
    COMMAND_IDS.openOverview,
  ]) {
    assert.equal(
      collectionsEntries.some((entry) => entry.command === removed),
      false,
      `${removed} must not appear on Collections view/title`,
    );
  }
});
