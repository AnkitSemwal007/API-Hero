/**
 * Runs domain unit tests in-process so `c8` can instrument loaded modules.
 * Globs are defined once in `unit-test-globs.mjs`.
 */
import { globSync } from 'node:fs';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { pipeline } from 'node:stream/promises';

import { UNIT_TEST_GLOBS } from './unit-test-globs.mjs';

const files = [
  ...new Set(
    UNIT_TEST_GLOBS.flatMap((pattern) =>
      globSync(pattern, { windowsPathsNoEscape: true }),
    ),
  ),
].sort();

if (files.length === 0) {
  console.error('No unit test files matched. Did you run compile first?');
  process.exitCode = 1;
} else {
  const stream = run({ files });
  let failures = 0;
  stream.on('test:fail', () => {
    failures += 1;
  });
  await pipeline(stream.compose(new spec()), process.stdout);
  if (failures > 0) {
    process.exitCode = 1;
  }
}
