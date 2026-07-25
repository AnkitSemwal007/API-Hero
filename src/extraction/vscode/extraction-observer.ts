import type { TestReport } from '../../assertions';
import type { ExecutionResult } from '../../execution';
import type { AuthenticatedRequest } from '../../models';
import type { PostExecutionObserver } from '../../orchestration';
import type {
  ExtractionEngine,
  ExtractionReport,
  ExtractionRule,
  VariableWriter,
} from '..';

/**
 * Runs {@link ExtractionEngine} after a successful transport attempt and
 * returns the report for the response viewer (P1 §7.2 Option A).
 */
export class ExtractionObserver implements PostExecutionObserver {
  public constructor(
    private readonly engine: ExtractionEngine,
    private readonly writer: VariableWriter,
    private readonly getActiveEnvironmentId: () => string | undefined,
  ) {}

  public async onExecuted(input: {
    readonly sourceId: string;
    readonly requestKey: string;
    readonly request: AuthenticatedRequest;
    readonly result: ExecutionResult;
    readonly assertionReport: TestReport | undefined;
    readonly extractionRules: readonly ExtractionRule[];
  }): Promise<ExtractionReport> {
    const activeEnvironmentId = this.getActiveEnvironmentId();
    return this.engine.apply(
      input.extractionRules,
      {
        result: input.result,
        assertionReport: input.assertionReport,
        requestKey: input.requestKey,
        ...(activeEnvironmentId === undefined
          ? {}
          : { activeEnvironmentId }),
      },
      this.writer,
    );
  }
}
