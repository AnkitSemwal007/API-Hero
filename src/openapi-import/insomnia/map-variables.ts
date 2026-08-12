/**
 * Maps Insomnia environment `data` objects to API Hero environments.
 * Rewrites Insomnia Nunjucks `{{ _.var }}` refs to API Hero `{{var}}`;
 * does not resolve template values.
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
import { isPlainObject, safeOwnEntries } from './parse';
import { INSOMNIA_IMPORT_LIMITS } from './types';

/** Insomnia env refs: `{{ _.name }}`, `{{_.name}}`, whitespace variants. */
const INSOMNIA_NUNJUCKS_ENV_REF =
  /\{\{\s*_\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/gu;

export interface RewriteInsomniaEnvRefsResult {
  readonly value: string;
  readonly rewriteCount: number;
}

/**
 * Rewrites Insomnia `{{ _.name }}` / `{{_.name}}` to API Hero `{{name}}`.
 * Leaves other `{{var}}` templates unchanged.
 */
export function rewriteInsomniaEnvRefs(
  value: string,
): RewriteInsomniaEnvRefsResult {
  let rewriteCount = 0;
  const rewritten = value.replace(
    INSOMNIA_NUNJUCKS_ENV_REF,
    (_match, name: string) => {
      rewriteCount += 1;
      return `{{${name}}}`;
    },
  );
  return { value: rewritten, rewriteCount };
}

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
 * Parses an Insomnia environment `data` object into sanitized name/value pairs.
 */
export function mapInsomniaEnvironmentData(
  raw: unknown,
  path: string,
): MapVariablesResult {
  const diagnostics: ImportDiagnostic[] = [];
  const variables: MappedVariable[] = [];

  if (raw === undefined || raw === null) {
    return { variables, diagnostics };
  }
  if (!isPlainObject(raw)) {
    diagnostics.push({
      code: 'insomnia-invalid-variables',
      severity: 'warning',
      path,
      message: 'Ignoring malformed environment data (expected an object).',
    });
    return { variables, diagnostics };
  }

  let truncated = false;
  for (const [key, value] of safeOwnEntries(raw)) {
    if (variables.length >= INSOMNIA_IMPORT_LIMITS.maxVariableCount) {
      truncated = true;
      break;
    }
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0) {
      continue;
    }
    const name = sanitizeVarName(trimmedKey);
    const sensitive = isSensitiveName(name) || isSensitiveName(trimmedKey);
    const rawValue =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
    const mappedValue = sensitive
      ? placeholderForSensitiveName(name)
      : preserveTemplateValue(rawValue);
    variables.push({ name, value: mappedValue, sensitive });
  }

  if (truncated) {
    diagnostics.push({
      code: 'insomnia-variables-truncated',
      severity: 'warning',
      path,
      message: maskImportSecretText(
        `Only the first ${INSOMNIA_IMPORT_LIMITS.maxVariableCount} variables were imported.`,
      ),
    });
  }

  return { variables, diagnostics };
}

/**
 * Builds an imported environment from Insomnia environment data.
 * Ensures `baseUrl` exists (placeholder) when not already defined.
 */
export function buildInsomniaEnvironment(
  environmentName: string,
  apiSlug: string,
  envIndex: number,
  variables: readonly MappedVariable[],
  existingIds: ReadonlySet<string>,
  activate: boolean,
): {
  readonly environment: GeneratedEnvironment;
  readonly diagnostics: readonly ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  const preferred =
    envIndex === 0
      ? `imported-${apiSlug}`
      : `imported-${apiSlug}-${slugifyIdentifier(environmentName, `env-${envIndex + 1}`)}`;
  const id = uniqueEnvId(preferred, existingIds);
  const mapped: GeneratedVariable[] = variables.map((item) => ({
    name: item.name,
    value: item.value,
    sensitive: item.sensitive,
  }));

  const hasBaseUrl = mapped.some(
    (item) => item.name.toLowerCase() === 'baseurl',
  );
  if (!hasBaseUrl) {
    mapped.unshift({
      name: 'baseUrl',
      value: 'https://api.example.com',
      sensitive: false,
    });
    diagnostics.push({
      code: 'insomnia-default-base-url',
      severity: 'info',
      message:
        'No baseUrl environment variable found; created environment with placeholder baseUrl https://api.example.com.',
    });
  }

  return {
    environment: {
      id,
      name: `${environmentName} (imported)`,
      activate,
      variables: mapped,
    },
    diagnostics,
  };
}

/**
 * Rewrites Insomnia Nunjucks env refs to API Hero `{{name}}`; does not resolve.
 */
export function preserveTemplateValue(value: string): string {
  return rewriteInsomniaEnvRefs(value).value;
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

export { slugifyIdentifier };
