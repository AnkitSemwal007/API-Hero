import type { ApiDocument, Range } from '../parser';
import { parseExpectLine } from './parse-expect';
import {
  freezeAssertionSuite,
  type Assertion,
  type AssertionFailure,
  type AssertionSourceLocation,
  type AssertionSuite,
} from './models';

export interface ExtractedExpectLine {
  readonly lineNumber: number;
  readonly text: string;
  readonly range: Range;
  readonly parse:
    | { readonly ok: true; readonly assertion: Omit<Assertion, 'id'> }
    | { readonly ok: false; readonly failure: AssertionFailure };
}

export interface RequestAssertionExtraction {
  readonly requestIndex: number;
  readonly requestRange: Range;
  readonly suite: AssertionSuite;
  /** Malformed expect lines retained for evaluation as AssertionResult.malformed. */
  readonly malformed: readonly AssertionFailure[];
  readonly lines: readonly ExtractedExpectLine[];
}

export interface ExtractAssertionsOptions {
  readonly sourceId?: string;
  readonly requestIdFor?: (requestIndex: number) => string | undefined;
}

/**
 * Association rule (documented also in docs/architecture/assertions.md):
 *
 * Each request owns lines from its AST `range.start` up to (but not including)
 * the next request's `range.start` (or EOF). Within that zone, non-comment
 * lines whose first token is `expect` are associated with the request.
 * Separator lines (`###`) and blank lines are ignored. Expect lines before the
 * first request are ignored.
 *
 * The parser skips `expect` lines so they are not headers/body (additive
 * request-loop handling — no grammar overhaul). The lexer also excludes
 * `expect` from unknown-HTTP-method diagnostics. The extractor still uses
 * source text + request ranges for association.
 */
export function extractAssertionsForDocument(
  document: ApiDocument,
  sourceText: string,
  options: ExtractAssertionsOptions = {},
): readonly RequestAssertionExtraction[] {
  const lineStarts = buildLineStarts(sourceText);
  const extracted: RequestAssertionExtraction[] = [];

  for (let index = 0; index < document.requests.length; index += 1) {
    const request = document.requests[index]!;
    const zoneStart = request.range.start.offset;
    const zoneEnd =
      index + 1 < document.requests.length
        ? document.requests[index + 1]!.range.start.offset
        : sourceText.length;
    const zone = sourceText.slice(zoneStart, zoneEnd);
    const lines = collectExpectLines(
      zone,
      zoneStart,
      lineStarts,
      options.sourceId,
    );

    const assertions: Assertion[] = [];
    const malformed: AssertionFailure[] = [];
    let assertionOrdinal = 0;
    for (const line of lines) {
      if (line.parse.ok) {
        assertionOrdinal += 1;
        assertions.push({
          ...line.parse.assertion,
          id: `assert_${index}_${assertionOrdinal}`,
        });
      } else {
        malformed.push(line.parse.failure);
      }
    }

    const requestId = options.requestIdFor?.(index);
    extracted.push({
      requestIndex: index,
      requestRange: request.range,
      suite: freezeAssertionSuite({
        ...(requestId === undefined ? {} : { requestId }),
        assertions,
        ...(options.sourceId === undefined
          ? {}
          : { sourceId: options.sourceId }),
      }),
      malformed,
      lines,
    });
  }

  return extracted;
}

/**
 * Extracts assertions for the request whose range contains `offset`, or whose
 * post-range gap contains `offset`.
 */
export function extractAssertionsForOffset(
  document: ApiDocument,
  sourceText: string,
  offset: number,
  options: ExtractAssertionsOptions = {},
): RequestAssertionExtraction | undefined {
  const all = extractAssertionsForDocument(document, sourceText, options);
  for (let index = 0; index < document.requests.length; index += 1) {
    const request = document.requests[index]!;
    const nextStart =
      index + 1 < document.requests.length
        ? document.requests[index + 1]!.range.start.offset
        : sourceText.length;
    if (
      offset >= request.range.start.offset &&
      offset < nextStart
    ) {
      return all[index];
    }
  }
  return undefined;
}

function collectExpectLines(
  zone: string,
  zoneStartOffset: number,
  lineStarts: readonly number[],
  sourceId: string | undefined,
): ExtractedExpectLine[] {
  const results: ExtractedExpectLine[] = [];
  let cursor = 0;
  while (cursor <= zone.length) {
    const nextBreak = zone.indexOf('\n', cursor);
    const end = nextBreak === -1 ? zone.length : nextBreak;
    let line = zone.slice(cursor, end);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    const absoluteOffset = zoneStartOffset + cursor;
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith('#') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('###');
    if (!isComment && /^expect\b/iu.test(trimmed)) {
      const leading = line.match(/^\s*/u)?.[0]?.length ?? 0;
      const lineIndex = lineIndexAt(lineStarts, absoluteOffset);
      const startColumn = absoluteOffset - lineStarts[lineIndex]! + leading;
      const range: Range = {
        start: {
          line: lineIndex,
          column: startColumn,
          offset: absoluteOffset + leading,
        },
        end: {
          line: lineIndex,
          column: startColumn + trimmed.length,
          offset: absoluteOffset + leading + trimmed.length,
        },
      };
      const source: AssertionSourceLocation = {
        ...(sourceId === undefined ? {} : { uri: sourceId }),
        range,
        lineText: trimmed,
      };
      const parse = parseExpectLine(trimmed, source);
      results.push({
        lineNumber: lineIndex,
        text: trimmed,
        range,
        parse,
      });
    }
    if (nextBreak === -1) {
      break;
    }
    cursor = nextBreak + 1;
  }
  return results;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineIndexAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid]!;
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
    } else if (offset >= next) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, lineStarts.length - 1);
}
