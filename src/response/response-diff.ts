/**
 * Framework-free response diff over already-redacted {@link ResponsePresentation}
 * models. Never accepts RuntimeResponse. Extra body-token scrub before compare.
 */

import {
  scrubBodyTextForDisplay,
  scrubJsonSecrets,
} from '../shared/secret-scrub';
import type {
  PresentedHeader,
  ResponseBodyPresentation,
  ResponsePresentation,
} from './presentation';

/** Soft caps so large bodies stay interactive. */
export const RESPONSE_DIFF_MAX_JSON_CHANGES = 2_000;
export const RESPONSE_DIFF_MAX_TEXT_LINES = 2_000;
export const RESPONSE_DIFF_MAX_DEPTH = 64;

export type ResponseDiffChangeKind =
  | 'status'
  | 'header'
  | 'json'
  | 'text'
  | 'meta';

export type ResponseDiffChangeType =
  | 'changed'
  | 'added'
  | 'removed'
  | 'identical';

export interface ResponseDiffChange {
  readonly kind: ResponseDiffChangeKind;
  readonly change: ResponseDiffChangeType;
  /** JSON path (`$.user.active`), header name, or line label. */
  readonly path?: string;
  readonly left?: string;
  readonly right?: string;
  /** Human-readable line, e.g. `Changed $.user.active: false → true`. */
  readonly summary: string;
}

export interface ResponseDiffResult {
  readonly identical: boolean;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly changes: readonly ResponseDiffChange[];
  /** Compact summary lines (status / headers / body). */
  readonly summaryLines: readonly string[];
  /** True when JSON/text change lists were truncated for performance. */
  readonly truncated?: boolean;
}

export interface ResponseDiffOptions {
  /** Side A label. Default `Previous` / `A`. */
  readonly leftLabel?: string;
  /** Side B label. Default `Current` / `B`. */
  readonly rightLabel?: string;
}

/**
 * Compares two presentation models (Previous/A vs Current/B).
 * Both sides are scrubbed again before body compare (defense in depth).
 */
export function responseDiff(
  left: ResponsePresentation,
  right: ResponsePresentation,
  options: ResponseDiffOptions = {},
): ResponseDiffResult {
  const leftLabel = options.leftLabel?.trim() || 'Previous';
  const rightLabel = options.rightLabel?.trim() || 'Current';
  const changes: ResponseDiffChange[] = [];
  let truncated = false;

  const statusChange = diffStatus(left, right);
  if (statusChange !== undefined) {
    changes.push(statusChange);
  }

  const headerChanges = diffHeaders(left.headers, right.headers);
  changes.push(...headerChanges);

  const bodyResult = diffBodies(left.body, right.body);
  changes.push(...bodyResult.changes);
  if (bodyResult.truncated) {
    truncated = true;
  }

  const meaningful = changes.filter((entry) => entry.change !== 'identical');
  const identical = meaningful.length === 0;
  const summaryLines = buildSummaryLines(
    leftLabel,
    rightLabel,
    statusChange,
    headerChanges,
    bodyResult.changes,
    identical,
  );

  return Object.freeze({
    identical,
    leftLabel,
    rightLabel,
    changes: Object.freeze(meaningful.length > 0 ? meaningful : changes),
    summaryLines: Object.freeze(summaryLines),
    ...(truncated ? { truncated: true } : {}),
  });
}

function diffStatus(
  left: ResponsePresentation,
  right: ResponsePresentation,
): ResponseDiffChange | undefined {
  const leftCode = left.status?.code;
  const rightCode = right.status?.code;
  const leftText = left.status?.text ?? '';
  const rightText = right.status?.text ?? '';
  if (leftCode === rightCode && leftText === rightText) {
    if (leftCode === undefined && rightCode === undefined) {
      return undefined;
    }
    return {
      kind: 'status',
      change: 'identical',
      path: 'status',
      left: formatStatus(leftCode, leftText),
      right: formatStatus(rightCode, rightText),
      summary: `Status unchanged: ${formatStatus(leftCode, leftText)}`,
    };
  }
  return {
    kind: 'status',
    change: 'changed',
    path: 'status',
    left: formatStatus(leftCode, leftText),
    right: formatStatus(rightCode, rightText),
    summary: `Changed status: ${formatStatus(leftCode, leftText)} → ${formatStatus(rightCode, rightText)}`,
  };
}

function formatStatus(code: number | undefined, text: string): string {
  if (code === undefined) {
    return text.length > 0 ? text : '(none)';
  }
  return text.length > 0 ? `${code} ${text}` : String(code);
}

function diffHeaders(
  left: readonly PresentedHeader[],
  right: readonly PresentedHeader[],
): ResponseDiffChange[] {
  const leftMap = headerMap(left);
  const rightMap = headerMap(right);
  const names = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const ordered = [...names].sort((a, b) => a.localeCompare(b));
  const changes: ResponseDiffChange[] = [];
  for (const name of ordered) {
    const leftValue = leftMap.get(name);
    const rightValue = rightMap.get(name);
    if (leftValue === undefined && rightValue !== undefined) {
      changes.push({
        kind: 'header',
        change: 'added',
        path: `header:${name}`,
        right: rightValue,
        summary: `Added header ${name}: ${rightValue}`,
      });
      continue;
    }
    if (leftValue !== undefined && rightValue === undefined) {
      changes.push({
        kind: 'header',
        change: 'removed',
        path: `header:${name}`,
        left: leftValue,
        summary: `Removed header ${name}: ${leftValue}`,
      });
      continue;
    }
    if (leftValue !== rightValue) {
      changes.push({
        kind: 'header',
        change: 'changed',
        path: `header:${name}`,
        left: leftValue,
        right: rightValue,
        summary: `Changed header ${name}: ${leftValue} → ${rightValue}`,
      });
    }
  }
  return changes;
}

function headerMap(
  headers: readonly PresentedHeader[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers) {
    const key = header.name.toLowerCase();
    const existing = map.get(key);
    // Preserve presentation values (already masked for sensitive names).
    map.set(
      key,
      existing === undefined ? header.value : `${existing}\n${header.value}`,
    );
  }
  return map;
}

interface BodyDiffResult {
  readonly changes: readonly ResponseDiffChange[];
  readonly truncated: boolean;
}

function diffBodies(
  left: ResponseBodyPresentation | undefined,
  right: ResponseBodyPresentation | undefined,
): BodyDiffResult {
  if (left === undefined && right === undefined) {
    return { changes: [], truncated: false };
  }
  if (left === undefined && right !== undefined) {
    return {
      changes: [
        {
          kind: 'meta',
          change: 'added',
          path: 'body',
          right: bodyPreview(right),
          summary: 'Added response body',
        },
      ],
      truncated: false,
    };
  }
  if (left !== undefined && right === undefined) {
    return {
      changes: [
        {
          kind: 'meta',
          change: 'removed',
          path: 'body',
          left: bodyPreview(left),
          summary: 'Removed response body',
        },
      ],
      truncated: false,
    };
  }

  const leftBody = left!;
  const rightBody = right!;
  const leftScrubbed = scrubBodySource(leftBody);
  const rightScrubbed = scrubBodySource(rightBody);

  const bothJson =
    leftBody.language === 'json'
    && rightBody.language === 'json'
    && !leftBody.truncated
    && !rightBody.truncated;

  if (bothJson) {
    const leftParsed = tryParseJson(leftScrubbed);
    const rightParsed = tryParseJson(rightScrubbed);
    if (leftParsed.ok && rightParsed.ok) {
      const jsonChanges: ResponseDiffChange[] = [];
      let truncated = false;
      walkJsonDiff(
        leftParsed.value,
        rightParsed.value,
        '$',
        0,
        jsonChanges,
        () => {
          truncated = true;
        },
      );
      if (jsonChanges.length === 0) {
        return {
          changes: [
            {
              kind: 'json',
              change: 'identical',
              path: '$',
              summary: 'JSON body unchanged',
            },
          ],
          truncated: false,
        };
      }
      return { changes: jsonChanges, truncated };
    }
  }

  // Binary / unsupported / non-JSON → text (or hex) line diff — never force JSON.
  if (leftBody.language === 'binary' || rightBody.language === 'binary') {
    if (leftScrubbed === rightScrubbed) {
      return {
        changes: [
          {
            kind: 'text',
            change: 'identical',
            path: 'body',
            summary: 'Binary body unchanged',
          },
        ],
        truncated: false,
      };
    }
    return {
      changes: [
        {
          kind: 'text',
          change: 'changed',
          path: 'body',
          left: leftScrubbed.slice(0, 200),
          right: rightScrubbed.slice(0, 200),
          summary: 'Changed binary body (hex preview)',
        },
      ],
      truncated: false,
    };
  }

  return diffTextBodies(leftScrubbed, rightScrubbed);
}

function scrubBodySource(body: ResponseBodyPresentation): string {
  const source = body.prettyAvailable ? body.pretty : body.raw;
  if (body.language === 'binary') {
    return source;
  }
  return scrubBodyTextForDisplay(source, body.prettyAvailable);
}

function bodyPreview(body: ResponseBodyPresentation): string {
  const source = scrubBodySource(body);
  return source.length > 120 ? `${source.slice(0, 120)}…` : source;
}

function tryParseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: scrubJsonSecrets(JSON.parse(text) as unknown) };
  } catch {
    return { ok: false };
  }
}

function walkJsonDiff(
  left: unknown,
  right: unknown,
  path: string,
  depth: number,
  out: ResponseDiffChange[],
  onTruncate: () => void,
): void {
  if (out.length >= RESPONSE_DIFF_MAX_JSON_CHANGES) {
    onTruncate();
    return;
  }
  if (depth > RESPONSE_DIFF_MAX_DEPTH) {
    if (!jsonEqual(left, right)) {
      out.push({
        kind: 'json',
        change: 'changed',
        path,
        left: formatJsonScalar(left),
        right: formatJsonScalar(right),
        summary: `Changed ${path}: (max depth)`,
      });
    }
    return;
  }

  if (jsonEqual(left, right)) {
    return;
  }

  const leftObj = isPlainObject(left);
  const rightObj = isPlainObject(right);
  if (leftObj && rightObj) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord),
    ]);
    for (const key of [...keys].sort()) {
      if (out.length >= RESPONSE_DIFF_MAX_JSON_CHANGES) {
        onTruncate();
        return;
      }
      const childPath = `${path}.${escapeJsonKey(key)}`;
      const hasLeft = Object.prototype.hasOwnProperty.call(leftRecord, key);
      const hasRight = Object.prototype.hasOwnProperty.call(rightRecord, key);
      if (!hasLeft && hasRight) {
        out.push({
          kind: 'json',
          change: 'added',
          path: childPath,
          right: formatJsonScalar(rightRecord[key]),
          summary: `Added ${childPath}`,
        });
        continue;
      }
      if (hasLeft && !hasRight) {
        out.push({
          kind: 'json',
          change: 'removed',
          path: childPath,
          left: formatJsonScalar(leftRecord[key]),
          summary: `Removed ${childPath}`,
        });
        continue;
      }
      walkJsonDiff(
        leftRecord[key],
        rightRecord[key],
        childPath,
        depth + 1,
        out,
        onTruncate,
      );
    }
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const max = Math.max(left.length, right.length);
    for (let index = 0; index < max; index += 1) {
      if (out.length >= RESPONSE_DIFF_MAX_JSON_CHANGES) {
        onTruncate();
        return;
      }
      const childPath = `${path}[${index}]`;
      if (index >= left.length) {
        out.push({
          kind: 'json',
          change: 'added',
          path: childPath,
          right: formatJsonScalar(right[index]),
          summary: `Added ${childPath}`,
        });
        continue;
      }
      if (index >= right.length) {
        out.push({
          kind: 'json',
          change: 'removed',
          path: childPath,
          left: formatJsonScalar(left[index]),
          summary: `Removed ${childPath}`,
        });
        continue;
      }
      walkJsonDiff(left[index], right[index], childPath, depth + 1, out, onTruncate);
    }
    return;
  }

  out.push({
    kind: 'json',
    change: 'changed',
    path,
    left: formatJsonScalar(left),
    right: formatJsonScalar(right),
    summary: `Changed ${path}: ${formatJsonScalar(left)} → ${formatJsonScalar(right)}`,
  });
}

function diffTextBodies(left: string, right: string): BodyDiffResult {
  if (left === right) {
    return {
      changes: [
        {
          kind: 'text',
          change: 'identical',
          path: 'body',
          summary: 'Body text unchanged',
        },
      ],
      truncated: false,
    };
  }

  const leftLines = left.split(/\r?\n/u);
  const rightLines = right.split(/\r?\n/u);
  const truncated =
    leftLines.length > RESPONSE_DIFF_MAX_TEXT_LINES
    || rightLines.length > RESPONSE_DIFF_MAX_TEXT_LINES;
  const leftSlice = leftLines.slice(0, RESPONSE_DIFF_MAX_TEXT_LINES);
  const rightSlice = rightLines.slice(0, RESPONSE_DIFF_MAX_TEXT_LINES);
  const max = Math.max(leftSlice.length, rightSlice.length);
  const changes: ResponseDiffChange[] = [];

  for (let index = 0; index < max; index += 1) {
    const leftLine = leftSlice[index];
    const rightLine = rightSlice[index];
    const path = `body:line ${index + 1}`;
    if (leftLine === undefined && rightLine !== undefined) {
      changes.push({
        kind: 'text',
        change: 'added',
        path,
        right: rightLine,
        summary: `Added ${path}: ${truncateLine(rightLine)}`,
      });
      continue;
    }
    if (leftLine !== undefined && rightLine === undefined) {
      changes.push({
        kind: 'text',
        change: 'removed',
        path,
        left: leftLine,
        summary: `Removed ${path}: ${truncateLine(leftLine)}`,
      });
      continue;
    }
    if (leftLine !== rightLine) {
      changes.push({
        kind: 'text',
        change: 'changed',
        path,
        left: leftLine,
        right: rightLine,
        summary: `Changed ${path}: ${truncateLine(leftLine ?? '')} → ${truncateLine(rightLine ?? '')}`,
      });
    }
  }

  if (changes.length === 0) {
    return {
      changes: [
        {
          kind: 'text',
          change: 'changed',
          path: 'body',
          summary: truncated
            ? 'Body text differs beyond compared line budget'
            : 'Body text changed',
        },
      ],
      truncated,
    };
  }
  return { changes, truncated };
}

function buildSummaryLines(
  leftLabel: string,
  rightLabel: string,
  status: ResponseDiffChange | undefined,
  headers: readonly ResponseDiffChange[],
  body: readonly ResponseDiffChange[],
  identical: boolean,
): string[] {
  const lines = [`${leftLabel} vs ${rightLabel}`];
  if (identical) {
    lines.push('No differences');
    return lines;
  }
  if (status !== undefined && status.change !== 'identical') {
    lines.push(status.summary);
  }
  const headerDiffs = headers.filter((entry) => entry.change !== 'identical');
  if (headerDiffs.length > 0) {
    lines.push(
      `${headerDiffs.length} header change${headerDiffs.length === 1 ? '' : 's'}`,
    );
  }
  const bodyDiffs = body.filter((entry) => entry.change !== 'identical');
  if (bodyDiffs.length > 0) {
    const preview = bodyDiffs.slice(0, 8).map((entry) => entry.summary);
    lines.push(...preview);
    if (bodyDiffs.length > 8) {
      lines.push(`…and ${bodyDiffs.length - 8} more body change(s)`);
    }
  }
  return lines;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (typeof left !== 'object') {
    return left === right;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function formatJsonScalar(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value.length > 80 ? `${JSON.stringify(value.slice(0, 80))}…` : JSON.stringify(value);
  }
  try {
    const text = JSON.stringify(value);
    if (text === undefined) {
      return String(value);
    }
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return String(value);
  }
}

function escapeJsonKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? key : JSON.stringify(key);
}

function truncateLine(line: string): string {
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}
