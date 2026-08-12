/**
 * Read the product version from package.json (extension / CLI / MCP root).
 *
 * Supports both layouts:
 * - tsc / area bundles: `dist/shared/*.js`, `dist/mcp/*.js`, `dist/cli/*.js`
 *   → package.json is two levels up
 * - extension host bundle: `dist/extension.js`
 *   → package.json is one level up
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

let cached: string | undefined;

function resolvePackageJsonPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Could not locate package.json relative to the running bundle (checked dist/ and dist/<area>/)',
  );
}

/** Returns `package.json` `version`, cached after first read. */
export function readPackageVersion(): string {
  if (cached !== undefined) {
    return cached;
  }
  const raw = readFileSync(resolvePackageJsonPath(), 'utf8');
  const parsed = JSON.parse(raw) as { readonly version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
    throw new Error('package.json is missing a version field');
  }
  cached = parsed.version.trim();
  return cached;
}
