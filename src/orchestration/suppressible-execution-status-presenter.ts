/**
 * Suppressible gate for {@link ExecutionStatusPresenter}.
 * Pure adapter — no VS Code imports (unit-test friendly).
 */

import type {
  ExecutionStatus,
  ExecutionStatusPresenter,
} from './execution-orchestrator';

/**
 * Gates request-execution status updates so Collection Runner can own the
 * status bar without competing with the single-request presenter.
 */
export class SuppressibleExecutionStatusPresenter
implements ExecutionStatusPresenter {
  private suppressed = false;

  public constructor(private readonly inner: ExecutionStatusPresenter) {}

  /** When true, forces idle on the inner presenter and drops further updates. */
  public setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    if (suppressed) {
      this.inner.update({ kind: 'idle' });
    }
  }

  public update(status: ExecutionStatus): void {
    if (this.suppressed) {
      return;
    }
    this.inner.update(status);
  }

  public dispose(): void {
    this.inner.dispose();
  }
}
