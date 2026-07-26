import type { CollectionVariableStore } from '../variables';
import type {
  VariableWriteRequest,
  VariableWriteResult,
} from './models';
import { parseRequestKey } from './request-key';
import type { VariableWriter } from './variable-writer';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

export interface CollectionVariableWriterOptions {
  readonly store: CollectionVariableStore;
  readonly getCollectionRootPath: () => string | undefined;
  readonly getCollectionId: () => string | undefined;
  /**
   * When no active collection-run context is set, resolve the collection root
   * from the request's source path (single-request `@extract scope=collection`).
   */
  readonly resolveCollectionRootPathForSource?: (
    sourceId: string,
  ) => string | undefined;
  /**
   * Derives a collection id from a root path when the run context is inactive.
   * Defaults to using the root path as the id when omitted.
   */
  readonly collectionIdForRoot?: (rootPath: string) => string;
}

/**
 * Persists `scope=collection` extraction writes via {@link CollectionVariableStore}.
 * Prefers an active collection-run context; otherwise resolves the owning
 * collection from `request.requestKey` when a source-path resolver is wired.
 */
export class CollectionVariableWriter implements VariableWriter {
  public constructor(private readonly options: CollectionVariableWriterOptions) {}

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    if (request.scope !== 'collection') {
      return {
        ok: false,
        code: 'UNSUPPORTED_SCOPE',
        message: `CollectionVariableWriter does not support scope "${request.scope}".`,
      };
    }
    if (!VARIABLE_NAME.test(request.name)) {
      return {
        ok: false,
        code: 'INVALID_NAME',
        message: `Invalid variable name "${request.name}".`,
      };
    }

    const resolved = this.resolveCollectionIdentity(request.requestKey);
    const collectionRootPath = resolved?.rootPath;
    const collectionId = resolved?.collectionId;
    if (collectionRootPath === undefined || collectionId === undefined) {
      return {
        ok: false,
        code: 'PERSIST_FAILED',
        message: 'No active collection context for a collection-scope write.',
      };
    }

    try {
      await this.options.store.upsert(collectionRootPath, collectionId, {
        name: request.name,
        value: request.value,
        sensitive: request.sensitive,
      });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to persist collection variable.';
      return {
        ok: false,
        code: 'PERSIST_FAILED',
        message,
      };
    }
  }

  private resolveCollectionIdentity(
    requestKey: string | undefined,
  ):
    | { readonly rootPath: string; readonly collectionId: string }
    | undefined {
    const activeRoot = this.options.getCollectionRootPath();
    const activeId = this.options.getCollectionId();
    if (activeRoot !== undefined && activeId !== undefined) {
      return { rootPath: activeRoot, collectionId: activeId };
    }

    if (requestKey === undefined || requestKey.trim().length === 0) {
      return undefined;
    }
    const parsed = parseRequestKey(requestKey);
    if (parsed === undefined) {
      return undefined;
    }
    const rootPath =
      this.options.resolveCollectionRootPathForSource?.(parsed.sourceId);
    if (rootPath === undefined || rootPath.trim().length === 0) {
      return undefined;
    }
    const collectionId =
      this.options.collectionIdForRoot?.(rootPath) ?? rootPath;
    return { rootPath, collectionId };
  }
}
