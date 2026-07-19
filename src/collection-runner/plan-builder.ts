import type {
  Collection,
  Folder,
  RequestReference,
  WorkspaceCollections,
} from '../collections';
import {
  CollectionRunMode,
  createRunIdentifier,
  freezeRunPlan,
  type FailurePolicyKind,
  type PlannedRequest,
  type RunPlan,
} from './models';

/** Target describing which requests to include in a plan. */
export type RunPlanTarget =
  | {
      readonly mode: typeof CollectionRunMode.Collection;
      readonly collectionId: string;
    }
  | {
      readonly mode: typeof CollectionRunMode.Folder;
      readonly collectionId: string;
      readonly folderId: string;
    }
  | {
      readonly mode: typeof CollectionRunMode.SelectedRequests;
      readonly collectionId: string;
      readonly requestIds: readonly string[];
    };

export interface BuildRunPlanOptions {
  readonly aggregate: WorkspaceCollections;
  readonly target: RunPlanTarget;
  readonly failurePolicy: FailurePolicyKind;
  readonly runId?: string;
  readonly now?: () => number;
}

/**
 * Builds an ordered {@link RunPlan} from a frozen collections snapshot.
 *
 * Ordering matches the Collections explorer depth-first walk: at each folder
 * level, child folders (already sorted by discovery) then requests (file path,
 * then request index). Selected-request mode preserves the caller’s id order
 * for known references and drops unknown ids.
 */
export function buildRunPlan(options: BuildRunPlanOptions): RunPlan {
  const nowMs = (options.now ?? Date.now)();
  const collection = options.aggregate.collections[options.target.collectionId];
  if (collection === undefined) {
    throw new RunPlanError(
      'COLLECTION_NOT_FOUND',
      'The selected collection is no longer available.',
    );
  }

  let requests: RequestReference[];
  let folderId: string | undefined;

  switch (options.target.mode) {
    case CollectionRunMode.Collection:
      requests = collectCollectionRequests(collection);
      break;
    case CollectionRunMode.Folder: {
      folderId = options.target.folderId;
      const folder = collection.folders[folderId];
      if (folder === undefined) {
        throw new RunPlanError(
          'FOLDER_NOT_FOUND',
          'The selected folder is no longer available.',
        );
      }
      requests = collectFolderRequests(collection, folder);
      break;
    }
    case CollectionRunMode.SelectedRequests:
      requests = selectRequests(collection, options.target.requestIds);
      break;
  }

  const planned: PlannedRequest[] = requests.map((request, ordinal) =>
    toPlannedRequest(request, ordinal),
  );

  return freezeRunPlan({
    runId: options.runId ?? createRunIdentifier(nowMs),
    mode: options.target.mode,
    collectionId: collection.id,
    collectionName: collection.metadata.name,
    ...(folderId === undefined ? {} : { folderId }),
    failurePolicy: options.failurePolicy,
    requests: planned,
    createdAt: new Date(nowMs).toISOString(),
  });
}

function collectCollectionRequests(collection: Collection): RequestReference[] {
  const out: RequestReference[] = [];
  for (const folderId of collection.rootFolderIds) {
    const folder = collection.folders[folderId];
    if (folder !== undefined) {
      out.push(...collectFolderRequests(collection, folder));
    }
  }
  for (const requestId of collection.rootRequestIds) {
    const request = collection.requests[requestId];
    if (request !== undefined) {
      out.push(request);
    }
  }
  return out;
}

function collectFolderRequests(
  collection: Collection,
  folder: Folder,
): RequestReference[] {
  const out: RequestReference[] = [];
  for (const childId of folder.folderIds) {
    const child = collection.folders[childId];
    if (child !== undefined) {
      out.push(...collectFolderRequests(collection, child));
    }
  }
  for (const requestId of folder.requestIds) {
    const request = collection.requests[requestId];
    if (request !== undefined) {
      out.push(request);
    }
  }
  return out;
}

function selectRequests(
  collection: Collection,
  requestIds: readonly string[],
): RequestReference[] {
  const out: RequestReference[] = [];
  for (const id of requestIds) {
    const request = collection.requests[id];
    if (request !== undefined) {
      out.push(request);
    }
  }
  return out;
}

function toPlannedRequest(
  request: RequestReference,
  ordinal: number,
): PlannedRequest {
  return {
    requestId: request.id,
    collectionId: request.collectionId,
    ...(request.folderId === undefined ? {} : { folderId: request.folderId }),
    filePath: request.filePath,
    offset: request.range.start.offset,
    label: request.display.label,
    method: request.method,
    url: request.url,
    ordinal,
  };
}

export type RunPlanErrorCode =
  | 'COLLECTION_NOT_FOUND'
  | 'FOLDER_NOT_FOUND';

export class RunPlanError extends Error {
  public override readonly name = 'RunPlanError';

  public constructor(
    public readonly code: RunPlanErrorCode,
    message: string,
  ) {
    super(message);
  }
}
