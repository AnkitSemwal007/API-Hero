/**
 * Asserts package.json npm distribution allowlist for the apihero CLI.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const repoRoot = path.join(__dirname, '..', '..');

describe('npm pack manifest (package.json)', () => {
  const pkg = JSON.parse(
    readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as {
    readonly files?: readonly string[];
    readonly engines?: { readonly node?: string; readonly vscode?: string };
    readonly bin?: { readonly apihero?: string };
  };

  test('files includes dist/cli/main.js and bin', () => {
    assert.ok(Array.isArray(pkg.files), 'package.json must declare files');
    assert.ok(pkg.files.includes('dist/cli/main.js'));
    assert.ok(
      pkg.files.includes('bin/') || pkg.files.includes('bin'),
      'files must include bin/',
    );
  });

  test('files does not include src/, docs/, examples/, scripts/, tsconfig, eslint', () => {
    assert.ok(Array.isArray(pkg.files));
    const forbidden = [
      'src/',
      'src',
      'docs/',
      'docs',
      'examples/',
      'examples',
      'scripts/',
      'scripts',
      'tsconfig.json',
      'eslint.config.mjs',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
    ];
    for (const entry of forbidden) {
      assert.equal(
        pkg.files.includes(entry),
        false,
        `files must not include ${entry}`,
      );
    }
  });

  test('engines.node is set', () => {
    assert.ok(pkg.engines?.node, 'engines.node must be set');
    assert.match(pkg.engines.node, />=?\s*18/);
  });

  test('files includes LICENSE and CHANGELOG.md for VSIX/npm roots', () => {
    assert.ok(Array.isArray(pkg.files));
    assert.ok(pkg.files.includes('LICENSE'));
    assert.ok(pkg.files.includes('CHANGELOG.md'));
  });

  test('bin.apihero points to bin/apihero.js', () => {
    assert.ok(
      pkg.bin?.apihero === 'bin/apihero.js' ||
        pkg.bin?.apihero === './bin/apihero.js',
      `unexpected bin.apihero: ${pkg.bin?.apihero}`,
    );
  });

  test('README.cli.md is the npm listing (not the Marketplace README)', () => {
    const cliReadme = readFileSync(path.join(repoRoot, 'README.cli.md'), 'utf8');
    assert.match(cliReadme, /^# API Hero CLI\b/u);
    assert.match(cliReadme, /@ankitsemwal007\/api-hero/);
    assert.match(cliReadme, /apihero run request/);
    assert.match(cliReadme, /apihero run collection/);
    assert.match(cliReadme, /apihero run scenario/);
    assert.match(cliReadme, /--json/);
    assert.doesNotMatch(cliReadme, /npm install -g api-hero(?:\s|$|@)/u);
    assert.doesNotMatch(cliReadme, /apihero[^\n]*--inputs/);
    assert.doesNotMatch(cliReadme, /apihero[^\n]*--var\b/);
  });

  test('Marketplace README.md is Git-first VS Code product copy', () => {
    const marketplace = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    assert.match(marketplace, /^# API Hero\b/u);
    assert.doesNotMatch(marketplace, /^# API Hero CLI\b/u);
    assert.match(
      marketplace,
      /marketplace\.visualstudio\.com\/items\?itemName=ankitsemwal\.api-hero/,
    );
    assert.match(marketplace, /@ankitsemwal007\/api-hero/);
    assert.doesNotMatch(marketplace, /not currently distributed/i);
    assert.doesNotMatch(marketplace, /release\/api-hero-2\.9\./u);
  });
});
