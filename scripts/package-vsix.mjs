/**
 * Ensures release/ exists and packages the extension VSIX into it.
 * Usage: node ./scripts/package-vsix.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (typeof pkg.name !== 'string' || !pkg.name || typeof pkg.version !== 'string' || !pkg.version) {
  console.error('package.json must define string "name" and "version" fields.');
  process.exit(1);
}

const outDir = join(root, 'release');
const outFile = join(outDir, `${pkg.name}-${pkg.version}.vsix`);

mkdirSync(outDir, { recursive: true });

const vsceJs = join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const vsceCmd = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');

let result;
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
  process.exit(1);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
