/**
 * A zero-based position in source text.
 *
 * `offset` and `column` are measured in UTF-16 code units, matching JavaScript
 * string indexing. Lines and columns are zero-based.
 */
export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** A half-open source range whose `end` position is excluded. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/** A half-open UTF-16 offset span. */
export interface Span {
  readonly offset: number;
  readonly length: number;
}

/** A source range, optionally associated with a caller-provided source ID. */
export interface Location {
  readonly sourceId?: string;
  readonly range: Range;
  readonly span: Span;
}
