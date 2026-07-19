import type { WorkspaceCollections } from './models';

/**
 * Port for persisting or observing the latest discovered workspace collections.
 * The default in-memory implementation is sufficient for the explorer.
 */
export interface CollectionRepository {
  get(): WorkspaceCollections | undefined;
  set(collections: WorkspaceCollections): void;
  clear(): void;
}

/** Process-local repository used by the discovery service and tree adapters. */
export class InMemoryCollectionRepository implements CollectionRepository {
  private snapshot: WorkspaceCollections | undefined;

  public get(): WorkspaceCollections | undefined {
    return this.snapshot;
  }

  public set(collections: WorkspaceCollections): void {
    this.snapshot = collections;
  }

  public clear(): void {
    this.snapshot = undefined;
  }
}
