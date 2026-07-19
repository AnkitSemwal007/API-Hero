import type { ApiDocument, RequestNode } from '../parser';
import type { Range } from '../parser/types';

export type RequestSelectionErrorCode =
  | 'INVALID_POSITION'
  | 'INVALID_RANGES'
  | 'NO_REQUEST'
  | 'AMBIGUOUS_REQUEST';

/** Friendly, framework-neutral failure produced while locating a request. */
export class RequestSelectionError extends Error {
  public constructor(
    public readonly code: RequestSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RequestSelectionError';
  }
}

export interface SelectedRequest {
  readonly request: RequestNode;
  readonly index: number;
  readonly block: number;
  readonly blockRange: Range;
}

/**
 * Selects the one canonical request in the parser block containing `offset`.
 *
 * Parser-provided request boundary metadata defines blocks. Separator ranges
 * themselves are intentionally not part of either adjacent block.
 */
export function selectRequestAtOffset(
  document: ApiDocument,
  offset: number,
): SelectedRequest {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > document.range.end.offset) {
    throw new RequestSelectionError(
      'INVALID_POSITION',
      'The request position is outside the current document.',
    );
  }

  assertRange(document.range, 'document');
  const boundaries = requestBoundaries(document);
  const block = blockAtOffset(document.range, boundaries, offset);
  if (block === undefined) {
    throw new RequestSelectionError(
      'NO_REQUEST',
      'Place the cursor inside a request block and try again.',
    );
  }

  const candidates = document.requests
    .map((request, index) => ({ request, index }))
    .filter(({ request, index }) => requestBlock(request, index) === block.index);

  if (candidates.length === 0) {
    throw new RequestSelectionError(
      'NO_REQUEST',
      'The selected block does not contain a request.',
    );
  }
  if (candidates.length !== 1) {
    throw new RequestSelectionError(
      'AMBIGUOUS_REQUEST',
      'The selected block contains multiple request declarations. Add request separators so exactly one request remains in the block.',
    );
  }

  const selected = candidates[0]!;
  assertRange(selected.request.range, 'request');
  if (
    selected.request.range.start.offset < block.range.start.offset ||
    selected.request.range.end.offset > block.range.end.offset
  ) {
    throw new RequestSelectionError(
      'INVALID_RANGES',
      'The parsed request ranges are inconsistent with request block boundaries.',
    );
  }
  return Object.freeze({
    request: selected.request,
    index: selected.index,
    block: block.index,
    blockRange: block.range,
  });
}

function requestBoundaries(document: ApiDocument): readonly Range[] {
  const value = document.metadata.requestBoundaries;
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidRanges();
  }
  const boundaries = value as readonly Range[];
  let previousEnd = document.range.start.offset;
  for (const boundary of boundaries) {
    assertRange(boundary, 'request boundary');
    if (
      boundary.start.offset < previousEnd ||
      boundary.start.offset < document.range.start.offset ||
      boundary.end.offset > document.range.end.offset
    ) {
      throw invalidRanges();
    }
    previousEnd = boundary.end.offset;
  }
  return boundaries;
}

function blockAtOffset(
  documentRange: Range,
  boundaries: readonly Range[],
  offset: number,
): { readonly index: number; readonly range: Range } | undefined {
  let start = documentRange.start;
  for (const [index, boundary] of boundaries.entries()) {
    if (offset >= boundary.start.offset && offset < boundary.end.offset) {
      return undefined;
    }
    if (offset < boundary.start.offset) {
      return { index, range: { start, end: boundary.start } };
    }
    start = boundary.end;
  }
  return {
    index: boundaries.length,
    range: { start, end: documentRange.end },
  };
}

function requestBlock(request: RequestNode, fallback: number): number {
  const value = request.metadata.requestBlock;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function assertRange(range: Range, label: string): void {
  if (
    !Number.isSafeInteger(range.start.offset) ||
    !Number.isSafeInteger(range.end.offset) ||
    range.start.offset < 0 ||
    range.end.offset < range.start.offset
  ) {
    throw new RequestSelectionError(
      'INVALID_RANGES',
      `The parsed ${label} range is invalid.`,
    );
  }
}

function invalidRanges(): RequestSelectionError {
  return new RequestSelectionError(
    'INVALID_RANGES',
    'The parsed request boundary metadata is invalid.',
  );
}
