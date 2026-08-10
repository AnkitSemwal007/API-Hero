/**
 * Agent-friendly projections of collection discovery and run models.
 * Maps real domain fields only — never fabricates statistics or diagnostics.
 */

import type {
  Collection,
  Folder,
  RequestReference,
  WorkspaceCollections,
} from '../collections';
import type {
  RequestFailureDiagnostics,
  RequestRunResult,
  RunStatistics,
  RunSummary,
} from '../collection-runner';
import type { ResponsePresentation } from '../response/presentation';
import { MASKED_VARIABLE_VALUE } from '../variables';
import {
  maskVariableIfSensitive,
  redactForMcp,
  redactRequestUrl,
} from './redact';

export interface McpCollectionSummary {
  readonly name: string;
  readonly id: string;
  readonly description?: string;
  readonly requestCount: number;
  readonly folderCount: number;
  readonly kind: string;
}

export interface McpAuthMetadata {
  readonly configured: boolean;
  readonly type?: string;
}

export interface McpFolderNode {
  readonly name: string;
  readonly relativePath: string;
  readonly folders: readonly McpFolderNode[];
  readonly requestCount: number;
}

export interface McpVariableMeta {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
}

export interface McpCollectionDetail {
  readonly name: string;
  readonly id: string;
  readonly description?: string;
  readonly kind: string;
  readonly requestCount: number;
  readonly folderCount: number;
  readonly folders: readonly McpFolderNode[];
  readonly variables: readonly McpVariableMeta[];
  readonly auth: McpAuthMetadata;
}

export interface McpRequestSummary {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly method: string;
  readonly url: string;
  readonly folderPath: string;
  readonly filePath: string;
}

export interface McpRequestDetail extends McpRequestSummary {
  readonly auth: McpAuthMetadata;
  readonly variableRefs: readonly McpVariableMeta[];
}

export interface McpRequestRunDto {
  readonly requestId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly status: string;
  readonly httpStatus?: number;
  readonly durationMs?: number;
  readonly message?: string;
  readonly assertions?: {
    readonly passed?: number;
    readonly failed?: number;
    readonly total?: number;
    readonly expected?: string;
    readonly actual?: string;
  };
  readonly failureDiagnostics?: RequestFailureDiagnostics;
  readonly skipReason?: string;
  readonly response?: unknown;
}

export interface McpRunSummaryDto {
  readonly collection: string;
  readonly collectionId: string;
  readonly runId: string;
  readonly status: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
  readonly durationMs: number;
  readonly assertions: {
    readonly passed: number;
    readonly failed: number;
    readonly total: number;
  };
  readonly failureCategoryCounts: {
    readonly precondition: number;
    readonly transport: number;
    readonly assertion: number;
    readonly extraction: number;
  };
  readonly requests: readonly McpRequestRunDto[];
}

export interface McpErrorResult {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface McpOkResult<T> {
  readonly ok: true;
  readonly data: T;
}

export type McpResult<T> = McpOkResult<T> | McpErrorResult;

export function mcpOk<T>(data: T): McpOkResult<T> {
  return { ok: true, data: redactForMcp(data) };
}

export function mcpError(code: string, message: string): McpErrorResult {
  return { ok: false, error: { code, message } };
}

/** Internal result helper without redaction (preserves domain object identity). */
export function ok<T>(data: T): McpOkResult<T> {
  return { ok: true, data };
}


export function projectCollectionSummary(
  collection: Collection,
): McpCollectionSummary {
  return {
    name: collection.metadata.name,
    id: collection.id,
    ...(collection.metadata.description !== undefined
      ? { description: collection.metadata.description }
      : {}),
    requestCount: collection.metadata.requestCount,
    folderCount: collection.metadata.folderCount,
    kind: collection.kind,
  };
}

export function projectFolderTree(collection: Collection): readonly McpFolderNode[] {
  return collection.rootFolderIds.map((folderId) =>
    projectFolderNode(collection, collection.folders[folderId]!),
  );
}

function projectFolderNode(
  collection: Collection,
  folder: Folder,
): McpFolderNode {
  return {
    name: folder.display.label,
    relativePath: folder.relativePath,
    folders: folder.folderIds.map((id) =>
      projectFolderNode(collection, collection.folders[id]!),
    ),
    requestCount: countFolderRequests(collection, folder),
  };
}

function countFolderRequests(
  collection: Collection,
  folder: Folder,
): number {
  let count = folder.requestIds.length;
  for (const childId of folder.folderIds) {
    const child = collection.folders[childId];
    if (child !== undefined) {
      count += countFolderRequests(collection, child);
    }
  }
  return count;
}

export function projectRequestSummary(
  collection: Collection,
  request: RequestReference,
): McpRequestSummary {
  const folderPath =
    request.folderId === undefined
      ? ''
      : (collection.folders[request.folderId]?.relativePath ?? '');
  return {
    id: request.id,
    name: request.display.label,
    label: request.display.label,
    method: request.method,
    url: redactRequestUrl(request.url),
    folderPath,
    filePath: request.filePath,
  };
}

export function projectRunSummary(summary: RunSummary): McpRunSummaryDto {
  const stats = summary.statistics;
  return {
    collection: summary.plan.collectionName,
    collectionId: summary.plan.collectionId,
    runId: summary.runId,
    status: summary.status,
    total: stats.total,
    passed: stats.passed,
    failed: stats.failed,
    skipped: stats.skipped,
    cancelled: stats.cancelled,
    durationMs: stats.durationMs,
    assertions: {
      passed: stats.assertionsPassed,
      failed: stats.assertionsFailed,
      total: stats.assertionsTotal,
    },
    failureCategoryCounts: projectFailureCategoryCounts(stats),
    // Slim per-request rows for collection runs — full response bodies belong
    // on apihero_get_request_result so agents are not flooded with headers/JSON.
    requests: summary.results.map((result) =>
      projectRequestRunResult(result, { includeFullResponse: false }),
    ),
  };
}

export function projectFailureCategoryCounts(stats: RunStatistics): {
  readonly precondition: number;
  readonly transport: number;
  readonly assertion: number;
  readonly extraction: number;
} {
  return {
    precondition: stats.preconditionFailures,
    transport: stats.transportFailures,
    assertion: stats.assertionFailures,
    extraction: stats.extractionFailures,
  };
}

export function projectRequestRunResult(
  result: RequestRunResult,
  options?: { readonly includeFullResponse?: boolean },
): McpRequestRunDto {
  const includeFullResponse = options?.includeFullResponse !== false;
  const assertionExtras = assertionExpectedActual(result.presentation);
  return {
    requestId: result.requestId,
    ordinal: result.ordinal,
    label: result.label,
    status: result.outcome,
    ...(result.statusCode !== undefined
      ? { httpStatus: result.statusCode }
      : {}),
    ...(result.durationMs !== undefined
      ? { durationMs: result.durationMs }
      : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    ...(result.assertionsTotal !== undefined ||
    result.assertionsPassed !== undefined ||
    result.assertionsFailed !== undefined ||
    assertionExtras !== undefined
      ? {
          assertions: {
            ...(result.assertionsPassed !== undefined
              ? { passed: result.assertionsPassed }
              : {}),
            ...(result.assertionsFailed !== undefined
              ? { failed: result.assertionsFailed }
              : {}),
            ...(result.assertionsTotal !== undefined
              ? { total: result.assertionsTotal }
              : {}),
            ...(assertionExtras ?? {}),
          },
        }
      : {}),
    ...(result.failureDiagnostics !== undefined
      ? { failureDiagnostics: result.failureDiagnostics }
      : {}),
    ...(result.skipReason !== undefined
      ? { skipReason: result.skipReason }
      : {}),
    ...(result.presentation !== undefined && includeFullResponse
      ? { response: projectPresentation(result.presentation) }
      : result.presentation !== undefined
        ? {
            response: {
              success: result.presentation.success,
              status: result.presentation.status,
              summary: result.presentation.summary,
            },
          }
        : {}),
  };
}

function assertionExpectedActual(
  presentation: ResponsePresentation | undefined,
): { expected?: string; actual?: string } | undefined {
  const assertions = presentation?.assertions?.assertions;
  if (assertions === undefined) {
    return undefined;
  }
  const failed = assertions.find(
    (entry) => entry.outcome === 'failed' && entry.failure !== undefined,
  );
  if (failed?.failure === undefined) {
    return undefined;
  }
  const out: { expected?: string; actual?: string } = {};
  if (failed.failure.expected !== undefined) {
    out.expected = failed.failure.expected;
  }
  if (failed.failure.actual !== undefined) {
    out.actual = failed.failure.actual;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function projectPresentation(presentation: ResponsePresentation): unknown {
  return {
    success: presentation.success,
    method: presentation.method,
    requestUrl: presentation.requestUrl,
    status: presentation.status,
    headers: presentation.headers,
    body: presentation.body,
    statistics: presentation.statistics,
    failure: presentation.failure,
    assertions: presentation.assertions,
    summary: presentation.summary,
  };
}

export function projectVariables(
  definitions: readonly {
    readonly name: string;
    readonly value: string;
    readonly sensitive?: boolean;
  }[],
): readonly McpVariableMeta[] {
  return definitions.map((definition) => {
    const sensitive = definition.sensitive === true;
    return {
      name: definition.name,
      value: maskVariableIfSensitive(
        definition.name,
        definition.value,
        sensitive,
      ),
      sensitive,
    };
  });
}

export function emptyWorkspaceHint(
  aggregate: WorkspaceCollections | undefined,
): boolean {
  if (aggregate === undefined) {
    return true;
  }
  return (
    aggregate.workspaceRoots.length === 0 ||
    Object.keys(aggregate.collections).length === 0
  );
}

/** Sentinel used when a sensitive value must appear as masked text. */
export const MASKED = MASKED_VARIABLE_VALUE;
