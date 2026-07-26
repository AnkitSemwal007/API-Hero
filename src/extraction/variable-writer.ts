import type {
  VariableWriteRequest,
  VariableWriteResult,
  VariableWriter,
} from './models';

export type { VariableWriter } from './models';

/**
 * P0 stub. Always returns NOT_IMPLEMENTED.
 * Phase 1 replaces / wraps with real env / overlay / collection writers.
 */
export class NoOpVariableWriter implements VariableWriter {
  public async write(_request: VariableWriteRequest): Promise<VariableWriteResult> {
    void _request;
    return {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: 'VariableWriter persistence is not implemented in Phase 0.',
    };
  }
}
