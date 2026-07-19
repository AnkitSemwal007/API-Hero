import type { Location, Position, Span } from '../types';

/** Stable kinds emitted by the tokenizer. */
export enum TokenKind {
  HttpMethod = 'HttpMethod',
  Identifier = 'Identifier',
  Directive = 'Directive',
  HeaderName = 'HeaderName',
  HeaderValue = 'HeaderValue',
  Variable = 'Variable',
  String = 'String',
  Number = 'Number',
  Boolean = 'Boolean',
  Null = 'Null',
  Colon = 'Colon',
  Comma = 'Comma',
  Brace = 'Brace',
  Bracket = 'Bracket',
  Parenthesis = 'Parenthesis',
  Comment = 'Comment',
  Whitespace = 'Whitespace',
  Newline = 'Newline',
  Unknown = 'Unknown',
  EOF = 'EOF',
}

/** Optional tokenizer metadata attached to a token involved in a diagnostic. */
export interface TokenDiagnosticMetadata {
  readonly code: string;
  readonly message: string;
}

/** An immutable lexical token with half-open UTF-16 source coordinates. */
export interface Token {
  readonly kind: TokenKind;
  readonly raw: string;
  readonly normalized?: string;
  readonly start: Position;
  readonly end: Position;
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly span: Span;
  readonly location: Location;
  readonly diagnostic?: TokenDiagnosticMetadata;
}
