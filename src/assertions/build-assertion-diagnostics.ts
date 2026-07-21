import {
  AssertionOutcome,
  type TestReport,
} from './models';

/** Framework-free diagnostic descriptor for assertion failures. */
export interface AssertionDiagnosticDescriptor {
  readonly range: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly message: string;
  readonly severity: 'error';
  readonly code: 'assertion.failed' | 'assertion.malformed';
  readonly source: 'API Hero Assertions';
}

export type BuildAssertionDiagnosticsResult =
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly diagnostics: readonly AssertionDiagnosticDescriptor[] };

/**
 * Maps a test report to Problems-panel diagnostics (plain objects).
 * Passed/skipped results are omitted; empty/undefined reports clear diagnostics.
 */
export function buildAssertionDiagnostics(
  report: TestReport | undefined,
): BuildAssertionDiagnosticsResult {
  if (report === undefined || report.summary.total === 0) {
    return { kind: 'clear' };
  }

  const diagnostics: AssertionDiagnosticDescriptor[] = [];
  for (const result of report.results) {
    if (
      result.outcome !== AssertionOutcome.Failed &&
      result.outcome !== AssertionOutcome.Malformed
    ) {
      continue;
    }
    const failure = result.failure;
    if (failure === undefined) {
      continue;
    }
    const message = [
      failure.reason,
      failure.expected === undefined
        ? undefined
        : `Expected: ${failure.expected}`,
      failure.actual === undefined ? undefined : `Actual: ${failure.actual}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' — ');
    diagnostics.push({
      range: rangeFromFailure(failure.source?.range),
      message: `${failure.assertionText}: ${message}`,
      severity: 'error',
      code: failure.malformed ? 'assertion.malformed' : 'assertion.failed',
      source: 'API Hero Assertions',
    });
  }
  return { kind: 'set', diagnostics };
}

function rangeFromFailure(
  range:
    | {
        readonly start: {
          readonly line: number;
          readonly column: number;
        };
        readonly end: {
          readonly line: number;
          readonly column: number;
        };
      }
    | undefined,
): AssertionDiagnosticDescriptor['range'] {
  if (range === undefined) {
    return {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 1 },
    };
  }
  return {
    start: { line: range.start.line, column: range.start.column },
    end: { line: range.end.line, column: range.end.column },
  };
}
