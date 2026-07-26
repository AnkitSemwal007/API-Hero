import type { RunVariableStore } from '../variables';
import type {
  VariableWriteRequest,
  VariableWriteResult,
} from './models';
import type { RuntimeVariableOverlay } from './runtime-overlay';
import type { VariableWriter } from './variable-writer';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

export interface CompositeVariableWriterOptions {
  readonly overlay: RuntimeVariableOverlay;
  readonly runStore: RunVariableStore; // session default
  readonly environment: VariableWriter;
  readonly collection?: VariableWriter;
  readonly workspace?: VariableWriter;
  /**
   * When a collection run is active, returns that run's store; otherwise
   * undefined so writes fall back to the session `runStore`.
   */
  readonly resolveRunStore?: () => RunVariableStore | undefined;
}

/**
 * Routes writes to overlay (document), run store (session or active
 * collection run), environment, collection, or workspace writers.
 *
 * `resolveRunStore` lets the Collection Runner substitute a per-run store
 * for the duration of one execute without changing the session singleton
 * semantics used by single-request runs.
 */
export class CompositeVariableWriter implements VariableWriter {
  public constructor(private readonly options: CompositeVariableWriterOptions) {}

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    if (!VARIABLE_NAME.test(request.name)) {
      return {
        ok: false,
        code: 'INVALID_NAME',
        message: `Invalid variable name "${request.name}".`,
      };
    }

    switch (request.scope) {
      case 'document': {
        const requestKey = request.requestKey?.trim();
        if (requestKey === undefined || requestKey.length === 0) {
          return {
            ok: false,
            code: 'PERSIST_FAILED',
            message: 'Document overlay write requires a request key.',
          };
        }
        this.options.overlay.set({ requestKey }, request);
        return { ok: true };
      }
      case 'run': {
        const runStore = this.options.resolveRunStore?.() ?? this.options.runStore;
        runStore.set(request.name, request.value, request.sensitive);
        return { ok: true };
      }
      case 'environment':
        return this.options.environment.write(request);
      case 'collection':
        if (this.options.collection === undefined) {
          return {
            ok: false,
            code: 'UNSUPPORTED_SCOPE',
            message: 'Variable scope "collection" has no collection writer configured.',
          };
        }
        return this.options.collection.write(request);
      case 'workspace':
        if (this.options.workspace === undefined) {
          return {
            ok: false,
            code: 'UNSUPPORTED_SCOPE',
            message: 'Variable scope "workspace" has no workspace writer configured.',
          };
        }
        return this.options.workspace.write(request);
      default:
        return {
          ok: false,
          code: 'UNSUPPORTED_SCOPE',
          message: `Variable scope "${String((request as VariableWriteRequest).scope)}" is not supported.`,
        };
    }
  }
}
