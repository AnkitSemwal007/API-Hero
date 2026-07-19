import { parseApiDocument } from '../parser';
import type { Range } from '../parser/types';
import type { RequestNode } from '../parser';
import { deepFreeze } from '../shared';

export interface ParsedRequestSummary {
  readonly index: number;
  readonly method: string;
  readonly url: string;
  readonly label: string;
  readonly range: Range;
}

export interface ApiFileParseResult {
  readonly requests: readonly ParsedRequestSummary[];
  readonly error?: string;
}

interface CacheEntry {
  readonly mtimeMs: number | undefined;
  readonly result: ApiFileParseResult;
}

/**
 * Parses `.api` files for tree labels and ranges, caching by path + mtime.
 * Reuses `parseApiDocument` only — never reimplements request detection.
 */
export class ApiFileParseCache {
  private readonly entries = new Map<string, CacheEntry>();

  public getOrParse(
    path: string,
    text: string,
    mtimeMs: number | undefined,
  ): ApiFileParseResult {
    const cached = this.entries.get(path);
    if (
      cached !== undefined &&
      cached.mtimeMs === mtimeMs &&
      mtimeMs !== undefined
    ) {
      return cached.result;
    }
    const result = parseApiFileRequests(text, path);
    this.entries.set(path, { mtimeMs, result });
    return result;
  }

  public invalidate(path: string): void {
    this.entries.delete(path);
  }

  public invalidateAll(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}

/** Projects request summaries from source text without a cache. */
export function parseApiFileRequests(
  text: string,
  sourceId: string,
): ApiFileParseResult {
  try {
    const parsed = parseApiDocument(text, { sourceId });
    const requests = parsed.ast.requests.map((request, index, all) =>
      summarizeRequest(request, index, all, parsed.ast.directives, text),
    );
    return deepFreeze({ requests });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to parse API document.';
    return deepFreeze({ requests: [], error: message });
  }
}

function summarizeRequest(
  request: RequestNode,
  index: number,
  all: readonly RequestNode[],
  documentDirectives: readonly {
    readonly knownName?: string;
    readonly value: string;
    readonly range: Range;
  }[],
  source: string,
): ParsedRequestSummary {
  const lines = source.split(/\r?\n/);
  const previous = all[index - 1];
  const blockStartLine = findBlockStartLine(
    lines,
    previous?.range.end.line ?? -1,
    request.range.start.line,
  );
  const precedingName = documentDirectives
    .filter(
      (directive) =>
        directive.knownName === 'name' &&
        directive.range.start.line >= blockStartLine &&
        directive.range.end.offset <= request.range.start.offset,
    )
    .at(-1)?.value;
  const followingName = request.directives.find(
    (directive) => directive.knownName === 'name',
  )?.value;
  const label =
    precedingName ??
    followingName ??
    `${request.method} ${request.url}`.trim();

  return {
    index,
    method: request.method,
    url: request.url,
    label,
    range: request.range,
  };
}

function findBlockStartLine(
  lines: readonly string[],
  previousRequestEndLine: number,
  requestLine: number,
): number {
  let startLine = previousRequestEndLine + 1;
  for (let line = requestLine - 1; line >= startLine; line -= 1) {
    if (isRequestBoundary(lines[line] ?? '')) {
      startLine = line + 1;
      break;
    }
  }
  return Math.min(startLine, requestLine);
}

function isRequestBoundary(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('###') &&
    (trimmed.length === 3 || isWhitespace(trimmed[3] ?? ''))
  );
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t';
}
