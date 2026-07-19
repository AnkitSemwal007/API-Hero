/**
 * A character range on one zero-based document line.
 *
 * @deprecated Part of the temporary line-analysis model. New feature code
 * should use parser `Range` values from the canonical AST.
 */
export interface LineSpan {
  readonly line: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
}

/**
 * A request declaration and its lightweight block boundaries.
 *
 * @deprecated Use `RequestNode` from the canonical `ApiDocument`.
 */
export interface RequestLine {
  readonly line: number;
  readonly method: string;
  readonly url: string;
  readonly name?: string;
  readonly blockStartLine: number;
  readonly blockEndLine: number;
}

/**
 * A framework-neutral issue found by line-based validation.
 *
 * @deprecated Use `AstDiagnostic` from the canonical parser result.
 */
export interface LanguageDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly span: LineSpan;
}

/**
 * A framework-neutral foldable line range.
 *
 * @deprecated Retained only for compatibility. Runtime folding derives ranges
 * from the canonical `ApiDocument`.
 */
export interface FoldRegion {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: 'request' | 'directives' | 'json';
}

/**
 * Combined result of legacy lightweight API document analysis.
 *
 * @deprecated Retained only for compatibility. Runtime providers consume
 * `ParserResult` and its canonical `ApiDocument`.
 */
export interface LineAnalysis {
  readonly requests: readonly RequestLine[];
  readonly diagnostics: readonly LanguageDiagnostic[];
  readonly folds: readonly FoldRegion[];
}
