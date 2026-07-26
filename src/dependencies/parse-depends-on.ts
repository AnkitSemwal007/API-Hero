/**
 * Parses `@depends-on` directive values. Domain-only — no `vscode` imports.
 */

export type ParseDependsOnDirectiveResult =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses a comma-separated list of request `@name` labels.
 * Names are trimmed and non-empty; duplicates are preserved in the returned
 * order (validation reports duplicates as a warning) so callers can decide
 * how to surface them.
 */
export function parseDependsOnDirective(
  value: string,
): ParseDependsOnDirectiveResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty: missing @depends-on value' };
  }

  const names = trimmed.split(',').map((entry) => entry.trim());
  if (names.some((name) => name.length === 0)) {
    return { ok: false, reason: 'malformed: empty name in @depends-on list' };
  }

  return { ok: true, names };
}

/** Unique names in first-seen order (used by validation for duplicate reporting). */
export function uniqueDependsOnNames(
  names: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      unique.push(name);
    }
  }
  return unique;
}
