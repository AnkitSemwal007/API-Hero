import type { VariableWriteTargetScope } from '../extraction';
import { stripBodyPrefix } from '../extraction';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

const SENSITIVE_HINT =
  /(token|secret|password|api[_-]?key|authorization)/iu;

/** Scopes offered by Create Variable From Response (Global forbidden). */
export const CREATE_VARIABLE_SCOPES = [
  'environment',
  'document',
  'collection',
  'workspace',
  'run',
] as const satisfies readonly VariableWriteTargetScope[];

export type CreateVariableScope = (typeof CREATE_VARIABLE_SCOPES)[number];

/** Default scope per ADR §12 — Environment. */
export const CREATE_VARIABLE_DEFAULT_SCOPE: CreateVariableScope = 'environment';

/**
 * Sanitizes a JSON leaf key into a legal variable name.
 * Falls back to `extracted` when the key cannot yield a valid name.
 */
export function sanitizeVariableName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'extracted';
  }
  let name = trimmed.replace(/[^A-Za-z0-9_.-]/gu, '_');
  if (/^[0-9]/u.test(name)) {
    name = `v_${name}`;
  }
  if (!VARIABLE_NAME.test(name)) {
    return 'extracted';
  }
  return name;
}

/** ADR §12 sensitive heuristic for name/path. */
export function looksSensitiveForExtract(
  name: string,
  path: string,
): boolean {
  return SENSITIVE_HINT.test(name) || SENSITIVE_HINT.test(path);
}

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME.test(name);
}

export function isCreateVariableScope(
  value: string,
): value is CreateVariableScope {
  return (CREATE_VARIABLE_SCOPES as readonly string[]).includes(value);
}

/** Leaf key from a body-relative JSON path (`body.access_token` → `access_token`). */
export function leafKeyFromJsonPath(path: string): string {
  const withoutBody = stripBodyPrefix(path);
  if (withoutBody.length === 0) {
    return 'body';
  }
  const bracket = withoutBody.lastIndexOf('[');
  const dot = withoutBody.lastIndexOf('.');
  if (bracket > dot) {
    const inner = /^\[(\d+)\]$/u.exec(withoutBody.slice(bracket));
    return inner?.[1] ?? 'item';
  }
  if (dot >= 0) {
    return withoutBody.slice(dot + 1) || 'extracted';
  }
  return withoutBody;
}
