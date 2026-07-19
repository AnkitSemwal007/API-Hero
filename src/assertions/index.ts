/**
 * Framework-free Assertion Engine.
 * VS Code adapters live under `./vscode` and must not be imported here.
 *
 * Pipeline: ExecutionResult → evaluateAssertions → TestReport
 * Never executes HTTP.
 */

export {
  AssertionOperator,
  AssertionOutcome,
  AssertionSubjectKind,
  buildAssertionSummary,
  freezeAssertionSuite,
  freezeTestReport,
  toAssertionHistoryCounts,
} from './models';
export type {
  Assertion,
  AssertionExtensionBag,
  AssertionFailure,
  AssertionHistoryCounts,
  AssertionOutcome as AssertionOutcomeType,
  AssertionOperator as AssertionOperatorType,
  AssertionResult,
  AssertionSourceLocation,
  AssertionSubject,
  AssertionSubjectKind as AssertionSubjectKindType,
  AssertionSummary,
  AssertionSuite,
  AssertionValue,
  ExecutionAssertionContext,
  TestReport,
  TestSummary,
} from './models';

export {
  buildExecutionAssertionContext,
  evaluateAssertions,
  hasAssertionFailures,
} from './engine';
export type { EvaluateAssertionsInput } from './engine';

export {
  extractAssertionsForDocument,
  extractAssertionsForOffset,
} from './extract';
export type {
  ExtractAssertionsOptions,
  ExtractedExpectLine,
  RequestAssertionExtraction,
} from './extract';

export { parseExpectLine } from './parse-expect';
export type { ParseExpectResult } from './parse-expect';

export { resolveJsonPath } from './json-path';
export type { JsonPathResolution } from './json-path';

export {
  MASKED_ASSERTION_VALUE,
  formatAssertionValue,
  formatHeaderValueForReport,
  isSensitiveHeaderName,
  maskAssertionText,
} from './mask';

export { buildAssertionDiagnostics } from './build-assertion-diagnostics';
export type {
  AssertionDiagnosticDescriptor,
  BuildAssertionDiagnosticsResult,
} from './build-assertion-diagnostics';
