/**
 * Verifies an npm pack tarball includes the CLI entry and excludes source/docs.
 *
 * Usage:
 *   node ./scripts/verify-npm-pack-contents.mjs [tarball.tgz]
 *
 * When no tarball path is given, runs `npm pack` into a temp directory
 * (triggers prepack → compile + bundle + CLI README swap; postpack restores).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listTarball(tarballPath) {
  const out = execFileSync('tar', ['-tzf', tarballPath], {
    encoding: 'utf8',
    cwd: root,
  });
  return out
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter((line) => line.length > 0);
}

function assertPackContents(entries) {
  const hasCliMain = entries.some(
    (e) =>
      e === 'package/dist/cli/main.js' || e.endsWith('/dist/cli/main.js'),
  );
  if (!hasCliMain) {
    throw new Error('Pack missing dist/cli/main.js');
  }

  const srcEntries = entries.filter((e) => {
    const rel = e.replace(/^package\//u, '');
    return rel === 'src' || rel.startsWith('src/');
  });
  if (srcEntries.length > 0) {
    throw new Error(`Pack must not include src/ (found ${srcEntries[0]})`);
  }

  const envEntries = entries.filter((e) => {
    const base = path.posix.basename(e);
    return base === '.env' || base.startsWith('.env.');
  });
  if (envEntries.length > 0) {
    throw new Error(`Pack must not include .env (found ${envEntries[0]})`);
  }

  const readmeEntry = entries.find(
    (e) => e === 'package/README.md' || e.endsWith('/README.md'),
  );
  if (readmeEntry === undefined) {
    throw new Error('Pack missing README.md');
  }

  console.log(
    `OK: ${entries.length} entries; dist/cli/main.js present; src/ and .env absent`,
  );
}

function assertPackedReadme(tarballPath) {
  const readme = execFileSync('tar', ['-xOf', tarballPath, 'package/README.md'], {
    encoding: 'utf8',
    cwd: root,
  });
  if (!/^\s*#\s+API Hero CLI\b/u.test(readme)) {
    throw new Error(
      'Packed README.md must be the CLI README (expected heading "# API Hero CLI")',
    );
  }
  if (!readme.includes('@ankitsemwal007/api-hero')) {
    throw new Error('Packed README.md must mention @ankitsemwal007/api-hero');
  }
  if (/npm install -g api-hero(?:\s|$|@)/u.test(readme)) {
    throw new Error('Packed README.md must not advertise unscoped api-hero install');
  }
  console.log('OK: packed README.md is the CLI listing');
}

let tempDir;
let tarballPath = process.argv[2];

try {
  if (tarballPath === undefined) {
    tempDir = mkdtempSync(path.join(tmpdir(), 'apihero-pack-'));
    const packed = execFileSync('npm', ['pack', '--pack-destination', tempDir], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: process.platform === 'win32',
    })
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .at(-1);
    if (packed === undefined || packed.length === 0) {
      throw new Error('npm pack produced no tarball name');
    }
    tarballPath = path.isAbsolute(packed)
      ? packed
      : path.join(tempDir, path.basename(packed));
  }

  assertPackContents(listTarball(tarballPath));
  assertPackedReadme(tarballPath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
} finally {
  const restore = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'npm-readme.mjs'), 'restore'],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (restore.status !== 0 && process.exitCode !== 1) {
    process.exitCode = restore.status ?? 1;
  }
  if (tempDir !== undefined) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
