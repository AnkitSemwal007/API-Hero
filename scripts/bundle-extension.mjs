/**
 * Production bundles for VSIX packaging (esbuild).
 *
 * Dev/test keep `tsc` → multi-file `dist/`. Packaging runs this after `tsc` and
 * then prunes `dist/` so only the three entry bundles remain:
 * - dist/extension.js  (VS Code host; external: vscode)
 * - dist/mcp/server.js (MCP stdio; MCP SDK + zod inlined)
 * - dist/cli/main.js   (headless CLI)
 *
 * Runtime deps (yaml, zod, @modelcontextprotocol/sdk) are bundled so the VSIX
 * does not need to ship node_modules sprawl. vscode stays external.
 *
 * Pass `--no-prune` to overwrite entry points without deleting the rest of
 * `dist/` (useful for local smoke checks after a full tsc compile).
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const prune = !process.argv.includes('--no-prune');

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: false,
  minify: true,
  treeShaking: true,
  logLevel: 'info',
};

/** @type {Array<{ name: string; entry: string; outfile: string; external: string[] }>} */
const targets = [
  {
    name: 'extension',
    entry: join(root, 'src', 'extension.ts'),
    outfile: join(dist, 'extension.js'),
    external: ['vscode'],
  },
  {
    name: 'mcp',
    entry: join(root, 'src', 'mcp', 'server.ts'),
    outfile: join(dist, 'mcp', 'server.js'),
    external: ['vscode'],
  },
  {
    name: 'cli',
    entry: join(root, 'src', 'cli', 'main.ts'),
    outfile: join(dist, 'cli', 'main.js'),
    external: ['vscode'],
  },
];

const started = Date.now();
const results = [];

for (const target of targets) {
  mkdirSync(dirname(target.outfile), { recursive: true });
  await esbuild.build({
    ...shared,
    entryPoints: [target.entry],
    outfile: target.outfile,
    external: target.external,
  });
  const bytes = statSync(target.outfile).size;
  results.push({ name: target.name, outfile: target.outfile, bytes });
  console.log(
    `bundled ${target.name}: ${(bytes / 1024).toFixed(1)} KiB → ${relative(root, target.outfile)}`,
  );
}

if (prune) {
  /** @type {Map<string, Buffer>} */
  const payloads = new Map();
  for (const target of targets) {
    payloads.set(target.outfile, readFileSync(target.outfile));
  }
  rmSync(dist, { recursive: true, force: true });
  for (const target of targets) {
    mkdirSync(dirname(target.outfile), { recursive: true });
    writeFileSync(target.outfile, payloads.get(target.outfile));
  }
  console.log('pruned dist/ to extension + mcp + cli entry bundles only');
}

const report = {
  generatedAt: new Date().toISOString(),
  bundler: 'esbuild',
  minify: true,
  prune,
  external: ['vscode'],
  buildMs: Date.now() - started,
  bundles: results.map((r) => ({
    name: r.name,
    path: relative(root, r.outfile).replace(/\\/g, '/'),
    bytes: r.bytes,
  })),
};

const releaseDir = join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
writeFileSync(join(releaseDir, 'bundle-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`bundle complete in ${report.buildMs}ms`);
