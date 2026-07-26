/**
 * Normalizes `@depends-on` tokens before serialize (ADR 0002 Option C).
 * Framework-free — no `vscode` imports.
 *
 * - Does not generate or require `@id`
 * - Reverse-migrates leftover `req_*` tokens to minimal human refs when unique
 * - Ensures selected catalog entries persist as minimal unique human refs
 */

import {
  formatDependRef,
  minimalDependRefFor,
  parseDependRef,
  type DependRefIndexEntry,
} from '../dependencies/depend-ref';
import type { RequestSourceDocument } from '../request-source';

/** Pattern for leftover opaque authored ids from premature Option A work. */
const LEGACY_AUTHORED_ID_PATTERN = /^req_[A-Za-z0-9]+$/u;

export interface DependsOnCatalogEntry {
  readonly name: string;
  /** Folder `relativePath`, or `''` for root. */
  readonly folderPath: string;
  readonly folderLabel?: string;
  readonly requestId?: string;
  /** Legacy `@id` still on disk — used only to reverse-migrate `req_*` tokens. */
  readonly legacyAuthoredId?: string;
}

/**
 * Prepares a request model for serialize: strips identity generation and
 * migrates `req_*` / non-minimal depends-on tokens to human refs.
 */
export function prepareModelForSerialize(
  model: RequestSourceDocument,
  catalog: readonly DependsOnCatalogEntry[],
): RequestSourceDocument {
  const dependsOnRaw = model.dependsOn ?? [];
  const dependsOn =
    catalog.length > 0
      ? migrateDependsOnTokensToHumanRefs(dependsOnRaw, catalog)
      : dependsOnRaw
          .map((token) => token.trim())
          .filter(
            (token) =>
              token.length > 0 && !LEGACY_AUTHORED_ID_PATTERN.test(token),
          );

  // Drop legacy `@id` from the model so serialize never re-emits it.
  const rest = { ...model };
  delete rest.id;
  return {
    ...rest,
    ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: [] }),
  };
}

/**
 * Migrates `@depends-on` tokens to minimal unique human refs.
 * Leftover `req_*` tokens reverse-map via `legacyAuthoredId` when unique.
 */
export function migrateDependsOnTokensToHumanRefs(
  tokens: readonly string[],
  catalog: readonly DependsOnCatalogEntry[],
): readonly string[] {
  const index: DependRefIndexEntry[] = catalog.map((entry, i) => ({
    requestId: entry.requestId ?? `catalog:${i}:${entry.folderPath}/${entry.name}`,
    name: entry.name,
    folderPath: entry.folderPath,
  }));

  const byLegacyId = new Map<string, DependsOnCatalogEntry[]>();
  for (const entry of catalog) {
    const legacy = entry.legacyAuthoredId?.trim();
    if (legacy === undefined || legacy.length === 0) {
      continue;
    }
    const list = byLegacyId.get(legacy) ?? [];
    list.push(entry);
    byLegacyId.set(legacy, list);
  }

  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => {
      if (LEGACY_AUTHORED_ID_PATTERN.test(token)) {
        const matches = byLegacyId.get(token) ?? [];
        if (matches.length !== 1) {
          return token;
        }
        const match = matches[0]!;
        const entry: DependRefIndexEntry = {
          requestId:
            match.requestId ??
            `legacy:${match.folderPath}/${match.name}`,
          name: match.name,
          folderPath: match.folderPath,
        };
        return formatDependRef(minimalDependRefFor(entry, index));
      }

      const ref = parseDependRef(token);
      if (ref === undefined) {
        return token;
      }

      if (ref.kind === 'bare') {
        const matches = catalog.filter((entry) => entry.name === ref.name);
        if (matches.length === 1) {
          const match = matches[0]!;
          const entry: DependRefIndexEntry = {
            requestId:
              match.requestId ?? `name:${match.folderPath}/${match.name}`,
            name: match.name,
            folderPath: match.folderPath,
          };
          return formatDependRef(minimalDependRefFor(entry, index));
        }
        return token;
      }

      const matches = catalog.filter(
        (entry) =>
          entry.folderPath === ref.folderPath && entry.name === ref.name,
      );
      if (matches.length === 1) {
        const match = matches[0]!;
        const entry: DependRefIndexEntry = {
          requestId:
            match.requestId ?? `qual:${match.folderPath}/${match.name}`,
          name: match.name,
          folderPath: match.folderPath,
        };
        return formatDependRef(minimalDependRefFor(entry, index));
      }
      return token;
    });
}

