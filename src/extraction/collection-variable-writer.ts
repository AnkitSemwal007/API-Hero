import type { CollectionVariableStore } from '../variables';
import type {
  VariableWriteRequest,
  VariableWriteResult,
} from './models';
import type { VariableWriter } from './variable-writer';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

export interface CollectionVariableWriterOptions {
  readonly store: CollectionVariableStore;
  readonly getCollectionRootPath: () => string | undefined;
  readonly getCollectionId: () => string | undefined;
}

/**
 * Persists `scope=collection` extraction writes via {@link CollectionVariableStore}.
 * Outside an active collection context (no root path / id known),
 * writes fail with `PERSIST_FAILED` rather than silently no-op-ing.
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

    const collectionRootPath = this.options.getCollectionRootPath();
    const collectionId = this.options.getCollectionId();
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
}
