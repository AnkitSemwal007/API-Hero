/**
 * Validates Postman Collection v2 / v2.1 structure and produces diagnostics.
 * Never executes scripts or resolves remote resources.
 */

import type { ImportDiagnostic } from '../models';
import { maskImportSecretText } from '../sanitize';
import type {
  ParsedPostmanCollection,
  PostmanCollectionLike,
} from './types';

export interface ParsePostmanResult {
  readonly collection?: ParsedPostmanCollection;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * Returns true when `root` looks like a Postman Collection (not OpenAPI/Swagger).
 */
export function isPostmanCollectionRoot(root: unknown): boolean {
  if (!isPlainObject(root)) {
    return false;
  }
  // Never claim OpenAPI / Swagger documents.
  if (typeof root.openapi === 'string' || typeof root.swagger === 'string') {
    return false;
  }

  const schema = readSchemaUrl(root);
  if (schema !== undefined) {
    const lower = schema.toLowerCase();
    if (lower.includes('postman') && lower.includes('collection')) {
      return true;
    }
  }

  const info = root.info;
  const item = root.item;
  if (!isPlainObject(info)) {
    return false;
  }
  if (!Array.isArray(item)) {
    return false;
  }
  // Require a name (or schema) so random `{ info: {}, item: [] }` is weak but
  // still accepted only when schema hints Postman, already handled above.
  const name = info.name;
  return typeof name === 'string' && name.trim().length > 0;
}

/**
 * Parses and lightly validates a Postman collection root.
 */
export function parsePostmanCollection(root: unknown): ParsePostmanResult {
  const diagnostics: ImportDiagnostic[] = [];

  if (!isPlainObject(root)) {
    diagnostics.push({
      code: 'postman-invalid-root',
      severity: 'error',
      message: 'Postman collection root must be a JSON object.',
    });
    return { diagnostics };
  }

  if (typeof root.openapi === 'string' || typeof root.swagger === 'string') {
    diagnostics.push({
      code: 'postman-not-postman',
      severity: 'error',
      message:
        'Document looks like OpenAPI/Swagger, not a Postman Collection. Use Import OpenAPI instead.',
    });
    return { diagnostics };
  }

  if (!isPostmanCollectionRoot(root)) {
    diagnostics.push({
      code: 'postman-invalid-collection',
      severity: 'error',
      message:
        'Not a Postman Collection v2/v2.1 document (expected info + item array, or a Postman collection schema URL).',
    });
    return { diagnostics };
  }

  const infoRaw = root.info;
  if (!isPlainObject(infoRaw)) {
    diagnostics.push({
      code: 'postman-missing-info',
      severity: 'error',
      path: '/info',
      message: 'Postman collection is missing an info object.',
    });
    return { diagnostics };
  }

  const name =
    typeof infoRaw.name === 'string' && infoRaw.name.trim().length > 0
      ? infoRaw.name.trim()
      : 'Imported Collection';
  const description =
    typeof infoRaw.description === 'string'
      ? infoRaw.description
      : typeof infoRaw.description === 'object' &&
          infoRaw.description !== null &&
          typeof (infoRaw.description as { content?: unknown }).content ===
            'string'
        ? String((infoRaw.description as { content: string }).content)
        : '';
  const maskedDescription =
    description.trim().length > 0
      ? maskImportSecretText(description).slice(0, 200)
      : '';
  const version =
    typeof infoRaw.version === 'string'
      ? infoRaw.version.trim()
      : typeof infoRaw.version === 'object' &&
          infoRaw.version !== null &&
          typeof (infoRaw.version as { major?: unknown }).major === 'number'
        ? formatSemverObject(infoRaw.version as Record<string, unknown>)
        : '';
  const schema = readSchemaUrl(root) ?? '';
  const formatVersion = detectFormatVersion(schema);

  if (!Array.isArray(root.item)) {
    diagnostics.push({
      code: 'postman-missing-items',
      severity: 'error',
      path: '/item',
      message: 'Postman collection is missing an item array.',
    });
    return { diagnostics };
  }

  if (schema.length === 0) {
    diagnostics.push({
      code: 'postman-missing-schema',
      severity: 'info',
      path: '/info/schema',
      message:
        'Collection has no info.schema URL; treating as Postman Collection v2/v2.1 based on structure.',
    });
  }

  const collection: ParsedPostmanCollection = {
    info: {
      name: maskImportSecretText(name).slice(0, 200) || 'Imported Collection',
      description: maskedDescription,
      version,
      schema,
    },
    formatVersion,
    root: root as PostmanCollectionLike,
  };

  return { collection, diagnostics };
}

function detectFormatVersion(schema: string): string {
  const lower = schema.toLowerCase();
  if (lower.includes('v2.1') || lower.includes('2.1.0')) {
    return 'postman-collection-v2.1';
  }
  if (lower.includes('v2.0') || lower.includes('2.0.0') || lower.includes('/v2/')) {
    return 'postman-collection-v2.0';
  }
  if (lower.includes('postman') && lower.includes('collection')) {
    return 'postman-collection-v2';
  }
  return 'postman-collection-v2.1';
}

function readSchemaUrl(root: Record<string, unknown>): string | undefined {
  const info = root.info;
  if (!isPlainObject(info)) {
    return undefined;
  }
  return typeof info.schema === 'string' ? info.schema.trim() : undefined;
}

function formatSemverObject(version: Record<string, unknown>): string {
  const major = typeof version.major === 'number' ? version.major : 0;
  const minor = typeof version.minor === 'number' ? version.minor : 0;
  const patch = typeof version.patch === 'number' ? version.patch : 0;
  return `${major}.${minor}.${patch}`;
}

/** True for non-null plain objects (not arrays). Avoids prototype surprises. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Safe own-property read that ignores `__proto__`, `prototype`, and `constructor`.
 */
export function safeOwnString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  if (
    key === '__proto__' ||
    key === 'prototype' ||
    key === 'constructor'
  ) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Iterates own enumerable string keys, skipping dangerous prototype keys.
 */
export function safeOwnEntries(
  record: Record<string, unknown>,
): readonly (readonly [string, unknown])[] {
  const result: (readonly [string, unknown])[] = [];
  for (const key of Object.keys(record)) {
    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      continue;
    }
    result.push([key, record[key]]);
  }
  return result;
}
