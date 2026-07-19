/**
 * Source range represented by zero-based offsets.
 *
 * @deprecated Use `Range` from the parser public API. Canonical AST ranges
 * include offsets, lines, and columns.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Kinds of nodes that may appear in the legacy parser tree.
 *
 * @deprecated Use `AstNodeType` and `AstNode` from the parser public API.
 */
export type ParserAstNodeKind =
  | 'document'
  | 'request'
  | 'header'
  | 'body'
  | 'variable'
  | 'comment';

/**
 * A single immutable node in the legacy parser tree.
 *
 * @deprecated Use `AstNode` from the parser public API.
 */
export interface ParserAstNode {
  readonly kind: ParserAstNodeKind;
  readonly range: SourceRange;
  readonly value?: string;
  readonly children?: readonly ParserAstNode[];
}

/**
 * Root model produced by the legacy parser contract.
 *
 * @deprecated Use the canonical `ApiDocument` returned by
 * `parseApiDocument`.
 */
export interface ParserAst {
  readonly sourceId: string;
  readonly root: ParserAstNode;
}
