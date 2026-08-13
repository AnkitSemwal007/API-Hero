/**
 * Ensures release/ exists and packages the extension VSIX into it.
 * Usage: node ./scripts/package-vsix.mjs
 *
 * When package.json declares "files", @vscode/vsce refuses to also use
 * .vscodeignore. Temporarily move .vscodeignore aside so vsce packs via
 * the same allowlist as npm (bundled entry points + language assets).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (typeof pkg.name !== 'string' || !pkg.name || typeof pkg.version !== 'string' || !pkg.version) {
  console.error('package.json must define string "name" and "version" fields.');
  process.exit(1);
}

const restoreReadme = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'npm-readme.mjs'), 'restore'],
  { cwd: root, stdio: 'inherit' },
);
if (restoreReadme.status !== 0) {
  console.error(
    'Marketplace README.md is not restored. Refusing to package a VSIX with the npm CLI README.',
  );
  process.exit(restoreReadme.status ?? 1);
}

const outDir = join(root, 'release');
const outFile = join(outDir, `${pkg.name}-${pkg.version}.vsix`);

mkdirSync(outDir, { recursive: true });

const vsceJs = join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const vsceCmd = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');

const vscodeignore = join(root, '.vscodeignore');
const vscodeignoreAside = join(root, '.vscodeignore.__vsix_aside__');
const hasFilesAllowlist =
  Array.isArray(pkg.files) && pkg.files.length > 0;

/** Recover a leftover aside from a previous interrupted pack before moving. */
function restoreAsideIfPresent() {
  if (existsSync(vscodeignoreAside)) {
    if (!existsSync(vscodeignore)) {
      renameSync(vscodeignoreAside, vscodeignore);
    } else {
      // Both exist — prefer canonical .vscodeignore; drop stale aside.
      try {
        renameSync(vscodeignoreAside, join(root, `.vscodeignore.__vsix_stale_${Date.now()}__`));
      } catch {
        /* best-effort */
      }
    }
  }
}

restoreAsideIfPresent();

const movedIgnore =
  hasFilesAllowlist && existsSync(vscodeignore) && !existsSync(vscodeignoreAside);

if (movedIgnore) {
  renameSync(vscodeignore, vscodeignoreAside);
}

let result;
try {
  if (existsSync(vsceJs)) {
    result = spawnSync(process.execPath, [vsceJs, 'package', '--out', outFile], {
      cwd: root,
      stdio: 'inherit',
    });
  } else if (existsSync(vsceCmd)) {
    result = spawnSync(vsceCmd, ['package', '--out', outFile], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  } else {
    console.error('Could not find local @vscode/vsce. Run npm install and retry.');
    process.exitCode = 1;
    result = undefined;
  }
} finally {
  if (existsSync(vscodeignoreAside)) {
    if (!existsSync(vscodeignore)) {
      renameSync(vscodeignoreAside, vscodeignore);
    } else if (movedIgnore) {
      // We created the aside this run but .vscodeignore reappeared — drop aside.
      try {
        renameSync(vscodeignoreAside, join(root, `.vscodeignore.__vsix_stale_${Date.now()}__`));
      } catch {
        /* best-effort */
      }
    }
  }
}

if (result === undefined) {
  process.exit(process.exitCode ?? 1);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
