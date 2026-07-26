/**
 * Human-readable `@depends-on` refs (ADR 0002 Option C).
 * Domain-only — no `vscode` imports. Never persists discovery ids or `req_*`.
 */

/** Bare `@name` or folder-qualified `relativePath/name`. */
export type DependRef =
  | { readonly kind: 'bare'; readonly name: string }
  | {
      readonly kind: 'qualified';
      readonly folderPath: string;
      readonly name: string;
    };

/** One request identity for resolution / minimal-ref selection. */
export interface DependRefIndexEntry {
  readonly requestId: string;
  readonly name: string;
  /** Folder `relativePath`, or `''` for collection root. */
  readonly folderPath: string;
}

export type ResolveDependRefResult =
  | { readonly ok: true; readonly requestId: string }
  | {
      readonly ok: false;
      readonly code: 'ambiguous' | 'unknown';
      readonly candidates: readonly DependRefIndexEntry[];
    };

/**
 * Parses one `@depends-on` token into a depend ref.
 * Qualified form splits on the last `/` (folder paths may contain `/`).
 * Root-qualified refs use `./Name` (folderPath stored as `''`).
 * Returns undefined when the token is empty after trim.
 */
export function parseDependRef(token: string): DependRef | undefined {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const slash = trimmed.lastIndexOf('/');
  if (slash < 0) {
    return { kind: 'bare', name: trimmed };
  }
  const folderRaw = trimmed.slice(0, slash).trim();
  const name = trimmed.slice(slash + 1).trim();
  if (name.length === 0) {
    return undefined;
  }
  // `./Login` → root-qualified (empty folderPath). Bare `/Login` is invalid.
  if (folderRaw === '.') {
    return { kind: 'qualified', folderPath: '', name };
  }
  if (folderRaw.length === 0) {
    return undefined;
  }
  return { kind: 'qualified', folderPath: folderRaw, name };
}

/**
 * Formats a depend ref for persistence in `@depends-on`.
 * Root-qualified refs (empty folderPath) emit `./Name` so they round-trip.
 */
export function formatDependRef(ref: DependRef): string {
  if (ref.kind === 'bare') {
    return ref.name;
  }
  if (ref.folderPath.length === 0) {
    return `./${ref.name}`;
  }
  return `${ref.folderPath}/${ref.name}`;
}

/** True when `name` contains `/` (illegal — collides with qualification). */
export function nameContainsPathSeparator(name: string): boolean {
  return name.includes('/');
}

/**
 * Returns true when `ref` is the minimal unique spelling for `requestId`
 * given `catalog` (bare when the name is unique, else qualified).
 */
export function isMinimalUniqueRef(
  ref: DependRef,
  requestId: string,
  catalog: readonly DependRefIndexEntry[],
): boolean {
  const entry = catalog.find((candidate) => candidate.requestId === requestId);
  if (entry === undefined) {
    return false;
  }
  const minimal = minimalDependRefFor(entry, catalog);
  return formatDependRef(ref) === formatDependRef(minimal);
}

/**
 * Chooses the shortest unique human ref for `request` in `catalog`:
 * bare `@name` when unique, otherwise `folderPath/name`.
 */
export function minimalDependRefFor(
  request: DependRefIndexEntry,
  catalog: readonly DependRefIndexEntry[],
): DependRef {
  const sameName = catalog.filter((entry) => entry.name === request.name);
  if (sameName.length <= 1) {
    return { kind: 'bare', name: request.name };
  }
  return {
    kind: 'qualified',
    folderPath: request.folderPath,
    name: request.name,
  };
}

/**
 * Resolves a depend ref against an index of plan / collection members.
 * Fail-closed: ambiguous and unknown never guess.
 */
export function resolveDependRef(
  ref: DependRef,
  index: readonly DependRefIndexEntry[],
): ResolveDependRefResult {
  const matches =
    ref.kind === 'bare'
      ? index.filter((entry) => entry.name === ref.name)
      : index.filter(
          (entry) =>
            entry.folderPath === ref.folderPath && entry.name === ref.name,
        );

  if (matches.length === 0) {
    return { ok: false, code: 'unknown', candidates: [] };
  }
  if (matches.length > 1) {
    return { ok: false, code: 'ambiguous', candidates: matches };
  }
  return { ok: true, requestId: matches[0]!.requestId };
}

/** Builds an index from planned / catalog rows. */
export function buildDependRefIndex(
  entries: readonly DependRefIndexEntry[],
): readonly DependRefIndexEntry[] {
  return entries.map((entry) => ({
    requestId: entry.requestId,
    name: entry.name,
    folderPath: entry.folderPath,
  }));
}
