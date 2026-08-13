/**
 * ZIP codec for `.apihero` packages. User-facing format is `.apihero`, not zip.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

import {
  MANIFEST_ENTRY_NAME,
  MAX_PACKAGE_ENTRIES,
  MAX_PACKAGE_FILE_BYTES,
  MAX_PACKAGE_UNCOMPRESSED_BYTES,
} from './constants';
import { ProjectPackageError, fail } from './errors';
import { isAllowedArchiveEntry, joinPosix, safePathSegments } from './paths';

export type ArchiveEntries = Readonly<Record<string, Uint8Array>>;

export function packArchive(entries: ArchiveEntries): Uint8Array {
  const names = Object.keys(entries);
  if (names.length === 0 || names.length > MAX_PACKAGE_ENTRIES) {
    fail('invalid-package');
  }
  let total = 0;
  const payload: Record<string, Uint8Array> = {};
  for (const name of names) {
    if (!isAllowedArchiveEntry(name)) {
      fail('unsafe-package');
    }
    const bytes = entries[name];
    if (bytes === undefined) {
      fail('invalid-package');
    }
    if (bytes.byteLength > MAX_PACKAGE_FILE_BYTES) {
      fail('invalid-package', 'A packaged file exceeds the size limit.');
    }
    total += bytes.byteLength;
    if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) {
      fail('invalid-package', 'The project is too large to package.');
    }
    payload[name] = bytes;
  }
  if (!(MANIFEST_ENTRY_NAME in payload)) {
    fail('missing-manifest');
  }
  try {
    return zipSync(payload, { level: 6 });
  } catch {
    fail('invalid-package');
  }
}

export function unpackArchive(bytes: Uint8Array): ArchiveEntries {
  if (bytes.byteLength === 0) {
    fail('invalid-package');
  }
  let unzipped: Record<string, Uint8Array>;
  try {
    let counted = 0;
    let declared = 0;
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        counted += 1;
        if (counted > MAX_PACKAGE_ENTRIES) {
          fail('corrupt-package');
        }
        if (file.originalSize > MAX_PACKAGE_FILE_BYTES) {
          fail('corrupt-package');
        }
        declared += file.originalSize;
        if (declared > MAX_PACKAGE_UNCOMPRESSED_BYTES) {
          fail('corrupt-package');
        }
        if (!isAllowedArchiveEntry(file.name)) {
          fail('unsafe-package');
        }
        return true;
      },
    });
  } catch (error: unknown) {
    if (error instanceof ProjectPackageError) {
      throw error;
    }
    fail('corrupt-package');
  }
  const names = Object.keys(unzipped);
  if (names.length === 0 || names.length > MAX_PACKAGE_ENTRIES) {
    fail('corrupt-package');
  }
  let total = 0;
  const entries: Record<string, Uint8Array> = {};
  for (const name of names) {
    if (!isAllowedArchiveEntry(name)) {
      fail('unsafe-package');
    }
    const file = unzipped[name];
    if (file === undefined) {
      fail('corrupt-package');
    }
    if (file.byteLength > MAX_PACKAGE_FILE_BYTES) {
      fail('corrupt-package');
    }
    total += file.byteLength;
    if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) {
      fail('corrupt-package');
    }
    const segments = safePathSegments(name);
    if (segments === undefined) {
      fail('unsafe-package');
    }
    const normalized = joinPosix(segments);
    if (normalized in entries) {
      fail('unsafe-package', 'The package contains duplicate paths.');
    }
    entries[normalized] = file;
  }
  return entries;
}

export function textToBytes(text: string): Uint8Array {
  return strToU8(text);
}

export function bytesToText(bytes: Uint8Array): string {
  return strFromU8(bytes);
}
