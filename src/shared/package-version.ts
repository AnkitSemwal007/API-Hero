/**
 * Read the product version from package.json (extension / CLI / MCP root).
 * Works from `dist/**` because compiled files sit under `dist/<area>/`.
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

let cached: string | undefined;

/** Returns `package.json` `version`, cached after first read. */
export function readPackageVersion(): string {
  if (cached !== undefined) {
    return cached;
  }
  const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
  const raw = readFileSync(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { readonly version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
    throw new Error('package.json is missing a version field');
  }
  cached = parsed.version.trim();
  return cached;
}
