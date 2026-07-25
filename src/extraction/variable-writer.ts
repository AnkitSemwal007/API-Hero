import type { VariableWriteRequest, VariableWriteResult } from './models';

export interface VariableWriter {
  write(request: VariableWriteRequest): Promise<VariableWriteResult>;
}

/**
 * P0 stub. Always returns NOT_IMPLEMENTED.
 * Phase 1 replaces / wraps with real env / overlay / collection writers.
 */
export class NoOpVariableWriter implements VariableWriter {
  public async write(_request: VariableWriteRequest): Promise<VariableWriteResult> {
    return {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: 'VariableWriter persistence is not implemented in Phase 0.',
    };
  }
}
