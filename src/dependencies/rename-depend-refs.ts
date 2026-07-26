/**
 * Rewrites `@depends-on` tokens when a request `@name` changes (rename cascade).
 * Domain-only — no `vscode` imports.
 */

import {
  formatDependRef,
  minimalDependRefFor,
  parseDependRef,
  type DependRef,
  type DependRefIndexEntry,
} from './depend-ref';

export interface RenameDependRefsIdentity {
  readonly requestId: string;
  readonly oldName: string;
  readonly oldFolderPath: string;
  readonly newName: string;
}

export interface DependOnDocumentSnapshot {
  /** Absolute path of the `.api` file. */
  readonly filePath: string;
  /** Discovery request id of the document's request, when known. */
  readonly requestId?: string;
  readonly dependsOn: readonly string[];
}

export interface DependOnRewrite {
  readonly filePath: string;
  readonly requestId?: string;
  readonly dependsOn: readonly string[];
}

/**
 * Returns documents whose `@depends-on` lists change when `identity` is renamed.
 * Skips the renamed request itself. Uses pre-rename catalog to decide which
 * tokens targeted the request; post-rename catalog to pick minimal unique refs.
 */
export function planDependRefRewrites(options: {
  readonly identity: RenameDependRefsIdentity;
  readonly catalogBefore: readonly DependRefIndexEntry[];
  readonly catalogAfter: readonly DependRefIndexEntry[];
  readonly documents: readonly DependOnDocumentSnapshot[];
}): readonly DependOnRewrite[] {
  const { identity, catalogBefore, catalogAfter, documents } = options;
  const out: DependOnRewrite[] = [];

  for (const document of documents) {
    if (
      document.requestId !== undefined &&
      document.requestId === identity.requestId
    ) {
      continue;
    }
    const next = rewriteDependsOnTokens(document.dependsOn, {
      identity,
      catalogBefore,
      catalogAfter,
    });
    if (tokensEqual(document.dependsOn, next)) {
      continue;
    }
    out.push({
      filePath: document.filePath,
      ...(document.requestId !== undefined
        ? { requestId: document.requestId }
        : {}),
      dependsOn: next,
    });
  }

  return out;
}

/**
 * Rewrites one `@depends-on` token list for a rename.
 * Tokens that uniquely targeted the old identity are rewritten to the
 * minimal unique ref for the renamed request; others are left unchanged.
 */
export function rewriteDependsOnTokens(
  tokens: readonly string[],
  options: {
    readonly identity: RenameDependRefsIdentity;
    readonly catalogBefore: readonly DependRefIndexEntry[];
    readonly catalogAfter: readonly DependRefIndexEntry[];
  },
): readonly string[] {
  const { identity, catalogBefore, catalogAfter } = options;
  const renamedAfter = catalogAfter.find(
    (entry) => entry.requestId === identity.requestId,
  );
  if (renamedAfter === undefined) {
    return tokens;
  }
  const replacement = formatDependRef(
    minimalDependRefFor(renamedAfter, catalogAfter),
  );

  return tokens.map((token) => {
    if (
      !tokenTargetsRenamedRequest(token, identity, catalogBefore)
    ) {
      return token;
    }
    return replacement;
  });
}

/**
 * True when `token` uniquely identified the renamed request in the
 * pre-rename catalog (bare unique name, or exact qualified folder/name).
 */
export function tokenTargetsRenamedRequest(
  token: string,
  identity: RenameDependRefsIdentity,
  catalogBefore: readonly DependRefIndexEntry[],
): boolean {
  const ref = parseDependRef(token);
  if (ref === undefined) {
    return false;
  }
  if (ref.kind === 'bare') {
    if (ref.name !== identity.oldName) {
      return false;
    }
    const matches = catalogBefore.filter(
      (entry) => entry.name === identity.oldName,
    );
    return (
      matches.length === 1 && matches[0]!.requestId === identity.requestId
    );
  }
  return (
    ref.folderPath === identity.oldFolderPath &&
    ref.name === identity.oldName
  );
}

/** Formats the post-rename identity as a depend ref (for tests / callers). */
export function dependRefAfterRename(
  identity: RenameDependRefsIdentity,
  catalogAfter: readonly DependRefIndexEntry[],
): DependRef {
  const entry = catalogAfter.find(
    (candidate) => candidate.requestId === identity.requestId,
  );
  if (entry === undefined) {
    return identity.oldFolderPath.length === 0
      ? { kind: 'bare', name: identity.newName }
      : {
          kind: 'qualified',
          folderPath: identity.oldFolderPath,
          name: identity.newName,
        };
  }
  return minimalDependRefFor(entry, catalogAfter);
}

function tokensEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((token, index) => token === right[index]);
}
