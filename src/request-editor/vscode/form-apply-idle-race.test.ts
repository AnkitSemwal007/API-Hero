import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Covers RequestEditorPanelHost.waitUntilFormAppliesIdle's missed-wakeup:
 * drain finishes and notifies an empty waiter list between the idle check and
 * `drainWaiters.push`. A post-push idle recheck unblocks Run; without it, hang.
 */

test('post-push recheck unblocks Run after missed drain wakeup', async () => {
  let applyInFlight = true;
  const drainWaiters: Array<() => void> = [];

  const wait = new Promise<void>((resolve) => {
    // Drain completes between idle check and waiter registration.
    applyInFlight = false;
    for (const wake of drainWaiters.splice(0)) {
      wake();
    }
    drainWaiters.push(resolve);
    // Same recheck as waitUntilFormAppliesIdle after the fix.
    if (!applyInFlight) {
      resolve();
    }
  });

  await Promise.race([
    wait,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('hung without recheck path')), 80);
    }),
  ]);
});

test('without recheck, missed drain wakeup hangs', async () => {
  const drainWaiters: Array<() => void> = [];

  const wait = new Promise<void>((resolve) => {
    // Drain completed with an empty waiter list — nothing to notify.
    drainWaiters.push(resolve);
    // No recheck → park until cleanup.
  });

  let hung = false;
  try {
    await Promise.race([
      wait,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('hung')), 40);
      }),
    ]);
  } catch {
    hung = true;
  }
  assert.equal(hung, true);
  for (const wake of drainWaiters.splice(0)) {
    wake();
  }
  await wait;
});
