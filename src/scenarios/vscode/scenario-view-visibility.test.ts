import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  resolveScenariosViewVisibility,
  shouldApplyScenariosVisibleContext,
} from './scenario-view-visibility';

describe('scenarios/vscode/scenario-view-visibility', () => {
  test('hidden by default — empty workspace, no sticky (no successful loads)', () => {
    assert.deepEqual(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: false,
        wasRevealed: false,
      }),
      { visible: false, shouldPersistReveal: false },
    );
  });

  test('corrupt-only / empty loads remain hidden (hasLoadedScenarios:false, no sticky)', () => {
    // Callers pass hasLoadedScenarios only after successful storage.load —
    // corrupt or unreadable files never count as loads.
    assert.deepEqual(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: false,
        wasRevealed: false,
      }),
      { visible: false, shouldPersistReveal: false },
    );
  });

  test('reveals and persists sticky after successful load', () => {
    assert.deepEqual(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: true,
        wasRevealed: false,
      }),
      { visible: true, shouldPersistReveal: true },
    );
  });

  test('sticky after prior reveal with zero loads (delete-last-scenario case)', () => {
    assert.deepEqual(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: false,
        wasRevealed: true,
      }),
      { visible: true, shouldPersistReveal: false },
    );
  });

  test('stays visible when loaded scenarios and prior reveal both true', () => {
    assert.deepEqual(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: true,
        wasRevealed: true,
      }),
      { visible: true, shouldPersistReveal: false },
    );
  });

  test('migration is not a policy input — only hasLoadedScenarios and wasRevealed', () => {
    // resolveScenariosViewVisibility has no migration field. Migration may
    // copy files on disk but visibility follows successful loads or sticky only.
    const keys = Object.keys(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: false,
        wasRevealed: false,
      }),
    ).sort();
    assert.deepEqual(keys, ['shouldPersistReveal', 'visible']);
    assert.equal(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: false,
        wasRevealed: false,
      }).visible,
      false,
    );
  });

  test('focus does not reveal — wasRevealed is the only sticky input; focus is not policy', () => {
    // focusScenarios must not set wasRevealed / must not call reveal. Policy
    // only sees wasRevealed already true (create/load) or false (still hidden).
    assert.equal(
      resolveScenariosViewVisibility({
        hasLoadedScenarios: false,
        wasRevealed: false,
      }).visible,
      false,
    );
  });
});

describe('shouldApplyScenariosVisibleContext', () => {
  test('applies when previous is undefined (first set)', () => {
    assert.equal(shouldApplyScenariosVisibleContext(undefined, true), true);
    assert.equal(shouldApplyScenariosVisibleContext(undefined, false), true);
  });

  test('skips when next equals previous (create→reveal then refreshTree sync)', () => {
    assert.equal(shouldApplyScenariosVisibleContext(true, true), false);
    assert.equal(shouldApplyScenariosVisibleContext(false, false), false);
  });

  test('applies when visibility flips', () => {
    assert.equal(shouldApplyScenariosVisibleContext(false, true), true);
    assert.equal(shouldApplyScenariosVisibleContext(true, false), true);
  });
});
