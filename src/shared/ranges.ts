/** Offset-based source range used by parser and orchestration helpers. */
export interface OffsetRange {
  readonly start: { readonly offset: number };
  readonly end: { readonly offset: number };
}

/**
 * Returns true when two offset ranges overlap.
 * A zero-width (point) range overlaps when its offset lies within the other
 * range inclusive of both endpoints.
 */
export function rangesOverlap(left: OffsetRange, right: OffsetRange): boolean {
  if (left.start.offset === left.end.offset) {
    return (
      left.start.offset >= right.start.offset &&
      left.start.offset <= right.end.offset
    );
  }
  if (right.start.offset === right.end.offset) {
    return (
      right.start.offset >= left.start.offset &&
      right.start.offset <= left.end.offset
    );
  }
  return (
    left.start.offset < right.end.offset &&
    right.start.offset < left.end.offset
  );
}
