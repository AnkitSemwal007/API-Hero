import type { Location, Range } from '../types';

/** Severity of a tokenizer diagnostic. */
export enum TokenizerDiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
}

/** Stable machine-readable tokenizer diagnostic codes. */
export enum TokenizerDiagnosticCode {
  UnknownCharacter = 'unknown-character',
  UnterminatedString = 'unterminated-string',
  InvalidEscape = 'invalid-escape',
  InvalidVariableSyntax = 'invalid-variable-syntax',
  UnexpectedControlCharacter = 'unexpected-control-character',
}

/** A non-destructive edit suggested for a tokenizer diagnostic. */
export interface TokenizerSuggestedFix {
  readonly message: string;
  readonly range: Range;
  readonly replacement: string;
}

/** A framework-neutral problem found while tokenizing source text. */
export interface TokenizerDiagnostic {
  readonly severity: TokenizerDiagnosticSeverity;
  readonly message: string;
  readonly range: Range;
  readonly location: Location;
  readonly code: TokenizerDiagnosticCode;
  readonly suggestedFix?: TokenizerSuggestedFix;
}
