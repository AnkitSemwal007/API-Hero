import { normalizePathKey } from '../collections/models';
import type {
  AnnotationResolveContext,
  CatalogRequest,
  MappingResolveResult,
  SourceAnnotation,
} from './models';
import { parseSourceDirectiveValue, sourcePathMatches } from './source-ref';

export interface SourceIntegrationCatalog {
  readonly requests: readonly CatalogRequest[];
  resolveFromAnnotations(
    annotations: readonly SourceAnnotation[],
    context: AnnotationResolveContext,
  ): MappingResolveResult;
  resolveFromApiLocation(
    filePath: string,
    requestIndex: number,
  ): CatalogRequest | undefined;
  findRequestsForSourceFile(sourceFilePath: string): readonly CatalogRequest[];
}

/** Builds an immutable lookup catalog from already-discovered requests. */
export function buildSourceIntegrationCatalog(
  requests: readonly CatalogRequest[],
): SourceIntegrationCatalog {
  const byFileIndex = new Map<string, CatalogRequest>();
  const byName = new Map<string, CatalogRequest[]>();
  const byId = new Map<string, CatalogRequest[]>();
  const byLegacyId = new Map<string, CatalogRequest[]>();
  const byRelative = new Map<string, CatalogRequest[]>();

  for (const request of requests) {
    byFileIndex.set(fileIndexKey(request.filePath, request.requestIndex), request);
    addIndex(byName, normalizeName(request.name), request);
    addIndex(byId, request.id, request);
    if (request.legacyAuthoredId !== undefined) {
      addIndex(byLegacyId, request.legacyAuthoredId, request);
    }
    if (request.relativePath.length > 0) {
      addIndex(byRelative, normalizePathKey(request.relativePath), request);
    }
  }

  return {
    requests,
    resolveFromAnnotations(annotations, context) {
      return resolveAnnotations(
        annotations,
        context,
        requests,
        byName,
        byId,
        byLegacyId,
        byRelative,
      );
    },
    resolveFromApiLocation(filePath, requestIndex) {
      return byFileIndex.get(fileIndexKey(filePath, requestIndex));
    },
    findRequestsForSourceFile(sourceFilePath) {
      const matches: CatalogRequest[] = [];
      for (const request of requests) {
        if (request.sourceRef === undefined) {
          continue;
        }
        const parsed = parseSourceDirectiveValue(request.sourceRef);
        if (parsed === undefined) {
          continue;
        }
        if (
          sourcePathMatches(parsed.path, sourceFilePath, [
            request.workspaceRootPath,
          ])
        ) {
          matches.push(request);
        }
      }
      return matches;
    },
  };
}

function resolveAnnotations(
  annotations: readonly SourceAnnotation[],
  context: AnnotationResolveContext,
  requests: readonly CatalogRequest[],
  byName: ReadonlyMap<string, readonly CatalogRequest[]>,
  byId: ReadonlyMap<string, readonly CatalogRequest[]>,
  byLegacyId: ReadonlyMap<string, readonly CatalogRequest[]>,
  byRelative: ReadonlyMap<string, readonly CatalogRequest[]>,
): MappingResolveResult {
  if (annotations.length === 0) {
    return { kind: 'none' };
  }

  const requestValues = valuesOf(annotations, 'request');
  const nameValues = valuesOf(annotations, 'name');
  const idValues = valuesOf(annotations, 'id');

  let candidates: readonly CatalogRequest[] | undefined;
  if (requestValues.length > 0) {
    candidates = collectRequestPathMatches(
      requestValues,
      context,
      requests,
      byRelative,
    );
  }
  if (nameValues.length > 0) {
    const named = nameValues.flatMap(
      (name) => byName.get(normalizeName(name)) ?? [],
    );
    candidates = intersectCandidates(candidates, named);
  }
  if (idValues.length > 0) {
    const ids = idValues.flatMap((id) => [
      ...(byId.get(id) ?? []),
      ...(byLegacyId.get(id) ?? []),
    ]);
    candidates = intersectCandidates(candidates, ids);
  }
  if (candidates === undefined) {
    return { kind: 'none' };
  }
  return uniqueOrAmbiguous(candidates);
}

function collectRequestPathMatches(
  values: readonly string[],
  context: AnnotationResolveContext,
  requests: readonly CatalogRequest[],
  byRelative: ReadonlyMap<string, readonly CatalogRequest[]>,
): readonly CatalogRequest[] {
  const collected: CatalogRequest[] = [];
  for (const value of values) {
    const parsed = parseSourceDirectiveValue(value) ?? {
      path: value.replace(/\\/g, '/'),
    };
    const relativeHits = byRelative.get(normalizePathKey(parsed.path)) ?? [];
    if (relativeHits.length > 0) {
      collected.push(...relativeHits);
      continue;
    }
    for (const request of requests) {
      if (
        sourcePathMatches(parsed.path, request.filePath, [
          ...context.workspaceRoots,
          request.workspaceRootPath,
        ]) ||
        sourcePathMatches(parsed.path, request.relativePath, context.workspaceRoots)
      ) {
        collected.push(request);
      }
    }
  }
  return dedupeRequests(collected);
}

function intersectCandidates(
  current: readonly CatalogRequest[] | undefined,
  next: readonly CatalogRequest[],
): readonly CatalogRequest[] {
  const uniqueNext = dedupeRequests(next);
  if (current === undefined) {
    return uniqueNext;
  }
  const ids = new Set(uniqueNext.map((request) => request.id));
  return current.filter((request) => ids.has(request.id));
}

function uniqueOrAmbiguous(
  requests: readonly CatalogRequest[],
): MappingResolveResult {
  const unique = dedupeRequests(requests);
  if (unique.length === 0) {
    return { kind: 'none' };
  }
  if (unique.length === 1) {
    return { kind: 'match', request: unique[0]! };
  }
  return { kind: 'ambiguous', count: unique.length };
}

function dedupeRequests(
  requests: readonly CatalogRequest[],
): readonly CatalogRequest[] {
  const seen = new Set<string>();
  const result: CatalogRequest[] = [];
  for (const request of requests) {
    if (seen.has(request.id)) {
      continue;
    }
    seen.add(request.id);
    result.push(request);
  }
  return result;
}

function valuesOf(
  annotations: readonly SourceAnnotation[],
  kind: SourceAnnotation['kind'],
): readonly string[] {
  return annotations
    .filter((annotation) => annotation.kind === kind)
    .map((annotation) => annotation.value.trim())
    .filter((value) => value.length > 0);
}

function addIndex(
  map: Map<string, CatalogRequest[]>,
  key: string,
  request: CatalogRequest,
): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [request]);
    return;
  }
  existing.push(request);
}

function fileIndexKey(filePath: string, requestIndex: number): string {
  return `${normalizePathKey(filePath)}#${requestIndex}`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
