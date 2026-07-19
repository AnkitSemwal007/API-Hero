import { cloneDetached, deepFreeze } from '../shared';
import type { Range } from '../parser';

/**
 * Reserved bags for deferred assertion features. Values stay opaque; this
 * sprint never populates them. Do not scaffold competing modules for these keys.
 */
export interface AssertionExtensionBag {
  readonly custom?: Readonly<Record<string, unknown>>;
  readonly js?: Readonly<Record<string, unknown>>;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly snapshot?: Readonly<Record<string, unknown>>;
  readonly contract?: Readonly<Record<string, unknown>>;
  readonly ai?: Readonly<Record<string, unknown>>;
  readonly [key: string]: Readonly<Record<string, unknown>> | undefined;
}

/** Assertion subject kinds supported by the declarative expect language. */
export const AssertionSubjectKind = {
  Status: 'status',
  Header: 'header',
  Body: 'body',
  ResponseTime: 'responseTime',
  ContentType: 'contentType',
  ResponseSize: 'responseSize',
} as const;

export type AssertionSubjectKind =
  (typeof AssertionSubjectKind)[keyof typeof AssertionSubjectKind];

/** Comparison / predicate operators. */
export const AssertionOperator = {
  Equals: '==',
  NotEquals: '!=',
  GreaterThan: '>',
  GreaterThanOrEqual: '>=',
  LessThan: '<',
  LessThanOrEqual: '<=',
  In: 'in',
  Contains: 'contains',
  Exists: 'exists',
  IsEmpty: 'isEmpty',
  IsNull: 'isNull',
} as const;

export type AssertionOperator =
  (typeof AssertionOperator)[keyof typeof AssertionOperator];

/** Outcome of one evaluated assertion. */
export const AssertionOutcome = {
  Passed: 'passed',
  Failed: 'failed',
  Skipped: 'skipped',
  Malformed: 'malformed',
} as const;

export type AssertionOutcome =
  (typeof AssertionOutcome)[keyof typeof AssertionOutcome];

/** JSON-compatible expected/actual values shown in failure reports. */
export type AssertionValue =
  | string
  | number
  | boolean
  | null
  | readonly AssertionValue[]
  | { readonly [key: string]: AssertionValue };

/**
 * Best-effort source location for Problems / UI. Never includes file contents.
 */
export interface AssertionSourceLocation {
  readonly uri?: string;
  readonly range?: Range;
  readonly lineText?: string;
}

/** Parsed subject of an expect line. */
export interface AssertionSubject {
  readonly kind: AssertionSubjectKind;
  /** Header name when kind is header. */
  readonly headerName?: string;
  /**
   * JSON path relative to the response body root when kind is body.
   * Empty string means the whole body. Examples: `user.id`, `items[0].name`.
   */
  readonly path?: string;
}

/**
 * Immutable declarative assertion produced by the expect-line parser.
 * Malformed lines become {@link AssertionFailure} instead of throwing.
 */
export interface Assertion {
  readonly id: string;
  /** Original expect line text (trimmed). */
  readonly text: string;
  readonly subject: AssertionSubject;
  readonly operator: AssertionOperator;
  readonly expected?: AssertionValue;
  readonly source?: AssertionSourceLocation;
  readonly extensions?: AssertionExtensionBag;
}

/** Structured failure details — never includes stack traces. */
export interface AssertionFailure {
  readonly assertionText: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly reason: string;
  /** Secret-free contextual hint (e.g. subject path, header name). */
  readonly context?: string;
  readonly source?: AssertionSourceLocation;
  /** True when the expect line itself could not be parsed. */
  readonly malformed?: boolean;
}

/** Result of evaluating one assertion (or recording a parse failure). */
export interface AssertionResult {
  readonly assertion?: Assertion;
  readonly outcome: AssertionOutcome;
  readonly durationMs: number;
  readonly failure?: AssertionFailure;
}

/** Aggregate counts for a suite or report. */
export interface AssertionSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly malformed: number;
  readonly durationMs: number;
  /** Pass rate over total assertions; 100 when total is 0. */
  readonly passPercent: number;
}

/** All assertions associated with one request. */
export interface AssertionSuite {
  readonly requestId?: string;
  readonly assertions: readonly Assertion[];
  readonly sourceId?: string;
  readonly extensions?: AssertionExtensionBag;
}

/**
 * Transport-independent evaluation context. Built from a completed
 * {@link import('../execution').ExecutionResult} — never triggers HTTP.
 */
export interface ExecutionAssertionContext {
  readonly requestId: string;
  readonly success: boolean;
  readonly statusCode?: number;
  readonly statusText?: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly contentType?: string;
  readonly bodyText?: string;
  readonly bodyJson?: unknown;
  readonly bodySizeBytes?: number;
  readonly responseTimeMs: number;
  readonly url?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/** Full evaluation report for one execution attempt. */
export interface TestReport {
  readonly suite: AssertionSuite;
  readonly results: readonly AssertionResult[];
  readonly summary: AssertionSummary;
  readonly context: ExecutionAssertionContext;
  readonly extensions?: AssertionExtensionBag;
}

/** Alias used in product copy and collection stats. */
export type TestSummary = AssertionSummary;

/** Secret-free counts suitable for history metadata extension bags. */
export interface AssertionHistoryCounts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly malformed: number;
  readonly passPercent: number;
}

/** Deeply freezes a detached assertion suite. */
export function freezeAssertionSuite(suite: AssertionSuite): AssertionSuite {
  return deepFreeze(cloneDetached(suite));
}

/** Deeply freezes a detached test report. */
export function freezeTestReport(report: TestReport): TestReport {
  return deepFreeze(cloneDetached(report));
}

/** Builds aggregate summary from per-assertion results. */
export function buildAssertionSummary(
  results: readonly AssertionResult[],
  durationMs: number,
): AssertionSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let malformed = 0;
  for (const result of results) {
    switch (result.outcome) {
      case AssertionOutcome.Passed:
        passed += 1;
        break;
      case AssertionOutcome.Failed:
        failed += 1;
        break;
      case AssertionOutcome.Skipped:
        skipped += 1;
        break;
      case AssertionOutcome.Malformed:
        malformed += 1;
        break;
    }
  }
  const total = results.length;
  const passPercent =
    total === 0 ? 100 : Math.round((passed / total) * 1000) / 10;
  return {
    total,
    passed,
    failed,
    skipped,
    malformed,
    durationMs,
    passPercent,
  };
}

/** Maps a summary to history-safe counts (no assertion text or values). */
export function toAssertionHistoryCounts(
  summary: AssertionSummary,
): AssertionHistoryCounts {
  return {
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    malformed: summary.malformed,
    passPercent: summary.passPercent,
  };
}
