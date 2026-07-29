/**
 * Scenario request-step depend-ref resolution (ADR 0002).
 * Pure domain — fail-closed on ambiguous / unknown tokens.
 */

import {
  parseDependRef,
  resolveDependRef,
  type DependRefIndexEntry,
  type ResolveDependRefResult,
} from '../dependencies';

/** Catalog entry for resolving scenario request steps. */
export interface ScenarioRequestCatalogEntry extends DependRefIndexEntry {
  /** Absolute path/URI of the `.api` file. */
  readonly filePath: string;
  /** UTF-16 offset into the `.api` file for runAtSourceLocation. */
  readonly requestOffset: number;
}

export type ResolveScenarioRequestRefResult =
  | {
      readonly ok: true;
      readonly requestId: string;
      readonly filePath: string;
      readonly requestOffset: number;
      readonly entry: ScenarioRequestCatalogEntry;
    }
  | {
      readonly ok: false;
      readonly code: 'invalid' | 'ambiguous' | 'unknown';
      readonly message: string;
      readonly candidates: readonly ScenarioRequestCatalogEntry[];
    };

function normalizeRequestRefToken(token: string): string {
  const trimmed = token.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
}

/**
 * Resolves a human-readable request ref (`Login`, `Folder/Login`, `./Login`)
 * against a scenario request catalog. Fail-closed.
 */
export function resolveScenarioRequestRef(
  requestRef: string,
  catalog: readonly ScenarioRequestCatalogEntry[],
): ResolveScenarioRequestRefResult {
  const normalized = normalizeRequestRefToken(requestRef);
  const parsed = parseDependRef(normalized);
  if (parsed === undefined) {
    return {
      ok: false,
      code: 'invalid',
      message: `Invalid requestRef token "${requestRef}".`,
      candidates: [],
    };
  }

  const index: readonly DependRefIndexEntry[] = catalog.map((entry) => ({
    requestId: entry.requestId,
    name: entry.name,
    folderPath: entry.folderPath,
  }));
  const resolved: ResolveDependRefResult = resolveDependRef(parsed, index);
  if (!resolved.ok) {
    const candidates = catalog.filter((entry) =>
      resolved.candidates.some((c) => c.requestId === entry.requestId),
    );
    return {
      ok: false,
      code: resolved.code,
      message:
        resolved.code === 'ambiguous'
          ? `Ambiguous requestRef "${requestRef}".`
          : `Unknown requestRef "${requestRef}".`,
      candidates,
    };
  }

  const entry = catalog.find((c) => c.requestId === resolved.requestId);
  if (entry === undefined) {
    return {
      ok: false,
      code: 'unknown',
      message: `Unknown requestRef "${requestRef}".`,
      candidates: [],
    };
  }

  return {
    ok: true,
    requestId: entry.requestId,
    filePath: entry.filePath,
    requestOffset: entry.requestOffset,
    entry,
  };
}
