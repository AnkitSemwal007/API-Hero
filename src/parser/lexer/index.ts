import {
  TokenizerDiagnosticCode,
  type TokenizerDiagnostic,
} from '../diagnostics';
import { tokenize, type TokenizeResult } from '../tokenizer';
import { TokenKind, type Token } from '../tokens';
import { HTTP_METHOD_SET } from '../../shared';

type LexicalTokenKind =
  | 'HttpMethod'
  | 'Directive'
  | 'HeaderName'
  | 'HeaderValue'
  | 'Variable'
  | 'String'
  | 'Number'
  | 'Boolean'
  | 'Null'
  | 'Identifier'
  | 'LeftBrace'
  | 'RightBrace'
  | 'LeftBracket'
  | 'RightBracket'
  | 'Colon'
  | 'Comma'
  | 'Comment'
  | 'RequestBoundary'
  | 'Newline'
  | 'Unknown'
  | 'EOF';

type LexerDiagnosticCode =
  | 'unknown-http-method'
  | 'malformed-variable'
  | 'invalid-directive'
  | 'invalid-token-sequence'
  | 'invalid-literal'
  | 'unexpected-character';

type LexerDiagnosticSeverity = 'error' | 'warning';
type LexicalValue = string | number | boolean | null;
type LexerInput = string | TokenizeResult;

interface LexerPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

interface LexerLocation {
  readonly sourceId?: string;
  readonly range: {
    readonly start: LexerPosition;
    readonly end: LexerPosition;
  };
  readonly span: {
    readonly offset: number;
    readonly length: number;
  };
}

/** Options controlling source attribution when lexing source text directly. */
export interface LexerOptions {
  readonly sourceId?: string;
}

/** A recoverable problem encountered while producing lexical tokens. */
export interface LexerDiagnostic {
  readonly code: LexerDiagnosticCode;
  readonly severity: LexerDiagnosticSeverity;
  readonly message: string;
  readonly location: LexerLocation;
  readonly tokenIndex: number;
}

/** A normalized, framework-independent token consumed by a parser. */
export interface LexicalToken {
  readonly kind: LexicalTokenKind;
  readonly raw: string;
  readonly value?: LexicalValue;
  readonly location: LexerLocation;
  readonly diagnostics?: readonly LexerDiagnostic[];
}

/** Complete recoverable output of a lexical pass. */
export interface LexerResult {
  readonly tokens: readonly LexicalToken[];
  readonly diagnostics: readonly LexerDiagnostic[];
}

/**
 * Converts tokenizer output into parser-ready lexical tokens.
 *
 * The lexer performs one forward pass, drops horizontal whitespace, and
 * preserves all recoverable tokens and diagnostics.
 */
export class Lexer {
  public constructor(private readonly options: LexerOptions = {}) {}

  public lex(input: LexerInput): LexerResult {
    const tokenized =
      typeof input === 'string' ? tokenize(input, this.options.sourceId) : input;
    const tokens: LexicalToken[] = [];
    const diagnostics: LexerDiagnostic[] = [];
    const diagnosticsByToken = groupDiagnostics(
      tokenized.tokens,
      tokenized.diagnostics,
    );
    let lineHasContent = false;

    for (let index = 0; index < tokenized.tokens.length; index += 1) {
      const token = tokenized.tokens[index];
      if (token === undefined || token.kind === TokenKind.Whitespace) {
        continue;
      }

      const tokenDiagnostics: LexerDiagnostic[] = [];
      for (const diagnostic of diagnosticsByToken.get(index) ?? []) {
        tokenDiagnostics.push(
          this.convertTokenizerDiagnostic(
            diagnostic,
            tokens.length,
            token,
          ),
        );
      }

      if (
        !lineHasContent &&
        token.kind === TokenKind.Identifier &&
        isMethodCandidate(token.raw)
      ) {
        tokenDiagnostics.push(
          this.createDiagnostic(
            'unknown-http-method',
            'error',
            `Unknown HTTP method "${token.raw}".`,
            token,
            tokens.length,
          ),
        );
      }

      if (token.kind === TokenKind.Parenthesis) {
        tokenDiagnostics.push(
          this.createDiagnostic(
            'invalid-token-sequence',
            'error',
            `Unexpected token "${token.raw}".`,
            token,
            tokens.length,
          ),
        );
      }

      if (
        token.kind === TokenKind.Number &&
        (isAdjacentIdentifier(tokenized.tokens[index + 1], token) ||
          !Number.isFinite(Number(token.raw)))
      ) {
        tokenDiagnostics.push(
          this.createDiagnostic(
            'invalid-literal',
            'error',
            `Invalid numeric literal beginning with "${token.raw}".`,
            token,
            tokens.length,
          ),
        );
      }

      const lexicalToken = this.convertToken(token, tokenDiagnostics);
      tokens.push(lexicalToken);
      diagnostics.push(...tokenDiagnostics);

      if (token.kind === TokenKind.Newline) {
        lineHasContent = false;
      } else if (
        token.kind !== TokenKind.Comment ||
        lexicalToken.kind === 'RequestBoundary'
      ) {
        lineHasContent = true;
      }
    }

    return { tokens, diagnostics };
  }

  private convertToken(
    token: Token,
    diagnostics: readonly LexerDiagnostic[],
  ): LexicalToken {
    const base = {
      raw: token.raw,
      location: token.location,
      diagnostics: diagnostics.length === 0 ? undefined : diagnostics,
    };

    switch (token.kind) {
      case TokenKind.HttpMethod:
        return {
          ...base,
          kind: 'HttpMethod',
          value: (token.normalized ?? token.raw).toUpperCase(),
        };
      case TokenKind.Directive:
        return {
          ...base,
          kind: 'Directive',
          value: (token.normalized ?? token.raw.slice(1)).toLowerCase(),
        };
      case TokenKind.HeaderName:
        return {
          ...base,
          kind: 'HeaderName',
          value: token.normalized ?? token.raw.toLowerCase(),
        };
      case TokenKind.HeaderValue:
        return { ...base, kind: 'HeaderValue', value: token.raw };
      case TokenKind.Variable:
        return {
          ...base,
          kind: 'Variable',
          value: token.normalized ?? variableFallback(token.raw),
        };
      case TokenKind.String:
        return { ...base, kind: 'String', value: decodeString(token.raw) };
      case TokenKind.Number:
        return { ...base, kind: 'Number', value: Number(token.raw) };
      case TokenKind.Boolean:
        return {
          ...base,
          kind: 'Boolean',
          value: (token.normalized ?? token.raw.toLowerCase()) === 'true',
        };
      case TokenKind.Null:
        return { ...base, kind: 'Null', value: null };
      case TokenKind.Identifier:
        return { ...base, kind: 'Identifier', value: token.raw };
      case TokenKind.Brace:
        return {
          ...base,
          kind: token.raw === '{' ? 'LeftBrace' : 'RightBrace',
        };
      case TokenKind.Bracket:
        return {
          ...base,
          kind: token.raw === '[' ? 'LeftBracket' : 'RightBracket',
        };
      case TokenKind.Colon:
        return { ...base, kind: 'Colon' };
      case TokenKind.Comma:
        return { ...base, kind: 'Comma' };
      case TokenKind.Comment:
        return isRequestBoundary(token.raw)
          ? { ...base, kind: 'RequestBoundary', value: token.raw.trim() }
          : { ...base, kind: 'Comment', value: commentValue(token.raw) };
      case TokenKind.Newline:
        return { ...base, kind: 'Newline', value: '\n' };
      case TokenKind.EOF:
        return { ...base, kind: 'EOF' };
      case TokenKind.Parenthesis:
      case TokenKind.Unknown:
        return { ...base, kind: 'Unknown', value: token.raw };
      case TokenKind.Whitespace:
        return { ...base, kind: 'Unknown', value: token.raw };
    }
  }

  private convertTokenizerDiagnostic(
    diagnostic: TokenizerDiagnostic,
    tokenIndex: number,
    token: Token,
  ): LexerDiagnostic {
    let code: LexerDiagnosticCode;
    switch (diagnostic.code) {
      case TokenizerDiagnosticCode.InvalidVariableSyntax:
        code = 'malformed-variable';
        break;
      case TokenizerDiagnosticCode.InvalidEscape:
      case TokenizerDiagnosticCode.UnterminatedString:
        code = 'invalid-literal';
        break;
      case TokenizerDiagnosticCode.UnknownCharacter:
      case TokenizerDiagnosticCode.UnexpectedControlCharacter:
        code = token.raw.startsWith('@')
          ? 'invalid-directive'
          : 'unexpected-character';
        break;
    }

    return {
      code,
      severity: 'error',
      message: diagnostic.message,
      location: diagnostic.location,
      tokenIndex,
    };
  }

  private createDiagnostic(
    code: LexerDiagnosticCode,
    severity: LexerDiagnosticSeverity,
    message: string,
    token: Token,
    tokenIndex: number,
  ): LexerDiagnostic {
    return { code, severity, message, location: token.location, tokenIndex };
  }
}

function isMethodCandidate(raw: string): boolean {
  // Assertion expect-lines are skipped by the parser; do not treat them as
  // unknown HTTP methods (would fail the run as a syntax error).
  if (raw.toLowerCase() === 'expect') {
    return false;
  }
  if (raw.length < 3 || raw.length > 16 || HTTP_METHOD_SET.has(raw.toUpperCase())) {
    return false;
  }
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    if (!isUppercase && !isLowercase) {
      return false;
    }
  }
  return true;
}

function isAdjacentIdentifier(next: Token | undefined, current: Token): boolean {
  return (
    next?.kind === TokenKind.Identifier &&
    current.span.offset + current.span.length === next.span.offset
  );
}

function groupDiagnostics(
  tokens: readonly Token[],
  diagnostics: readonly TokenizerDiagnostic[],
): ReadonlyMap<number, readonly TokenizerDiagnostic[]> {
  const grouped = new Map<number, TokenizerDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const tokenIndex = tokenIndexAtOffset(
      tokens,
      diagnostic.location.span.offset,
    );
    if (tokenIndex < 0) {
      continue;
    }
    const existing = grouped.get(tokenIndex);
    if (existing === undefined) {
      grouped.set(tokenIndex, [diagnostic]);
    } else {
      existing.push(diagnostic);
    }
  }
  return grouped;
}

function tokenIndexAtOffset(tokens: readonly Token[], offset: number): number {
  let low = 0;
  let high = tokens.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const token = tokens[middle];
    if (token === undefined) {
      return -1;
    }
    if (offset < token.span.offset) {
      high = middle - 1;
    } else if (offset >= token.span.offset + token.span.length) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return -1;
}

function variableFallback(raw: string): string {
  const end = raw.endsWith('}}') ? raw.length - 2 : raw.length;
  return raw.slice(2, end).trim();
}

function decodeString(raw: string): string {
  if (raw.length < 2) {
    return '';
  }
  const quote = raw[0];
  const terminated = raw[raw.length - 1] === quote;
  const content = raw.slice(1, terminated ? -1 : undefined);
  let value = '';
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? '';
    if (character !== '\\' || index + 1 >= content.length) {
      value += character;
      continue;
    }
    const escaped = content[index + 1] ?? '';
    index += 1;
    if (escaped === 'u' && index + 4 < content.length) {
      const hexadecimal = content.slice(index + 1, index + 5);
      const codePoint = Number.parseInt(hexadecimal, 16);
      if (!Number.isNaN(codePoint)) {
        value += String.fromCharCode(codePoint);
        index += 4;
        continue;
      }
    }
    value += escapeValue(escaped);
  }
  return value;
}

function escapeValue(character: string): string {
  switch (character) {
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return character;
  }
}

function isRequestBoundary(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 3) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '#') {
      return false;
    }
  }
  return true;
}

function commentValue(raw: string): string {
  const markerLength = raw.startsWith('//') ? 2 : 1;
  return raw.slice(markerLength).trim();
}
