/**
 * Validates Insomnia export v3/v4 resource-based JSON and produces diagnostics.
 * Never executes scripts or resolves remote resources.
 */

import type { ImportDiagnostic } from '../models';
import { maskImportSecretText } from '../sanitize';
import {
  INSOMNIA_IMPORT_LIMITS,
  INSOMNIA_SUPPORTED_EXPORT_FORMATS,
  type InsomniaExportLike,
  type InsomniaResourceLike,
  type ParsedInsomniaExport,
} from './types';

export interface ParseInsomniaResult {
  readonly export?: ParsedInsomniaExport;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * Returns true when `root` looks like an Insomnia resource-based export
 * (not OpenAPI/Swagger/Postman).
 */
export function isInsomniaExportRoot(root: unknown): boolean {
  if (!isPlainObject(root)) {
    return false;
  }
  if (typeof root.openapi === 'string' || typeof root.swagger === 'string') {
    return false;
  }
  // Postman collection shape
  if (
    isPlainObject(root.info) &&
    Array.isArray(root.item) &&
    (typeof (root.info as { schema?: unknown }).schema === 'string' ||
      typeof (root.info as { name?: unknown }).name === 'string')
  ) {
    const schema = (root.info as { schema?: unknown }).schema;
    if (
      typeof schema === 'string' &&
      schema.toLowerCase().includes('postman')
    ) {
      return false;
    }
    // Weak Postman shape without Insomnia markers
    if (!Array.isArray(root.resources) && root.__export_format === undefined) {
      return false;
    }
  }

  if (!Array.isArray(root.resources)) {
    return false;
  }

  const exportFormat = readExportFormat(root);
  if (exportFormat !== undefined) {
    return true;
  }

  if (root._type === 'export') {
    return true;
  }

  // Resources array with at least one typed Insomnia resource
  return root.resources.some(
    (item) =>
      isPlainObject(item) &&
      typeof item._type === 'string' &&
      typeof item._id === 'string',
  );
}

/**
 * Parses and lightly validates an Insomnia export root.
 */
export function parseInsomniaExport(root: unknown): ParseInsomniaResult {
  const diagnostics: ImportDiagnostic[] = [];

  if (!isPlainObject(root)) {
    diagnostics.push({
      code: 'insomnia-invalid-root',
      severity: 'error',
      message: 'Insomnia export root must be a JSON object.',
    });
    return { diagnostics };
  }

  if (typeof root.openapi === 'string' || typeof root.swagger === 'string') {
    diagnostics.push({
      code: 'insomnia-not-insomnia',
      severity: 'error',
      message:
        'Document looks like OpenAPI/Swagger, not an Insomnia export. Use Import OpenAPI instead.',
    });
    return { diagnostics };
  }

  if (
    isPlainObject(root.info) &&
    Array.isArray(root.item) &&
    !Array.isArray(root.resources)
  ) {
    diagnostics.push({
      code: 'insomnia-not-insomnia',
      severity: 'error',
      message:
        'Document looks like a Postman Collection, not an Insomnia export. Use Import Postman instead.',
    });
    return { diagnostics };
  }

  if (!isInsomniaExportRoot(root)) {
    diagnostics.push({
      code: 'insomnia-invalid-export',
      severity: 'error',
      message:
        'Not an Insomnia export (expected resource-based export with __export_format 3/4 or _type "export" and a resources array). Insomnia Document / YAML v5 and HAR are not supported.',
    });
    return { diagnostics };
  }

  const exportFormat = readExportFormat(root);
  if (exportFormat !== undefined) {
    const supported = (INSOMNIA_SUPPORTED_EXPORT_FORMATS as readonly number[]).includes(
      exportFormat,
    );
    if (!supported) {
      diagnostics.push({
        code: 'insomnia-unsupported-export-format',
        severity: 'error',
        path: '/__export_format',
        message: maskImportSecretText(
          `Insomnia __export_format ${exportFormat} is not supported (supported: ${INSOMNIA_SUPPORTED_EXPORT_FORMATS.join(', ')}).`,
        ),
      });
      return { diagnostics };
    }
  } else {
    diagnostics.push({
      code: 'insomnia-missing-export-format',
      severity: 'info',
      path: '/__export_format',
      message:
        'Export has no __export_format; treating as Insomnia resource-based export v3/v4 based on structure.',
    });
  }

  if (!Array.isArray(root.resources)) {
    diagnostics.push({
      code: 'insomnia-missing-resources',
      severity: 'error',
      path: '/resources',
      message: 'Insomnia export is missing a resources array.',
    });
    return { diagnostics };
  }

  if (root.resources.length > INSOMNIA_IMPORT_LIMITS.maxResourceCount) {
    diagnostics.push({
      code: 'insomnia-max-resources',
      severity: 'error',
      path: '/resources',
      message: maskImportSecretText(
        `Insomnia export exceeds max resource count ${INSOMNIA_IMPORT_LIMITS.maxResourceCount}.`,
      ),
    });
    return { diagnostics };
  }

  const resources: InsomniaResourceLike[] = [];
  for (const [index, entry] of root.resources.entries()) {
    if (!isPlainObject(entry)) {
      diagnostics.push({
        code: 'insomnia-invalid-resource',
        severity: 'warning',
        path: `/resources/${index}`,
        message: 'Skipping malformed resource entry.',
      });
      continue;
    }
    // Prototype pollution guard — drop dangerous keys by reconstructing.
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(entry)) {
      if (
        key === '__proto__' ||
        key === 'prototype' ||
        key === 'constructor'
      ) {
        continue;
      }
      safe[key] = entry[key];
    }
    resources.push(safe as InsomniaResourceLike);
  }

  const workspaces = resources.filter(
    (item) => readResourceType(item) === 'workspace',
  );
  const workspace =
    workspaces.find((item) => typeof item._id === 'string') ?? workspaces[0];
  const workspaceId =
    workspace !== undefined && typeof workspace._id === 'string'
      ? workspace._id
      : undefined;

  const nameRaw =
    workspace !== undefined &&
    typeof workspace.name === 'string' &&
    workspace.name.trim().length > 0
      ? workspace.name.trim()
      : 'Imported Insomnia Export';
  const descriptionRaw =
    workspace !== undefined && typeof workspace.description === 'string'
      ? workspace.description
      : '';

  const formatVersion =
    exportFormat === 3
      ? 'insomnia-export-v3'
      : exportFormat === 4
        ? 'insomnia-export-v4'
        : 'insomnia-export';

  const parsed: ParsedInsomniaExport = {
    info: {
      name: maskImportSecretText(nameRaw).slice(0, 200) || 'Imported Insomnia Export',
      description:
        descriptionRaw.trim().length > 0
          ? maskImportSecretText(descriptionRaw).slice(0, 200)
          : '',
      exportFormat: exportFormat ?? 4,
    },
    formatVersion,
    resources,
    workspaceId,
  };

  return { export: parsed, diagnostics };
}

function readExportFormat(root: InsomniaExportLike): number | undefined {
  const raw = root.__export_format;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function readResourceType(resource: InsomniaResourceLike): string {
  return typeof resource._type === 'string'
    ? resource._type.trim().toLowerCase()
    : '';
}

/** True for non-null plain objects (not arrays). */
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
