import { normalizePathKey, type RequestReference, type WorkspaceCollections } from './models';

/**
 * Index from file path → ordered request references for cursor → tree sync.
 */
export interface NavigationIndex {
  readonly byFile: Readonly<Record<string, readonly RequestReference[]>>;
}

/** Builds a navigation index from a discovered workspace aggregate. */
export function buildNavigationIndex(
  collections: WorkspaceCollections,
): NavigationIndex {
  const byFile: Record<string, RequestReference[]> = {};
  for (const collection of Object.values(collections.collections)) {
    for (const request of Object.values(collection.requests)) {
      const key = normalizePathKey(request.filePath);
      const list = byFile[key] ?? [];
      list.push(request);
      byFile[key] = list;
    }
  }
  for (const key of Object.keys(byFile)) {
    byFile[key] = [...(byFile[key] ?? [])].sort(
      (left, right) => left.range.start.offset - right.range.start.offset,
    );
  }
  return { byFile };
}

/**
 * Resolves the request whose block contains `offset`, preferring the request
 * whose range contains the offset, then the nearest preceding request start.
 */
export function findRequestAtOffset(
  index: NavigationIndex,
  filePath: string,
  offset: number,
): RequestReference | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return undefined;
  }
  const requests = index.byFile[normalizePathKey(filePath)];
  if (requests === undefined || requests.length === 0) {
    return undefined;
  }

  for (const request of requests) {
    if (
      offset >= request.range.start.offset &&
      offset < request.range.end.offset
    ) {
      return request;
    }
  }

  let candidate: RequestReference | undefined;
  for (const request of requests) {
    if (request.range.start.offset <= offset) {
      candidate = request;
      continue;
    }
    break;
  }
  return candidate;
}

/** Looks up a request by stable id across the aggregate. */
export function findRequestById(
  collections: WorkspaceCollections,
  requestId: string,
): RequestReference | undefined {
  for (const collection of Object.values(collections.collections)) {
    const request = collection.requests[requestId];
    if (request !== undefined) {
      return request;
    }
  }
  return undefined;
}
