/**
 * Swap README.md for npm pack/publish so the tarball ships the CLI README.
 *
 * GitHub / VS Code Marketplace keep root README.md (product listing).
 * npm consumers should see README.cli.md.
 *
 * Usage:
 *   node ./scripts/npm-readme.mjs apply
 *   node ./scripts/npm-readme.mjs restore
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const marketplaceReadme = join(root, 'README.md');
const cliReadme = join(root, 'README.cli.md');
const backup = join(root, '.README.marketplace.bak');

const action = process.argv[2];

function isCliReadme(text) {
  return /^\s*#\s+API Hero CLI\b/u.test(text);
}

function apply() {
  if (!existsSync(cliReadme)) {
    throw new Error('README.cli.md is missing; cannot prepare npm README.');
  }
  const cliText = readFileSync(cliReadme, 'utf8');
  if (!isCliReadme(cliText)) {
    throw new Error('README.cli.md must start with "# API Hero CLI".');
  }

  const current = existsSync(marketplaceReadme)
    ? readFileSync(marketplaceReadme, 'utf8')
    : '';

  if (existsSync(backup)) {
    if (!existsSync(marketplaceReadme) || isCliReadme(current)) {
      copyFileSync(backup, marketplaceReadme);
    }
    rmSync(backup);
  }

  const marketplace = readFileSync(marketplaceReadme, 'utf8');
  if (isCliReadme(marketplace)) {
    throw new Error(
      'README.md already looks like the CLI README and no marketplace backup exists.',
    );
  }

  copyFileSync(marketplaceReadme, backup);
  copyFileSync(cliReadme, marketplaceReadme);
  console.log('[npm-readme] README.md ← README.cli.md (marketplace copy backed up)');
}

function restore() {
  if (!existsSync(backup)) {
    const current = existsSync(marketplaceReadme)
      ? readFileSync(marketplaceReadme, 'utf8')
      : '';
    if (isCliReadme(current)) {
      throw new Error(
        'README.md is the CLI README but .README.marketplace.bak is missing.',
      );
    }
    console.log('[npm-readme] README.md already restored');
    return;
  }
  copyFileSync(backup, marketplaceReadme);
  rmSync(backup);
  console.log('[npm-readme] README.md restored from marketplace backup');
}

if (action === 'apply') {
  apply();
} else if (action === 'restore') {
  restore();
} else {
  console.error('Usage: node ./scripts/npm-readme.mjs <apply|restore>');
  process.exitCode = 1;
}
