/**
 * Walks Insomnia export resources (folders/requests/environments) into artifacts.
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
import { mapInsomniaAuth } from './map-auth';
import { mapInsomniaRequest } from './map-request';
import {
  buildInsomniaEnvironment,
  mapInsomniaEnvironmentData,
} from './map-variables';
import { readResourceType } from './parse';
import {
  INSOMNIA_IMPORT_LIMITS,
  type InsomniaResourceLike,
  type ParsedInsomniaExport,
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

const UNSUPPORTED_RESOURCE_TYPES = new Set([
  'cookie_jar',
  'api_spec',
  'proto_file',
  'grpc_request',
  'websocket_request',
  'socketio_request',
  'mcp_request',
  'unit_test',
  'unit_test_suite',
  'mock',
]);

/**
 * Maps a parsed Insomnia export into files, environments, and auth profiles.
 */
export function mapInsomniaCollection(
  parsed: ParsedInsomniaExport,
  context: MapCollectionContext,
): MapCollectionResult {
  const diagnostics: ImportDiagnostic[] = [];
  const files: GeneratedApiFile[] = [];
  const authProfiles: GeneratedAuthProfile[] = [];
  const environments: GeneratedEnvironment[] = [];
  const pendingAuthIds = new Set<string>();
  const usedEnvIds = new Set(context.existingEnvIds);
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
  let variableCount = 0;
  let truncated = false;

  const pushDiagnostic = (item: ImportDiagnostic): void => {
    diagnostics.push(item);
    if (item.code === 'insomnia-unsupported-script') {
      scriptWarningCount += 1;
    }
  };

  const byParent = new Map<string | null, InsomniaResourceLike[]>();
  const idToResource = new Map<string, InsomniaResourceLike>();

  for (const resource of parsed.resources) {
    const type = readResourceType(resource);
    if (UNSUPPORTED_RESOURCE_TYPES.has(type)) {
      pushDiagnostic({
        code: 'insomnia-unsupported-resource',
        severity: 'warning',
        path: typeof resource._id === 'string' ? `/${resource._id}` : undefined,
        message: maskImportSecretText(
          `Insomnia resource type "${type}" is not imported.`,
        ),
      });
      continue;
    }
    if (type === 'unknown' || type.length === 0) {
      if (typeof resource._type === 'string' && resource._type.trim().length > 0) {
        pushDiagnostic({
          code: 'insomnia-unsupported-resource',
          severity: 'warning',
          message: maskImportSecretText(
            `Unknown Insomnia resource type "${resource._type}" was not imported.`,
          ),
        });
      }
      continue;
    }

    const id = typeof resource._id === 'string' ? resource._id : undefined;
    if (id !== undefined) {
      idToResource.set(id, resource);
    }

    const parentRaw = resource.parentId;
    const parentId =
      parentRaw === null || parentRaw === undefined
        ? null
        : typeof parentRaw === 'string'
          ? parentRaw
          : null;
    const list = byParent.get(parentId) ?? [];
    list.push(resource);
    byParent.set(parentId, list);
  }

  // Sort siblings by metaSortKey when present
  for (const [, list] of byParent) {
    list.sort((a, b) => {
      const ka = typeof a.metaSortKey === 'number' ? a.metaSortKey : 0;
      const kb = typeof b.metaSortKey === 'number' ? b.metaSortKey : 0;
      return ka - kb;
    });
  }

  // Environments (workspace-level and nested)
  const envResources = parsed.resources.filter(
    (item) => readResourceType(item) === 'environment',
  );
  const envIdSet = new Set(
    envResources
      .map((item) => (typeof item._id === 'string' ? item._id : undefined))
      .filter((id): id is string => id !== undefined),
  );
  const hasEnvParentHierarchy = envResources.some((item) => {
    const parent =
      typeof item.parentId === 'string' ? item.parentId : undefined;
    return parent !== undefined && envIdSet.has(parent);
  });
  if (hasEnvParentHierarchy) {
    pushDiagnostic({
      code: 'insomnia-environment-parent-flattened',
      severity: 'warning',
      message:
        'Insomnia environment parentId hierarchy was not merged; each environment was imported independently. Nested/private environments may be missing base values.',
    });
  }

  let envIndex = 0;
  for (const env of envResources) {
    throwIfCancelled(context);
    const envName =
      typeof env.name === 'string' && env.name.trim().length > 0
        ? env.name.trim()
        : `Environment ${envIndex + 1}`;
    const mapped = mapInsomniaEnvironmentData(
      env.data,
      typeof env._id === 'string' ? `/${env._id}/data` : '/environment/data',
    );
    for (const diag of mapped.diagnostics) {
      pushDiagnostic(diag);
    }
    const built = buildInsomniaEnvironment(
      envName,
      context.apiSlug,
      envIndex,
      mapped.variables,
      usedEnvIds,
      envIndex === 0,
    );
    for (const diag of built.diagnostics) {
      pushDiagnostic(diag);
    }
    environments.push(built.environment);
    usedEnvIds.add(built.environment.id);
    variableCount += built.environment.variables.length;
    envIndex += 1;
  }

  if (environments.length === 0) {
    const built = buildInsomniaEnvironment(
      parsed.info.name,
      context.apiSlug,
      0,
      [],
      usedEnvIds,
      true,
    );
    for (const diag of built.diagnostics) {
      pushDiagnostic(diag);
    }
    environments.push(built.environment);
    usedEnvIds.add(built.environment.id);
    variableCount += built.environment.variables.length;
  }

  let inheritedAuthId: string | undefined;
  const workspace =
    parsed.workspaceId !== undefined
      ? idToResource.get(parsed.workspaceId)
      : undefined;
  if (workspace !== undefined) {
    const workspaceName =
      typeof workspace.name === 'string' && workspace.name.trim().length > 0
        ? workspace.name.trim()
        : parsed.info.name;
    const workspaceAuth = mapInsomniaAuth(workspace.authentication, {
      apiSlug: context.apiSlug,
      labelHint: `${workspaceName} workspace`,
      path:
        typeof workspace._id === 'string'
          ? `/${workspace._id}/authentication`
          : '/workspace/authentication',
      existingIds: context.existingAuthIds,
      pendingIds: pendingAuthIds,
    });
    for (const diag of workspaceAuth.diagnostics) {
      pushDiagnostic(diag);
    }
    if (
      workspaceAuth.profile !== undefined &&
      workspaceAuth.profileId !== undefined
    ) {
      authProfiles.push(workspaceAuth.profile);
      pendingAuthIds.add(workspaceAuth.profileId);
      inheritedAuthId = workspaceAuth.profileId;
    }
  }

  const rootParentId = parsed.workspaceId ?? null;
  const rootChildren =
    byParent.get(rootParentId) ??
    byParent.get(null) ??
    [];

  walk(rootChildren, {
    folderSegments: [],
    parentOrderKey: MARKER_ROOT_ORDER_KEY,
    inheritedAuthId,
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
    item.code.startsWith('insomnia-unsupported'),
  ).length;

  return {
    files,
    environments,
    authProfiles,
    diagnostics,
    folderCount: folderPaths.size,
    requestCount,
    variableCount,
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
    readonly depth: number;
  }

  function walk(
    walkItems: readonly InsomniaResourceLike[],
    state: WalkState,
  ): void {
    if (truncated) {
      return;
    }
    throwIfCancelled(context);
    if (state.depth > INSOMNIA_IMPORT_LIMITS.maxItemDepth) {
      pushDiagnostic({
        code: 'insomnia-max-depth',
        severity: 'warning',
        message: maskImportSecretText(
          `Folder nesting exceeds max depth ${INSOMNIA_IMPORT_LIMITS.maxItemDepth}; deeper items were skipped.`,
        ),
      });
      truncated = true;
      return;
    }

    for (const [index, resource] of walkItems.entries()) {
      if (truncated) {
        return;
      }
      const type = readResourceType(resource);
      if (type === 'workspace' || type === 'environment') {
        continue;
      }

      const name =
        typeof resource.name === 'string' && resource.name.trim().length > 0
          ? resource.name.trim()
          : `${type || 'item'}-${index + 1}`;
      const itemPath =
        typeof resource._id === 'string'
          ? `/${resource._id}`
          : `/resources/${index}`;

      if (type === 'request_group') {
        if (folderPaths.size >= INSOMNIA_IMPORT_LIMITS.maxFolderCount) {
          pushDiagnostic({
            code: 'insomnia-max-folders',
            severity: 'warning',
            path: itemPath,
            message: maskImportSecretText(
              `Folder count exceeds ${INSOMNIA_IMPORT_LIMITS.maxFolderCount}; remaining folders were skipped.`,
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
        const folderAuth = mapInsomniaAuth(resource.authentication, {
          apiSlug: context.apiSlug,
          labelHint: name,
          path: `${itemPath}/authentication`,
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

        const groupId =
          typeof resource._id === 'string' ? resource._id : undefined;
        const children =
          groupId !== undefined ? (byParent.get(groupId) ?? []) : [];

        walk(children, {
          folderSegments: nextSegments,
          parentOrderKey:
            folderRel.length > 0 ? folderRel : MARKER_ROOT_ORDER_KEY,
          inheritedAuthId: folderAuthId,
          depth: state.depth + 1,
        });
        continue;
      }

      if (type === 'request') {
        if (requestCount >= INSOMNIA_IMPORT_LIMITS.maxRequestCount) {
          pushDiagnostic({
            code: 'insomnia-max-requests',
            severity: 'warning',
            path: itemPath,
            message: maskImportSecretText(
              `Request count exceeds ${INSOMNIA_IMPORT_LIMITS.maxRequestCount}; remaining requests were skipped.`,
            ),
          });
          truncated = true;
          return;
        }

        let requestAuthId = state.inheritedAuthId;
        const requestAuth = mapInsomniaAuth(resource.authentication, {
          apiSlug: context.apiSlug,
          labelHint: name,
          path: `${itemPath}/authentication`,
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

        const description =
          typeof resource.description === 'string'
            ? resource.description
            : undefined;
        const mapped = mapInsomniaRequest({
          name,
          resource,
          ...(description !== undefined ? { description } : {}),
          ...(requestAuthId !== undefined
            ? { authProfileId: requestAuthId }
            : {}),
          path: itemPath,
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
    }
  }
}

function throwIfCancelled(context: MapCollectionContext): void {
  if (context.cancellation?.isCancellationRequested === true) {
    const error = new Error('Import cancelled');
    error.name = 'ImportCancelledError';
    throw error;
  }
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
