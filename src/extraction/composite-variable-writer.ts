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
  readonly runStore: RunVariableStore;
  readonly environment: VariableWriter;
}

/**
 * Routes writes to overlay (document), session run store, or environment writer.
 * Collection/workspace scopes return UNSUPPORTED_SCOPE until Phase 2+.
 *
 * Phase 2 will hand run-store lifecycle to Collection Runner; this writer keeps
 * the session singleton semantics for single-request P1.
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
      case 'run':
        // Session-lived store; Collection Runner owns lifecycle in Phase 2.
        this.options.runStore.set(
          request.name,
          request.value,
          request.sensitive,
        );
        return { ok: true };
      case 'environment':
        return this.options.environment.write(request);
      case 'collection':
      case 'workspace':
        return {
          ok: false,
          code: 'UNSUPPORTED_SCOPE',
          message: `Variable scope "${request.scope}" is not supported until Phase 2+.`,
        };
      default:
        return {
          ok: false,
          code: 'UNSUPPORTED_SCOPE',
          message: `Variable scope "${String((request as VariableWriteRequest).scope)}" is not supported.`,
        };
    }
  }
}
