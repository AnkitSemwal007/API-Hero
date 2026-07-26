/**
 * Parses `@depends-on` directive values. Domain-only — no `vscode` imports.
 *
 * Tokens are human-readable depend refs: bare `@name` or `Folder/Name`
 * (ADR 0002). A leading `@` is stripped (UI / docs notation for `@name`).
 */

import { parseDependRef } from './depend-ref';

export type ParseDependsOnDirectiveResult =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses a comma-separated list of depend refs.
 * Names are trimmed and non-empty; duplicates are preserved in the returned
 * order (validation reports duplicates as a warning) so callers can decide
 * how to surface them.
 *
 * A leading `@` on each entry is stripped when present — it documents the
 * `@name` directive form in UI hints, and is not part of the request name
 * (e.g. `@New Request` → `New Request`).
 */
export function parseDependsOnDirective(
  value: string,
): ParseDependsOnDirectiveResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty: missing @depends-on value' };
  }

  const names = trimmed.split(',').map((entry) => normalizeDependsOnToken(entry));
  if (names.some((name) => name.length === 0)) {
    return { ok: false, reason: 'malformed: empty name in @depends-on list' };
  }

  for (const name of names) {
    if (parseDependRef(name) === undefined) {
      return {
        ok: false,
        reason: `malformed: invalid depend ref "${name}"`,
      };
    }
  }

  return { ok: true, names };
}

/**
 * Trims an entry and strips one leading `@` when present (UI / docs notation
 * for `@name`, not part of the label).
 * Keep in sync with `readDependsOn` in request-editor-html.ts (webview cannot import this).
 */
function normalizeDependsOnToken(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed.startsWith('@')) {
    return trimmed;
  }
  return trimmed.slice(1).trim();
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

