import type { ExecutionResult } from '../execution';
import { resolveJsonPath } from './json-path';
import {
  formatAssertionValue,
  formatHeaderValueForReport,
  maskAssertionText,
} from './mask';
import {
  AssertionOperator,
  AssertionOutcome,
  AssertionSubjectKind,
  buildAssertionSummary,
  freezeTestReport,
  type Assertion,
  type AssertionFailure,
  type AssertionOperator as AssertionOperatorType,
  type AssertionResult,
  type AssertionSuite,
  type AssertionValue,
  type ExecutionAssertionContext,
  type TestReport,
} from './models';

export interface EvaluateAssertionsInput {
  readonly result: ExecutionResult;
  readonly suite: AssertionSuite;
  /** Malformed expect lines recorded as malformed results (not thrown). */
  readonly malformed?: readonly AssertionFailure[];
  /**
   * When true, skip evaluation entirely (cancelled / replaced runs).
   * Returns an empty skipped report without comparing subjects.
   */
  readonly skip?: boolean;
}

/**
 * Evaluates declarative assertions against a completed {@link ExecutionResult}.
 * Never performs HTTP. Parses JSON body at most once and reuses it.
 */
export function evaluateAssertions(
  input: EvaluateAssertionsInput,
): TestReport {
  const started = Date.now();
  const context = buildExecutionAssertionContext(input.result);
  const results: AssertionResult[] = [];

  for (const failure of input.malformed ?? []) {
    results.push({
      outcome: AssertionOutcome.Malformed,
      durationMs: 0,
      failure: {
        ...failure,
        assertionText: maskAssertionText(failure.assertionText),
        ...(failure.expected === undefined
          ? {}
          : { expected: maskAssertionText(failure.expected) }),
        ...(failure.actual === undefined
          ? {}
          : { actual: maskAssertionText(failure.actual) }),
        reason: maskAssertionText(failure.reason),
      },
    });
  }

  if (input.skip) {
    for (const assertion of input.suite.assertions) {
      results.push({
        assertion,
        outcome: AssertionOutcome.Skipped,
        durationMs: 0,
        failure: {
          assertionText: maskAssertionText(assertion.text),
          reason: 'Assertion evaluation skipped for this run.',
        },
      });
    }
    const durationMs = Math.max(0, Date.now() - started);
    return freezeTestReport({
      suite: input.suite,
      results,
      summary: buildAssertionSummary(results, durationMs),
      context,
    });
  }

  // Parse JSON once for all body assertions.
  let bodyJson = context.bodyJson;
  let jsonParseError: string | undefined;
  if (
    bodyJson === undefined &&
    context.bodyText !== undefined &&
    context.bodyText.length > 0 &&
    input.suite.assertions.some(
      (assertion) => assertion.subject.kind === AssertionSubjectKind.Body,
    )
  ) {
    try {
      bodyJson = JSON.parse(context.bodyText) as unknown;
    } catch (error) {
      jsonParseError =
        error instanceof Error
          ? `Response body is not valid JSON: ${error.message}`
          : 'Response body is not valid JSON.';
    }
  }

  const evalContext: ExecutionAssertionContext =
    bodyJson === undefined
      ? context
      : { ...context, bodyJson };

  for (const assertion of input.suite.assertions) {
    const assertionStarted = Date.now();
    const evaluated = evaluateOne(assertion, evalContext, jsonParseError);
    results.push({
      ...evaluated,
      durationMs: Math.max(0, Date.now() - assertionStarted),
    });
  }

  const durationMs = Math.max(0, Date.now() - started);
  return freezeTestReport({
    suite: input.suite,
    results,
    summary: buildAssertionSummary(results, durationMs),
    context: evalContext,
  });
}

/** Builds a transport-independent context from an execution result. */
export function buildExecutionAssertionContext(
  result: ExecutionResult,
): ExecutionAssertionContext {
  if (result.success) {
    const response = result.response;
    return {
      requestId: result.requestId,
      success: true,
      statusCode: response.statusCode,
      statusText: response.statusText,
      headers: response.headers.map((header) => ({
        name: header.name,
        value: header.value,
      })),
      ...(response.contentType === undefined
        ? {}
        : { contentType: response.contentType }),
      ...(response.body.text === undefined
        ? {}
        : { bodyText: response.body.text }),
      ...(response.body.json === undefined
        ? {}
        : { bodyJson: response.body.json }),
      bodySizeBytes: response.bodySizeBytes,
      responseTimeMs: result.timing.durationMs,
      url: response.url,
    };
  }

  return {
    requestId: result.requestId,
    success: false,
    headers: [],
    responseTimeMs: result.timing.durationMs,
    ...(result.request === undefined ? {} : { url: result.request.url }),
    errorCode: result.error.code,
    errorMessage: result.error.message,
  };
}

function evaluateOne(
  assertion: Assertion,
  context: ExecutionAssertionContext,
  jsonParseError: string | undefined,
): Omit<AssertionResult, 'durationMs'> {
  const subject = resolveSubject(assertion, context, jsonParseError);
  if (!subject.ok) {
    return fail(assertion, subject.reason, {
      ...(subject.expected === undefined
        ? {}
        : { expected: subject.expected }),
      ...(subject.actual === undefined ? {} : { actual: subject.actual }),
      ...(subject.context === undefined ? {} : { context: subject.context }),
    });
  }

  const { actual, displayActual, contextLabel } = subject;
  const passed = compare(assertion.operator, actual, assertion.expected);
  if (passed) {
    return {
      assertion,
      outcome: AssertionOutcome.Passed,
    };
  }

  return fail(assertion, describeFailure(assertion, actual), {
    expected:
      assertion.expected === undefined
        ? undefined
        : formatAssertionValue(assertion.expected, {
            headerName: assertion.subject.headerName,
          }),
    actual: displayActual,
    context: contextLabel,
  });
}

function resolveSubject(
  assertion: Assertion,
  context: ExecutionAssertionContext,
  jsonParseError: string | undefined,
):
  | {
      readonly ok: true;
      readonly actual: unknown;
      readonly displayActual: string;
      readonly contextLabel: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly expected?: string;
      readonly actual?: string;
      readonly context?: string;
    } {
  switch (assertion.subject.kind) {
    case AssertionSubjectKind.Status: {
      if (context.statusCode === undefined) {
        return {
          ok: false,
          reason: noResponseReason(context, 'status'),
          context: 'status',
        };
      }
      return {
        ok: true,
        actual: context.statusCode,
        displayActual: String(context.statusCode),
        contextLabel: 'status',
      };
    }
    case AssertionSubjectKind.Header: {
      const name = assertion.subject.headerName ?? '';
      if (!context.success) {
        return {
          ok: false,
          reason: noResponseReason(context, `header ${name}`),
          context: `header ${name}`,
        };
      }
      const header = findHeader(context.headers, name);
      if (
        assertion.operator === AssertionOperator.Exists ||
        assertion.operator === AssertionOperator.IsNull
      ) {
        return {
          ok: true,
          actual: header,
          displayActual: formatHeaderValueForReport(name, header),
          contextLabel: `header ${name}`,
        };
      }
      if (header === undefined) {
        return {
          ok: false,
          reason: `Header "${name}" is missing.`,
          context: `header ${name}`,
          actual: 'undefined',
        };
      }
      return {
        ok: true,
        actual: header,
        displayActual: formatHeaderValueForReport(name, header),
        contextLabel: `header ${name}`,
      };
    }
    case AssertionSubjectKind.ContentType: {
      if (!context.success) {
        return {
          ok: false,
          reason: noResponseReason(context, 'contentType'),
          context: 'contentType',
        };
      }
      const value = context.contentType;
      return {
        ok: true,
        actual: value,
        displayActual:
          value === undefined ? 'undefined' : JSON.stringify(value),
        contextLabel: 'contentType',
      };
    }
    case AssertionSubjectKind.ResponseTime: {
      return {
        ok: true,
        actual: context.responseTimeMs,
        displayActual: String(context.responseTimeMs),
        contextLabel: 'responseTime',
      };
    }
    case AssertionSubjectKind.ResponseSize: {
      if (context.bodySizeBytes === undefined) {
        return {
          ok: false,
          reason: noResponseReason(context, 'responseSize'),
          context: 'responseSize',
        };
      }
      return {
        ok: true,
        actual: context.bodySizeBytes,
        displayActual: String(context.bodySizeBytes),
        contextLabel: 'responseSize',
      };
    }
    case AssertionSubjectKind.Body: {
      if (!context.success) {
        return {
          ok: false,
          reason: noResponseReason(context, 'body'),
          context: bodyContext(assertion),
        };
      }
      if (jsonParseError !== undefined && context.bodyJson === undefined) {
        return {
          ok: false,
          reason: jsonParseError,
          context: bodyContext(assertion),
        };
      }
      if (context.bodyJson === undefined) {
        // Non-JSON body: only the empty path can use raw text for some ops.
        if ((assertion.subject.path ?? '') === '') {
          return {
            ok: true,
            actual: context.bodyText,
            displayActual:
              context.bodyText === undefined
                ? 'undefined'
                : formatAssertionValue(context.bodyText),
            contextLabel: 'body',
          };
        }
        return {
          ok: false,
          reason: 'Response body is not JSON; path assertions require JSON.',
          context: bodyContext(assertion),
        };
      }
      const resolved = resolveJsonPath(
        context.bodyJson,
        assertion.subject.path,
      );
      if (!resolved.found) {
        if (
          assertion.operator === AssertionOperator.Exists ||
          assertion.operator === AssertionOperator.IsNull
        ) {
          return {
            ok: true,
            actual: undefined,
            displayActual: 'undefined',
            contextLabel: bodyContext(assertion),
          };
        }
        return {
          ok: false,
          reason: resolved.reason,
          context: bodyContext(assertion),
          actual: 'undefined',
          expected:
            assertion.expected === undefined
              ? undefined
              : formatAssertionValue(assertion.expected),
        };
      }
      return {
        ok: true,
        actual: resolved.value,
        displayActual: formatAssertionValue(resolved.value),
        contextLabel: bodyContext(assertion),
      };
    }
  }
}

function compare(
  operator: AssertionOperatorType,
  actual: unknown,
  expected: AssertionValue | undefined,
): boolean {
  switch (operator) {
    case AssertionOperator.Equals:
      return deepEqual(actual, expected);
    case AssertionOperator.NotEquals:
      return !deepEqual(actual, expected);
    case AssertionOperator.GreaterThan:
      return isNumber(actual) && isNumber(expected) && actual > expected;
    case AssertionOperator.GreaterThanOrEqual:
      return isNumber(actual) && isNumber(expected) && actual >= expected;
    case AssertionOperator.LessThan:
      return isNumber(actual) && isNumber(expected) && actual < expected;
    case AssertionOperator.LessThanOrEqual:
      return isNumber(actual) && isNumber(expected) && actual <= expected;
    case AssertionOperator.In:
      return Array.isArray(expected) && expected.some((item) => deepEqual(actual, item));
    case AssertionOperator.Contains:
      return containsValue(actual, expected);
    case AssertionOperator.Exists:
      return actual !== undefined;
    case AssertionOperator.IsEmpty:
      return isEmptyValue(actual);
    case AssertionOperator.IsNull:
      return actual === null;
  }
}

function containsValue(actual: unknown, expected: AssertionValue | undefined): boolean {
  if (expected === undefined) {
    return false;
  }
  if (typeof actual === 'string') {
    return actual.includes(String(expected));
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => deepEqual(item, expected));
  }
  return false;
}

function isEmptyValue(actual: unknown): boolean {
  if (actual === undefined || actual === null) {
    return true;
  }
  if (typeof actual === 'string' || Array.isArray(actual)) {
    return actual.length === 0;
  }
  if (typeof actual === 'object') {
    return Object.keys(actual as object).length === 0;
  }
  return false;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    typeof left !== typeof right ||
    left === null ||
    right === null ||
    typeof left !== 'object'
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  const rightRecord = right as Record<string, unknown>;
  const leftRecord = left as Record<string, unknown>;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      deepEqual(leftRecord[key], rightRecord[key]),
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function findHeader(
  headers: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === lower) {
      return header.value;
    }
  }
  return undefined;
}

function noResponseReason(
  context: ExecutionAssertionContext,
  subject: string,
): string {
  if (context.errorCode !== undefined) {
    return `No HTTP response available to assert ${subject} (${context.errorCode}).`;
  }
  return `No HTTP response available to assert ${subject}.`;
}

function bodyContext(assertion: Assertion): string {
  const path = assertion.subject.path;
  return path === undefined || path.length === 0 ? 'body' : `body.${path}`;
}

function describeFailure(assertion: Assertion, actual: unknown): string {
  switch (assertion.operator) {
    case AssertionOperator.Exists:
      return 'Expected value to exist.';
    case AssertionOperator.IsEmpty:
      return 'Expected value to be empty.';
    case AssertionOperator.IsNull:
      return 'Expected value to be null.';
    case AssertionOperator.Contains:
      return `Expected ${formatAssertionValue(actual, {
        headerName: assertion.subject.headerName,
      })} to contain ${formatAssertionValue(assertion.expected, {
        headerName: assertion.subject.headerName,
      })}.`;
    case AssertionOperator.In:
      return `Expected ${formatAssertionValue(actual, {
        headerName: assertion.subject.headerName,
      })} to be in ${formatAssertionValue(assertion.expected)}.`;
    default:
      return `Assertion failed for operator "${assertion.operator}".`;
  }
}

function fail(
  assertion: Assertion,
  reason: string,
  extras: {
    readonly expected?: string;
    readonly actual?: string;
    readonly context?: string;
  },
): Omit<AssertionResult, 'durationMs'> {
  return {
    assertion,
    outcome: AssertionOutcome.Failed,
    failure: {
      assertionText: maskAssertionText(assertion.text),
      reason: maskAssertionText(reason),
      ...(extras.expected === undefined
        ? {}
        : { expected: extras.expected }),
      ...(extras.actual === undefined ? {} : { actual: extras.actual }),
      ...(extras.context === undefined ? {} : { context: extras.context }),
      ...(assertion.source === undefined ? {} : { source: assertion.source }),
    },
  };
}

/** True when the report has any failed or malformed assertion. */
export function hasAssertionFailures(report: TestReport): boolean {
  return report.summary.failed > 0 || report.summary.malformed > 0;
}
