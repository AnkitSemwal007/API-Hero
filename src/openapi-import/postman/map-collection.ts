/**
 * Walks Postman collection folders/items and produces ImportArtifacts pieces.
 */

import { COLLECTION_MARKER_FILENAME } from '../../collections/constants';
import {
  MARKER_ROOT_ORDER_KEY,
  serializeCollectionMarker,
} from '../../collections/marker';
import type {
  GeneratedApiFile,
  GeneratedAuthProfile,
  GeneratedEnvironment,
  ImportDiagnostic,
} from '../models';
import {
  maskImportSecretText,
  safeJoinRelative,
  sanitizePathSegment,
} from '../sanitize';
import { mapPostmanAuth } from './map-auth';
import {
  collectScriptDiagnostics,
  mapPostmanRequest,
} from './map-request';
import {
  buildPostmanEnvironment,
  mapPostmanVariables,
  type MappedVariable,
} from './map-variables';
import { isPlainObject } from './parse';
import {
  POSTMAN_IMPORT_LIMITS,
  type ParsedPostmanCollection,
  type PostmanItemLike,
} from './types';

export interface MapCollectionContext {
  readonly apiSlug: string;
  readonly existingEnvIds: ReadonlySet<string>;
  readonly existingAuthIds: ReadonlySet<string>;
  readonly cancellation?: { readonly isCancellationRequested: boolean };
}

export interface MapCollectionResult {
  readonly files: readonly GeneratedApiFile[];
  readonly environments: readonly GeneratedEnvironment[];
  readonly authProfiles: readonly GeneratedAuthProfile[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly folderCount: number;
  readonly requestCount: number;
  readonly variableCount: number;
  readonly scriptWarningCount: number;
  readonly unsupportedFeatureCount: number;
  readonly defaultAuthenticationId?: string;
}

/**
 * Maps a parsed Postman collection into files, environments, and auth profiles.
 * Folder and request variables inherit downward onto child request documents.
 */
export function mapPostmanCollection(
  parsed: ParsedPostmanCollection,
  context: MapCollectionContext,
): MapCollectionResult {
  const diagnostics: ImportDiagnostic[] = [];
  const files: GeneratedApiFile[] = [];
  const authProfiles: GeneratedAuthProfile[] = [];
  const pendingAuthIds = new Set<string>();
  const usedPaths = new Set<string>();
  const folderPaths = new Set<string>();
  const folderOrder: Record<string, string[]> = {
    [MARKER_ROOT_ORDER_KEY]: [],
  };
  const requestOrder: Record<string, string[]> = {
    [MARKER_ROOT_ORDER_KEY]: [],
  };

  let requestCount = 0;
  let scriptWarningCount = 0;
  let truncated = false;

  const pushDiagnostic = (item: ImportDiagnostic): void => {
    diagnostics.push(item);
    if (item.code === 'postman-unsupported-script') {
      scriptWarningCount += 1;
    }
  };

  for (const item of collectScriptDiagnostics(
    parsed.root.event,
    '/event',
    'Collection',
  )) {
    pushDiagnostic(item);
  }

  const collectionVars = mapPostmanVariables(
    parsed.root.variable,
    '/variable',
  );
  for (const item of collectionVars.diagnostics) {
    pushDiagnostic(item);
  }

  const envResult = buildPostmanEnvironment(
    parsed.info.name,
    context.apiSlug,
    collectionVars.variables,
    context.existingEnvIds,
  );
  for (const item of envResult.diagnostics) {
    pushDiagnostic(item);
  }
  const environments: GeneratedEnvironment[] = [envResult.environment];

  let inheritedAuthId: string | undefined;
  const collectionAuth = mapPostmanAuth(parsed.root.auth, {
    apiSlug: context.apiSlug,
    labelHint: `${parsed.info.name} collection`,
    path: '/auth',
    existingIds: context.existingAuthIds,
    pendingIds: pendingAuthIds,
  });
  for (const item of collectionAuth.diagnostics) {
    pushDiagnostic(item);
  }
  if (
    collectionAuth.profile !== undefined &&
    collectionAuth.profileId !== undefined
  ) {
    authProfiles.push(collectionAuth.profile);
    pendingAuthIds.add(collectionAuth.profileId);
    inheritedAuthId = collectionAuth.profileId;
  }

  const items = Array.isArray(parsed.root.item) ? parsed.root.item : [];
  walk(items, {
    folderSegments: [],
    parentOrderKey: MARKER_ROOT_ORDER_KEY,
    inheritedAuthId,
    inheritedVars: [],
    pathPrefix: '/item',
    depth: 0,
  });

  const markerName =
    parsed.info.name.trim().length > 0
      ? parsed.info.name.trim()
      : context.apiSlug;

  files.push({
    relativePath: COLLECTION_MARKER_FILENAME,
    content: serializeCollectionMarker({
      name: markerName,
      description: parsed.info.description,
      folderOrder,
      requestOrder,
      ...(inheritedAuthId !== undefined
        ? { defaultAuthenticationId: inheritedAuthId }
        : {}),
    }),
  });

  const unsupportedFeatureCount = diagnostics.filter((item) =>
    item.code.startsWith('postman-unsupported'),
  ).length;

  return {
    files,
    environments,
    authProfiles,
    diagnostics,
    folderCount: folderPaths.size,
    requestCount,
    variableCount: envResult.environment.variables.length,
    scriptWarningCount,
    unsupportedFeatureCount,
    ...(inheritedAuthId !== undefined
      ? { defaultAuthenticationId: inheritedAuthId }
      : {}),
  };

  interface WalkState {
    readonly folderSegments: readonly string[];
    readonly parentOrderKey: string;
    readonly inheritedAuthId: string | undefined;
    readonly inheritedVars: readonly MappedVariable[];
    readonly pathPrefix: string;
    readonly depth: number;
  }

  function walk(walkItems: readonly unknown[], state: WalkState): void {
    if (truncated) {
      return;
    }
    if (context.cancellation?.isCancellationRequested === true) {
      const error = new Error('Import cancelled');
      error.name = 'ImportCancelledError';
      throw error;
    }
    if (state.depth > POSTMAN_IMPORT_LIMITS.maxItemDepth) {
      pushDiagnostic({
        code: 'postman-max-depth',
        severity: 'warning',
        path: state.pathPrefix,
        message: maskImportSecretText(
          `Folder nesting exceeds max depth ${POSTMAN_IMPORT_LIMITS.maxItemDepth}; deeper items were skipped.`,
        ),
      });
      truncated = true;
      return;
    }

    for (const [index, rawItem] of walkItems.entries()) {
      if (truncated) {
        return;
      }
      if (!isPlainObject(rawItem)) {
        pushDiagnostic({
          code: 'postman-invalid-item',
          severity: 'warning',
          path: `${state.pathPrefix}/${index}`,
          message: 'Skipping malformed collection item.',
        });
        continue;
      }

      const item = rawItem as PostmanItemLike;
      const itemPath = `${state.pathPrefix}/${index}`;
      const name =
        typeof item.name === 'string' && item.name.trim().length > 0
          ? item.name.trim()
          : `item-${index + 1}`;

      for (const diag of collectScriptDiagnostics(
        item.event,
        `${itemPath}/event`,
        `"${name}"`,
      )) {
        pushDiagnostic(diag);
      }

      if (Array.isArray(item.item)) {
        if (folderPaths.size >= POSTMAN_IMPORT_LIMITS.maxFolderCount) {
          pushDiagnostic({
            code: 'postman-max-folders',
            severity: 'warning',
            path: itemPath,
            message: maskImportSecretText(
              `Folder count exceeds ${POSTMAN_IMPORT_LIMITS.maxFolderCount}; remaining folders were skipped.`,
            ),
          });
          truncated = true;
          return;
        }

        const segment = uniqueSegment(
          sanitizePathSegment(name, `folder-${index + 1}`),
          state.folderSegments,
          usedPaths,
        );
        const nextSegments = [...state.folderSegments, segment];
        const folderRel =
          safeJoinRelative(...nextSegments) ?? nextSegments.join('/');
        folderPaths.add(folderRel);

        const orderList =
          folderOrder[state.parentOrderKey] ??
          (folderOrder[state.parentOrderKey] = []);
        orderList.push(segment);

        let folderAuthId = state.inheritedAuthId;
        const folderAuth = mapPostmanAuth(item.auth, {
          apiSlug: context.apiSlug,
          labelHint: name,
          path: `${itemPath}/auth`,
          existingIds: context.existingAuthIds,
          pendingIds: pendingAuthIds,
        });
        for (const diag of folderAuth.diagnostics) {
          pushDiagnostic(diag);
        }
        if (
          folderAuth.profile !== undefined &&
          folderAuth.profileId !== undefined
        ) {
          authProfiles.push(folderAuth.profile);
          pendingAuthIds.add(folderAuth.profileId);
          folderAuthId = folderAuth.profileId;
        }

        const folderVars = mapPostmanVariables(
          item.variable,
          `${itemPath}/variable`,
        );
        for (const diag of folderVars.diagnostics) {
          pushDiagnostic(diag);
        }

        walk(item.item, {
          folderSegments: nextSegments,
          parentOrderKey:
            folderRel.length > 0 ? folderRel : MARKER_ROOT_ORDER_KEY,
          inheritedAuthId: folderAuthId,
          inheritedVars: mergeVariables(
            state.inheritedVars,
            folderVars.variables,
          ),
          pathPrefix: `${itemPath}/item`,
          depth: state.depth + 1,
        });
        continue;
      }

      if (item.request !== undefined) {
        if (requestCount >= POSTMAN_IMPORT_LIMITS.maxRequestCount) {
          pushDiagnostic({
            code: 'postman-max-requests',
            severity: 'warning',
            path: itemPath,
            message: maskImportSecretText(
              `Request count exceeds ${POSTMAN_IMPORT_LIMITS.maxRequestCount}; remaining requests were skipped.`,
            ),
          });
          truncated = true;
          return;
        }

        // Prefer item.auth; fall back to request.auth (Postman places either).
        const authSource =
          item.auth !== undefined && item.auth !== null
            ? item.auth
            : isPlainObject(item.request)
              ? (item.request as { auth?: unknown }).auth
              : undefined;

        let requestAuthId = state.inheritedAuthId;
        const requestAuth = mapPostmanAuth(authSource, {
          apiSlug: context.apiSlug,
          labelHint: name,
          path: `${itemPath}/auth`,
          existingIds: context.existingAuthIds,
          pendingIds: pendingAuthIds,
        });
        for (const diag of requestAuth.diagnostics) {
          pushDiagnostic(diag);
        }
        if (
          requestAuth.profile !== undefined &&
          requestAuth.profileId !== undefined
        ) {
          authProfiles.push(requestAuth.profile);
          pendingAuthIds.add(requestAuth.profileId);
          requestAuthId = requestAuth.profileId;
        }

        const requestVars = mapPostmanVariables(
          item.variable,
          `${itemPath}/variable`,
        );
        for (const diag of requestVars.diagnostics) {
          pushDiagnostic(diag);
        }

        const description = readDescription(item.description);
        const mapped = mapPostmanRequest({
          name,
          request: item.request,
          ...(description !== undefined ? { description } : {}),
          ...(requestAuthId !== undefined
            ? { authProfileId: requestAuthId }
            : {}),
          documentVariables: mergeVariables(
            state.inheritedVars,
            requestVars.variables,
          ),
          path: `${itemPath}/request`,
        });
        for (const diag of mapped.diagnostics) {
          pushDiagnostic(diag);
        }

        const fileBase = uniqueFileName(
          mapped.method,
          name,
          state.folderSegments,
          usedPaths,
          index,
        );
        const relativePath =
          state.folderSegments.length > 0
            ? safeJoinRelative(...state.folderSegments, fileBase)
            : safeJoinRelative(fileBase);

        if (relativePath === undefined) {
          pushDiagnostic({
            code: 'unsafe-relative-path',
            severity: 'error',
            path: itemPath,
            message: maskImportSecretText(
              `Refusing unsafe relative path for request "${name}".`,
            ),
          });
          continue;
        }

        files.push({ relativePath, content: mapped.content });
        requestCount += 1;

        const parentKey =
          state.folderSegments.length > 0
            ? (safeJoinRelative(...state.folderSegments) ??
              state.folderSegments.join('/'))
            : MARKER_ROOT_ORDER_KEY;
        const reqList =
          requestOrder[parentKey] ?? (requestOrder[parentKey] = []);
        reqList.push(fileBase);
        continue;
      }

      pushDiagnostic({
        code: 'postman-empty-item',
        severity: 'info',
        path: itemPath,
        message: maskImportSecretText(
          `Item "${name}" has neither nested items nor a request; skipped.`,
        ),
      });
    }
  }
}

function mergeVariables(
  parent: readonly MappedVariable[],
  child: readonly MappedVariable[],
): readonly MappedVariable[] {
  if (parent.length === 0) {
    return child;
  }
  if (child.length === 0) {
    return parent;
  }
  const map = new Map<string, MappedVariable>();
  for (const item of parent) {
    map.set(item.name, item);
  }
  for (const item of child) {
    map.set(item.name, item);
  }
  return [...map.values()];
}

function uniqueSegment(
  base: string,
  folderSegments: readonly string[],
  usedPaths: Set<string>,
): string {
  let candidate = base;
  let index = 2;
  while (true) {
    const rel =
      folderSegments.length > 0
        ? safeJoinRelative(...folderSegments, candidate)
        : candidate;
    const key = `dir:${rel}`;
    if (rel !== undefined && !usedPaths.has(key)) {
      usedPaths.add(key);
      return candidate;
    }
    candidate = `${base}-${index}`;
    index += 1;
  }
}

function uniqueFileName(
  method: string,
  name: string,
  folderSegments: readonly string[],
  usedPaths: Set<string>,
  index: number,
): string {
  const methodSlug = method.toLowerCase();
  const nameSlug = sanitizePathSegment(name, `request-${index + 1}`);
  const base = `${methodSlug}-${nameSlug}.api`;
  let candidate = base;
  let suffix = 2;
  while (true) {
    const rel =
      folderSegments.length > 0
        ? safeJoinRelative(...folderSegments, candidate)
        : safeJoinRelative(candidate);
    const key = `file:${rel}`;
    if (rel !== undefined && !usedPaths.has(key)) {
      usedPaths.add(key);
      return candidate;
    }
    candidate = `${methodSlug}-${nameSlug}-${suffix}.api`;
    suffix += 1;
  }
}

function readDescription(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  if (isPlainObject(raw) && typeof raw.content === 'string') {
    const content = raw.content.trim();
    return content.length > 0 ? content : undefined;
  }
  return undefined;
}
