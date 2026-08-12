/**
 * Maps Postman collection / folder / request variables to environments and
 * document `@variable` / `@sensitive-variable` entries.
 *
 * Preserves `{{VAR}}` references in values — does not resolve them.
 */

import type {
  GeneratedEnvironment,
  GeneratedVariable,
  ImportDiagnostic,
} from '../models';
import {
  isSensitiveName,
  maskImportSecretText,
  placeholderForSensitiveName,
  slugifyIdentifier,
} from '../sanitize';
import { isPlainObject } from './parse';
import { POSTMAN_IMPORT_LIMITS, type PostmanVariableLike } from './types';

export interface MappedVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
}

export interface MapVariablesResult {
  readonly variables: readonly MappedVariable[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * Parses a Postman `variable` array into sanitized name/value pairs.
 */
export function mapPostmanVariables(
  raw: unknown,
  path: string,
): MapVariablesResult {
  const diagnostics: ImportDiagnostic[] = [];
  const variables: MappedVariable[] = [];

  if (raw === undefined || raw === null) {
    return { variables, diagnostics };
  }
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: 'postman-invalid-variables',
      severity: 'warning',
      path,
      message: 'Ignoring malformed variable list (expected an array).',
    });
    return { variables, diagnostics };
  }

  let truncated = false;
  for (const entry of raw) {
    if (variables.length >= POSTMAN_IMPORT_LIMITS.maxVariableCount) {
      truncated = true;
      break;
    }
    if (!isPlainObject(entry)) {
      continue;
    }
    const item = entry as PostmanVariableLike;
    if (item.disabled === true) {
      continue;
    }
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (
      key.length === 0 ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      continue;
    }
    const name = sanitizeVarName(key);
    const sensitive =
      item.type === 'secret' || isSensitiveName(name) || isSensitiveName(key);
    const rawValue =
      typeof item.value === 'string'
        ? item.value
        : item.value === null || item.value === undefined
          ? ''
          : String(item.value);
    const value = sensitive
      ? placeholderForSensitiveName(name)
      : preserveTemplateValue(rawValue);

    variables.push({ name, value, sensitive });
  }

  if (truncated) {
    diagnostics.push({
      code: 'postman-variables-truncated',
      severity: 'warning',
      path,
      message: maskImportSecretText(
        `Only the first ${POSTMAN_IMPORT_LIMITS.maxVariableCount} variables were imported.`,
      ),
    });
  }

  return { variables, diagnostics };
}

/**
 * Builds a single imported environment from collection-level variables.
 * Ensures `baseUrl` exists (placeholder) when not already defined.
 */
export function buildPostmanEnvironment(
  collectionName: string,
  apiSlug: string,
  collectionVariables: readonly MappedVariable[],
  existingIds: ReadonlySet<string>,
): {
  readonly environment: GeneratedEnvironment;
  readonly diagnostics: readonly ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  const id = uniqueEnvId(`imported-${apiSlug}`, existingIds);
  const variables: GeneratedVariable[] = collectionVariables.map((item) => ({
    name: item.name,
    value: item.value,
    sensitive: item.sensitive,
  }));

  const hasBaseUrl = variables.some(
    (item) => item.name.toLowerCase() === 'baseurl',
  );
  if (!hasBaseUrl) {
    variables.unshift({
      name: 'baseUrl',
      value: 'https://api.example.com',
      sensitive: false,
    });
    diagnostics.push({
      code: 'postman-default-base-url',
      severity: 'info',
      message:
        'No baseUrl collection variable found; created environment with placeholder baseUrl https://api.example.com.',
    });
  }

  return {
    environment: {
      id,
      name: `${collectionName} (imported)`,
      activate: true,
      variables,
    },
    diagnostics,
  };
}

/** Leaves `{{...}}` intact; does not resolve Postman dynamic variables. */
export function preserveTemplateValue(value: string): string {
  return value;
}

export function sanitizeVarName(name: string): string {
  const cleaned = name.replace(/[^\w.-]/gu, '_');
  return /^[A-Za-z_]/u.test(cleaned) ? cleaned : `var_${cleaned}`;
}

function uniqueEnvId(
  preferred: string,
  existing: ReadonlySet<string>,
): string {
  if (!existing.has(preferred)) {
    return preferred;
  }
  let index = 2;
  while (existing.has(`${preferred}-${index}`)) {
    index += 1;
  }
  return `${preferred}-${index}`;
}

/** Slug helper re-export for callers building env ids. */
export { slugifyIdentifier };
