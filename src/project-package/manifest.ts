import { createHash } from 'node:crypto';

import {
  PROJECT_PACKAGE_FORMAT,
  PROJECT_PACKAGE_FORMAT_VERSION,
  PROJECT_PACKAGE_KIND,
  PROJECT_ROOT_PREFIX,
} from './constants';
import { fail } from './errors';
import type { ProjectPackageManifest } from './models';
import { isValidCollectionsDirectoryName, safePathSegments } from './paths';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildManifest(input: {
  readonly projectName: string;
  readonly createdAt: string;
  readonly apiHeroVersion: string;
  readonly collectionsDirectory: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}): ProjectPackageManifest {
  return {
    format: PROJECT_PACKAGE_FORMAT,
    kind: PROJECT_PACKAGE_KIND,
    formatVersion: PROJECT_PACKAGE_FORMAT_VERSION,
    projectName: input.projectName,
    createdAt: input.createdAt,
    apiHeroVersion: input.apiHeroVersion,
    collectionsDirectory: input.collectionsDirectory,
    files: [...input.files],
  };
}

export function parseManifest(text: string): ProjectPackageManifest {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail('malformed-manifest');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('malformed-manifest');
  }
  const record = value as Record<string, unknown>;
  if (record.format !== PROJECT_PACKAGE_FORMAT) {
    fail('invalid-package', 'The format identifier is not apihero-project.');
  }
  if (record.kind !== PROJECT_PACKAGE_KIND) {
    fail('unsupported-content');
  }
  if (!('formatVersion' in record)) {
    fail('malformed-manifest');
  }
  if (
    typeof record.formatVersion !== 'number' ||
    !Number.isInteger(record.formatVersion)
  ) {
    fail('malformed-manifest');
  }
  if (record.formatVersion !== PROJECT_PACKAGE_FORMAT_VERSION) {
    fail('unsupported-version');
  }
  if (typeof record.projectName !== 'string' || record.projectName.trim().length === 0) {
    fail('malformed-manifest');
  }
  if (typeof record.createdAt !== 'string' || record.createdAt.trim().length === 0) {
    fail('malformed-manifest');
  }
  if (typeof record.apiHeroVersion !== 'string') {
    fail('malformed-manifest');
  }
  if (
    typeof record.collectionsDirectory !== 'string' ||
    !isValidCollectionsDirectoryName(record.collectionsDirectory)
  ) {
    fail('malformed-manifest');
  }
  if (!Array.isArray(record.files)) {
    fail('malformed-manifest');
  }
  const files: { path: string; sha256: string }[] = [];
  const seen = new Set<string>();
  for (const item of record.files) {
    if (typeof item !== 'object' || item === null) {
      fail('malformed-manifest');
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      fail('malformed-manifest');
    }
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      fail('malformed-manifest');
    }
    const segments = safePathSegments(entry.path);
    if (segments === undefined || segments[0] !== PROJECT_ROOT_PREFIX) {
      fail('unsafe-package');
    }
    const normalized = segments.join('/');
    if (seen.has(normalized)) {
      fail('malformed-manifest');
    }
    seen.add(normalized);
    files.push({ path: normalized, sha256: entry.sha256 });
  }
  return {
    format: PROJECT_PACKAGE_FORMAT,
    kind: PROJECT_PACKAGE_KIND,
    formatVersion: PROJECT_PACKAGE_FORMAT_VERSION,
    projectName: record.projectName.trim(),
    createdAt: record.createdAt.trim(),
    apiHeroVersion: record.apiHeroVersion.trim(),
    collectionsDirectory: record.collectionsDirectory.trim(),
    files,
  };
}
