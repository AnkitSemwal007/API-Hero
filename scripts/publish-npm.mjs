/**
 * Publish the dual-purpose package to npm under a scoped name.
 *
 * Marketplace / vsce require an unscoped package.json `name` (`api-hero` →
 * extension id `ankitsemwal.api-hero`). npm rejects unscoped `api-hero` as
 * too similar to existing `apihero`, so this script temporarily rewrites
 * `name` to `@ankitsemwal007/api-hero`, publishes with public access, then
 * restores package.json.
 *
 * Usage: node ./scripts/publish-npm.mjs [--dry-run] [--otp=XXXXXX]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const NPM_SCOPE_NAME = '@ankitsemwal007/api-hero';
const MARKETPLACE_NAME = 'api-hero';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const otpArg = args.find((a) => a.startsWith('--otp='));

const original = readFileSync(pkgPath, 'utf8');
/** @type {Record<string, unknown>} */
const pkg = JSON.parse(original);

if (pkg.name !== MARKETPLACE_NAME) {
  console.error(
    `Expected package.json name "${MARKETPLACE_NAME}" for Marketplace/vsce; found ${JSON.stringify(pkg.name)}.`,
  );
  process.exit(1);
}

pkg.name = NPM_SCOPE_NAME;
pkg.publishConfig = {
  ...(typeof pkg.publishConfig === 'object' && pkg.publishConfig !== null
    ? pkg.publishConfig
    : {}),
  access: 'public',
};

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`[publish-npm] package.json name: ${MARKETPLACE_NAME} → ${NPM_SCOPE_NAME}`);

const npmArgs = ['publish', '--access', 'public'];
if (dryRun) {
  npmArgs.push('--dry-run');
}
if (otpArg !== undefined) {
  npmArgs.push(otpArg);
}

let status = 1;
try {
  const result = spawnSync('npm', npmArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error.message);
    status = 1;
  } else {
    status = result.status ?? 1;
  }
} finally {
  writeFileSync(pkgPath, original, 'utf8');
  console.log(`[publish-npm] package.json restored (name: ${MARKETPLACE_NAME})`);
}

process.exit(status);
