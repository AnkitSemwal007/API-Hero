import {
  AssertionOperator,
  AssertionSubjectKind,
  type Assertion,
  type AssertionFailure,
  type AssertionOperator as AssertionOperatorType,
  type AssertionSourceLocation,
  type AssertionSubject,
  type AssertionValue,
} from './models';

export type ParseExpectResult =
  | { readonly ok: true; readonly assertion: Omit<Assertion, 'id'> }
  | { readonly ok: false; readonly failure: AssertionFailure };

const OPERATOR_ALIASES: Readonly<Record<string, AssertionOperatorType>> =
  Object.freeze({
    '==': AssertionOperator.Equals,
    '=': AssertionOperator.Equals,
    eq: AssertionOperator.Equals,
    equals: AssertionOperator.Equals,
    '!=': AssertionOperator.NotEquals,
    '<>': AssertionOperator.NotEquals,
    ne: AssertionOperator.NotEquals,
    notEquals: AssertionOperator.NotEquals,
    '>': AssertionOperator.GreaterThan,
    gt: AssertionOperator.GreaterThan,
    '>=': AssertionOperator.GreaterThanOrEqual,
    gte: AssertionOperator.GreaterThanOrEqual,
    '<': AssertionOperator.LessThan,
    lt: AssertionOperator.LessThan,
    '<=': AssertionOperator.LessThanOrEqual,
    lte: AssertionOperator.LessThanOrEqual,
    in: AssertionOperator.In,
    contains: AssertionOperator.Contains,
    exist: AssertionOperator.Exists,
    exists: AssertionOperator.Exists,
    isempty: AssertionOperator.IsEmpty,
    empty: AssertionOperator.IsEmpty,
    isnull: AssertionOperator.IsNull,
    null: AssertionOperator.IsNull,
  });

const UNARY_OPERATORS = new Set<AssertionOperatorType>([
  AssertionOperator.Exists,
  AssertionOperator.IsEmpty,
  AssertionOperator.IsNull,
]);

/**
 * Parses one `expect ...` line into an assertion or a structured failure.
 * Never throws for malformed input.
 */
export function parseExpectLine(
  rawLine: string,
  source?: AssertionSourceLocation,
): ParseExpectResult {
  const text = rawLine.trim();
  const malformed = (
    reason: string,
    extras: Partial<AssertionFailure> = {},
  ): ParseExpectResult => ({
    ok: false,
    failure: {
      assertionText: text,
      reason,
      malformed: true,
      ...(source === undefined ? {} : { source }),
      ...extras,
    },
  });

  if (!/^expect\b/iu.test(text)) {
    return malformed('Expect line must start with "expect".');
  }

  const body = text.replace(/^expect\s+/iu, '').trim();
  if (body.length === 0) {
    return malformed('Missing assertion subject after "expect".');
  }

  const subjectParse = parseSubject(body);
  if (!subjectParse.ok) {
    return malformed(subjectParse.reason);
  }

  const remainder = subjectParse.remainder.trim();
  if (remainder.length === 0) {
    return malformed('Missing assertion operator.');
  }

  const operatorParse = parseOperator(remainder);
  if (!operatorParse.ok) {
    return malformed(operatorParse.reason);
  }

  const operator = operatorParse.operator;
  const valueText = operatorParse.remainder.trim();

  if (UNARY_OPERATORS.has(operator)) {
    if (valueText.length > 0) {
      return malformed(
        `Operator "${operator}" does not take an expected value.`,
        { context: subjectParse.subject.kind },
      );
    }
    return {
      ok: true,
      assertion: {
        text,
        subject: subjectParse.subject,
        operator,
        ...(source === undefined ? {} : { source }),
      },
    };
  }

  if (valueText.length === 0) {
    return malformed(`Operator "${operator}" requires an expected value.`);
  }

  const valueParse = parseValue(valueText);
  if (!valueParse.ok) {
    return malformed(valueParse.reason, {
      expected: valueText,
      context: subjectParse.subject.kind,
    });
  }

  return {
    ok: true,
    assertion: {
      text,
      subject: subjectParse.subject,
      operator,
      expected: valueParse.value,
      ...(source === undefined ? {} : { source }),
    },
  };
}

function parseSubject(
  input: string,
):
  | { readonly ok: true; readonly subject: AssertionSubject; readonly remainder: string }
  | { readonly ok: false; readonly reason: string } {
  const headerMatch = /^header\s+(\S+)(.*)$/iu.exec(input);
  if (headerMatch !== null) {
    return {
      ok: true,
      subject: {
        kind: AssertionSubjectKind.Header,
        headerName: headerMatch[1]!,
      },
      remainder: headerMatch[2] ?? '',
    };
  }

  const tokenMatch = /^([A-Za-z_][\w.-]*(?:\[[^\]]+\])*(?:\.[A-Za-z_][\w.-]*(?:\[[^\]]+\])*)*)(.*)$/u.exec(
    input,
  );
  if (tokenMatch === null) {
    return { ok: false, reason: 'Unable to parse assertion subject.' };
  }

  const token = tokenMatch[1]!;
  const remainder = tokenMatch[2] ?? '';
  const lower = token.toLowerCase();

  if (lower === 'status' || lower === 'statuscode' || lower === 'status-code') {
    return {
      ok: true,
      subject: { kind: AssertionSubjectKind.Status },
      remainder,
    };
  }
  if (
    lower === 'responsetime' ||
    lower === 'response-time' ||
    lower === 'duration' ||
    lower === 'time'
  ) {
    return {
      ok: true,
      subject: { kind: AssertionSubjectKind.ResponseTime },
      remainder,
    };
  }
  if (
    lower === 'contenttype' ||
    lower === 'content-type' ||
    lower === 'content_type'
  ) {
    return {
      ok: true,
      subject: { kind: AssertionSubjectKind.ContentType },
      remainder,
    };
  }
  if (
    lower === 'responsesize' ||
    lower === 'response-size' ||
    lower === 'size' ||
    lower === 'bodysize' ||
    lower === 'body-size'
  ) {
    return {
      ok: true,
      subject: { kind: AssertionSubjectKind.ResponseSize },
      remainder,
    };
  }
  if (lower === 'body' || lower.startsWith('body.')) {
    const path = lower === 'body' ? '' : token.slice('body.'.length);
    return {
      ok: true,
      subject: { kind: AssertionSubjectKind.Body, path },
      remainder,
    };
  }

  return {
    ok: false,
    reason: `Unknown assertion subject "${token}".`,
  };
}

function parseOperator(
  input: string,
):
  | {
      readonly ok: true;
      readonly operator: AssertionOperatorType;
      readonly remainder: string;
    }
  | { readonly ok: false; readonly reason: string } {
  const match =
    /^(==|!=|<>|>=|<=|>|<|=|[A-Za-z_][\w]*)(?:\s+|$)(.*)$/u.exec(input);
  if (match === null) {
    return { ok: false, reason: 'Unable to parse assertion operator.' };
  }
  const raw = match[1]!;
  const mapped = OPERATOR_ALIASES[raw] ?? OPERATOR_ALIASES[raw.toLowerCase()];
  if (mapped === undefined) {
    return { ok: false, reason: `Unknown assertion operator "${raw}".` };
  }
  return {
    ok: true,
    operator: mapped,
    remainder: match[2] ?? '',
  };
}

function parseValue(
  input: string,
):
  | { readonly ok: true; readonly value: AssertionValue }
  | { readonly ok: false; readonly reason: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Missing expected value.' };
  }

  if (trimmed.startsWith('[')) {
    return parseArrayValue(trimmed);
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return {
      ok: true,
      value: unquote(trimmed),
    };
  }

  if (trimmed === 'true') {
    return { ok: true, value: true };
  }
  if (trimmed === 'false') {
    return { ok: true, value: false };
  }
  if (trimmed === 'null') {
    return { ok: true, value: null };
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
    return { ok: true, value: Number(trimmed) };
  }

  // Unquoted tokens are treated as strings (e.g. header value fragments).
  if (/^[^\s[\]]+$/u.test(trimmed)) {
    return { ok: true, value: trimmed };
  }

  return {
    ok: false,
    reason: `Unable to parse expected value "${trimmed}".`,
  };
}

function parseArrayValue(
  input: string,
):
  | { readonly ok: true; readonly value: AssertionValue }
  | { readonly ok: false; readonly reason: string } {
  if (!input.endsWith(']')) {
    return { ok: false, reason: 'Array value is missing a closing ].' };
  }
  const inner = input.slice(1, -1).trim();
  if (inner.length === 0) {
    return { ok: true, value: [] };
  }
  const parts = splitCommaSeparated(inner);
  const values: AssertionValue[] = [];
  for (const part of parts) {
    const parsed = parseValue(part);
    if (!parsed.ok) {
      return parsed;
    }
    values.push(parsed.value);
  }
  return { ok: true, value: values };
}

function splitCommaSeparated(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote !== undefined) {
      current += char;
      if (char === quote && input[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0 || input.endsWith(',')) {
    parts.push(current.trim());
  }
  return parts;
}

function unquote(value: string): string {
  const quote = value[0]!;
  const inner = value.slice(1, -1);
  if (quote === '"') {
    return inner.replace(/\\(["\\/bfnrt])/gu, (_, ch: string) => {
      switch (ch) {
        case '"':
        case '\\':
        case '/':
          return ch;
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        default:
          return ch;
      }
    });
  }
  return inner.replace(/\\'/gu, "'").replace(/\\\\/gu, '\\');
}
