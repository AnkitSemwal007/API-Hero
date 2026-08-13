import type { WorkspaceCollections } from '../collections';
import { parseApiFileRequests, requestIdFor, normalizePathKey } from '../collections';
import type { CatalogRequest } from './models';
import { buildSourceIntegrationCatalog } from './catalog';
import type { SourceIntegrationCatalog } from './catalog';

export interface CatalogDocumentOverlay {
  readonly filePath: string;
  readonly workspaceRootPath: string;
  readonly relativePath: string;
  readonly text: string;
}

/** Projects discovery snapshot (+ optional unsaved overlays) into a catalog. */
export function catalogFromWorkspace(
  snapshot: WorkspaceCollections | undefined,
  overlays: readonly CatalogDocumentOverlay[] = [],
): SourceIntegrationCatalog {
  const overlayPaths = new Set(
    overlays.map((overlay) => normalizePathKey(overlay.filePath)),
  );
  const snapshotRequests = catalogRequestsFromSnapshot(snapshot).filter(
    (request) => !overlayPaths.has(normalizePathKey(request.filePath)),
  );
  return buildSourceIntegrationCatalog([
    ...snapshotRequests,
    ...catalogRequestsFromOverlays(overlays),
  ]);
}

export function catalogRequestsFromSnapshot(
  snapshot: WorkspaceCollections | undefined,
): CatalogRequest[] {
  if (snapshot === undefined) {
    return [];
  }
  const requests: CatalogRequest[] = [];
  for (const collection of Object.values(snapshot.collections)) {
    for (const reference of Object.values(collection.requests)) {
      requests.push({
        id: reference.id,
        filePath: reference.filePath,
        relativePath: reference.display.detail ?? '',
        workspaceRootPath: collection.workspaceRootPath,
        requestIndex: reference.requestIndex,
        method: reference.method,
        url: reference.url,
        name: reference.display.label,
        protocol: (reference.protocol ?? 'http').trim().toLowerCase() || 'http',
        ...(reference.sourceRef === undefined
          ? {}
          : { sourceRef: reference.sourceRef }),
        range: reference.range,
        ...(reference.legacyAuthoredId === undefined
          ? {}
          : { legacyAuthoredId: reference.legacyAuthoredId }),
      });
    }
  }
  return requests;
}

function catalogRequestsFromOverlays(
  overlays: readonly CatalogDocumentOverlay[],
): CatalogRequest[] {
  const requests: CatalogRequest[] = [];
  for (const overlay of overlays) {
    const parsed = parseApiFileRequests(overlay.text, overlay.filePath);
    for (const summary of parsed.requests) {
      requests.push({
        id: requestIdFor(overlay.filePath, summary.index),
        filePath: overlay.filePath,
        relativePath: overlay.relativePath,
        workspaceRootPath: overlay.workspaceRootPath,
        requestIndex: summary.index,
        method: summary.method,
        url: summary.url,
        name: summary.label,
        protocol: (summary.protocol ?? 'http').trim().toLowerCase() || 'http',
        ...(summary.sourceRef === undefined ? {} : { sourceRef: summary.sourceRef }),
        range: summary.range,
        ...(summary.legacyAuthoredId === undefined
          ? {}
          : { legacyAuthoredId: summary.legacyAuthoredId }),
      });
    }
  }
  return requests;
}
