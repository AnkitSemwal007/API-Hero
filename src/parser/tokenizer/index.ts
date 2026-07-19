import {
  TokenizerDiagnosticCode,
  TokenizerDiagnosticSeverity,
  type TokenizerDiagnostic,
} from '../diagnostics';
import { TokenKind, type Token } from '../tokens';
import type { Location, Position, Range, Span } from '../types';
import { HTTP_METHOD_SET } from '../../shared';

/** The complete, recoverable output of tokenizing one source document. */
export interface TokenizeResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly TokenizerDiagnostic[];
}

const PUNCTUATION: Readonly<Record<string, TokenKind>> = {
  ':': TokenKind.Colon,
  ',': TokenKind.Comma,
  '{': TokenKind.Brace,
  '}': TokenKind.Brace,
  '[': TokenKind.Bracket,
  ']': TokenKind.Bracket,
  '(': TokenKind.Parenthesis,
  ')': TokenKind.Parenthesis,
};

/**
 * Tokenizes API source text in one pass without throwing for malformed input.
 *
 * Newlines, comments, and whitespace are retained. All offsets and columns use
 * UTF-16 code units, and every result ends with an EOF token.
 */
export function tokenize(sourceText: string, sourceId?: string): TokenizeResult {
  const cursor = new TokenizerCursor(sourceText, sourceId);
  return cursor.run();
}

class TokenizerCursor {
  private readonly tokens: Token[] = [];
  private readonly diagnostics: TokenizerDiagnostic[] = [];
  private offset = 0;
  private line = 0;
  private column = 0;
  private atLineStart = true;
  private inHeaderValue = false;
  private pendingHeaderColon = false;

  public constructor(
    private readonly source: string,
    private readonly sourceId?: string,
  ) {}

  public run(): TokenizeResult {
    while (!this.isAtEnd()) {
      this.scanNext();
    }

    const end = this.position();
    this.tokens.push(this.createToken(TokenKind.EOF, end, end));
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private scanNext(): void {
    const character = this.peek();
    const start = this.position();

    if (character === '\r' || character === '\n') {
      this.scanNewline(start);
      return;
    }

    if (character === ' ' || character === '\t') {
      this.consumeWhile((value) => value === ' ' || value === '\t');
      this.emit(TokenKind.Whitespace, start);
      return;
    }

    if (this.inHeaderValue) {
      if (this.startsWith('{{')) {
        this.scanVariable(start);
      } else {
        this.scanHeaderValue(start);
      }
      return;
    }

    if (this.isHashCommentStart() || this.isSlashCommentStart()) {
      this.consumeUntilNewline();
      this.emit(TokenKind.Comment, start);
      this.atLineStart = false;
      return;
    }

    if (this.startsWith('{{')) {
      this.scanVariable(start);
      this.atLineStart = false;
      return;
    }

    if (character === '"' || character === "'" || character === '`') {
      this.scanString(start, character);
      this.atLineStart = false;
      return;
    }

    if (character === '@' && this.atLineStart) {
      this.scanDirective(start);
      this.atLineStart = false;
      return;
    }

    if (this.atLineStart) {
      const word = this.peekWord();
      const normalized = word.toUpperCase();
      if (word.length > 0 && HTTP_METHOD_SET.has(normalized)) {
        this.advanceBy(word.length);
        this.emit(TokenKind.HttpMethod, start, normalized);
        this.atLineStart = false;
        return;
      }

      const headerNameLength = this.headerNameLength();
      if (headerNameLength > 0) {
        this.advanceBy(headerNameLength);
        this.emit(TokenKind.HeaderName, start, this.slice(start).toLowerCase());
        this.pendingHeaderColon = true;
        this.atLineStart = false;
        return;
      }
    }

    if (this.isNumberStart()) {
      this.scanNumber(start);
      this.atLineStart = false;
      return;
    }

    const punctuationKind = PUNCTUATION[character];
    if (punctuationKind !== undefined) {
      this.advance();
      this.emit(punctuationKind, start);
      if (character === ':' && this.pendingHeaderColon) {
        this.inHeaderValue = true;
        this.pendingHeaderColon = false;
      }
      this.atLineStart = false;
      return;
    }

    if (this.isUnexpectedControl(character)) {
      this.advance();
      const diagnostic = this.report(
        TokenizerDiagnosticCode.UnexpectedControlCharacter,
        'Unexpected control character.',
        start,
      );
      this.emit(TokenKind.Unknown, start, undefined, diagnostic);
      this.atLineStart = false;
      return;
    }

    if (character === '\\' || character === '\uFFFD') {
      this.advance();
      const diagnostic = this.report(
        TokenizerDiagnosticCode.UnknownCharacter,
        `Unknown character ${JSON.stringify(character)}.`,
        start,
      );
      this.emit(TokenKind.Unknown, start, undefined, diagnostic);
      this.atLineStart = false;
      return;
    }

    this.scanBareValue(start);
    this.atLineStart = false;
  }

  private scanNewline(start: Position): void {
    if (this.startsWith('\r\n')) {
      this.offset += 2;
    } else {
      this.offset += 1;
    }
    this.line += 1;
    this.column = 0;
    this.emit(TokenKind.Newline, start, '\n');
    this.atLineStart = true;
    this.inHeaderValue = false;
    this.pendingHeaderColon = false;
  }

  private scanHeaderValue(start: Position): void {
    while (!this.isAtEnd()) {
      const character = this.peek();
      if (
        character === '\r' ||
        character === '\n' ||
        character === ' ' ||
        character === '\t' ||
        this.startsWith('{{')
      ) {
        break;
      }
      this.advance();
    }
    this.emit(TokenKind.HeaderValue, start);
  }

  private scanDirective(start: Position): void {
    this.advance();
    const nameStart = this.offset;
    this.consumeWhile((character) => this.isDirectiveCharacter(character));
    if (this.offset === nameStart) {
      const diagnostic = this.report(
        TokenizerDiagnosticCode.UnknownCharacter,
        'A directive marker must be followed by a name.',
        start,
      );
      this.emit(TokenKind.Unknown, start, undefined, diagnostic);
      return;
    }
    this.emit(TokenKind.Directive, start, this.slice(start).slice(1));
  }

  private scanVariable(start: Position): void {
    this.advanceBy(2);
    while (!this.isAtEnd() && !this.startsWith('}}')) {
      const character = this.peek();
      if (character === '\r' || character === '\n') {
        break;
      }
      this.advance();
    }

    const closed = this.startsWith('}}');
    if (closed) {
      this.advanceBy(2);
    }

    const raw = this.slice(start);
    const name = raw.slice(2, closed ? -2 : undefined).trim();
    const validName =
      /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(name) ||
      name === '$timestamp' ||
      name === '$uuid';
    let diagnostic: TokenizerDiagnostic | undefined;
    if (!closed || !validName) {
      diagnostic = this.report(
        TokenizerDiagnosticCode.InvalidVariableSyntax,
        closed
          ? 'Variable names must start with a letter or underscore and contain only letters, digits, ".", "_", or "-".'
          : 'Variable is missing its closing "}}".',
        start,
      );
    }

    this.emit(
      TokenKind.Variable,
      start,
      validName ? name : undefined,
      diagnostic,
    );
  }

  private scanString(start: Position, quote: string): void {
    this.advance();
    let firstDiagnostic: TokenizerDiagnostic | undefined;
    let terminated = false;

    while (!this.isAtEnd()) {
      const character = this.peek();
      if (character === quote) {
        this.advance();
        terminated = true;
        break;
      }
      if (character === '\r' || character === '\n') {
        break;
      }
      if (character !== '\\') {
        this.advance();
        continue;
      }

      const escapeStart = this.position();
      this.advance();
      const escaped = this.peek();
      if (escaped !== '' && '"\'`\\/bfnrt'.includes(escaped)) {
        this.advance();
        continue;
      }
      if (escaped === 'u' && this.hasFourHexDigits(this.offset + 1)) {
        this.advanceBy(5);
        continue;
      }

      if (!this.isAtEnd() && escaped !== '\r' && escaped !== '\n') {
        this.advance();
      }
      const diagnostic = this.report(
        TokenizerDiagnosticCode.InvalidEscape,
        'Invalid string escape sequence.',
        escapeStart,
      );
      firstDiagnostic ??= diagnostic;
    }

    if (!terminated) {
      const diagnostic = this.report(
        TokenizerDiagnosticCode.UnterminatedString,
        `String is missing its closing ${quote}.`,
        start,
      );
      firstDiagnostic ??= diagnostic;
    }

    this.emit(TokenKind.String, start, undefined, firstDiagnostic);
  }

  private scanNumber(start: Position): void {
    if (this.peek() === '+' || this.peek() === '-') {
      this.advance();
    }
    this.consumeWhile((character) => this.isDigit(character));
    if (this.peek() === '.' && this.isDigit(this.peek(1))) {
      this.advance();
      this.consumeWhile((character) => this.isDigit(character));
    }
    if (
      (this.peek() === 'e' || this.peek() === 'E') &&
      this.exponentHasDigits()
    ) {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        this.advance();
      }
      this.consumeWhile((character) => this.isDigit(character));
    }
    this.emit(TokenKind.Number, start, this.slice(start));
  }

  private scanBareValue(start: Position): void {
    while (!this.isAtEnd()) {
      const character = this.peek();
      if (
        character === '\r' ||
        character === '\n' ||
        character === ' ' ||
        character === '\t' ||
        character === '"' ||
        character === "'" ||
        character === '`' ||
        character === '\\' ||
        character === '\uFFFD' ||
        PUNCTUATION[character] !== undefined ||
        this.startsWith('{{') ||
        this.isUnexpectedControl(character)
      ) {
        break;
      }
      this.advance();
    }

    if (this.offset === start.offset) {
      this.advance();
      const diagnostic = this.report(
        TokenizerDiagnosticCode.UnknownCharacter,
        `Unknown character ${JSON.stringify(this.slice(start))}.`,
        start,
      );
      this.emit(TokenKind.Unknown, start, undefined, diagnostic);
      return;
    }

    const raw = this.slice(start);
    const normalized = raw.toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      this.emit(TokenKind.Boolean, start, normalized);
    } else if (normalized === 'null') {
      this.emit(TokenKind.Null, start, normalized);
    } else {
      this.emit(TokenKind.Identifier, start);
    }
  }

  private isSlashCommentStart(): boolean {
    if (!this.startsWith('//')) {
      return false;
    }
    if (this.atLineStart) {
      return true;
    }
    const previous = this.source[this.offset - 1];
    const after = this.peek(2);
    return (
      (previous === ' ' || previous === '\t') &&
      (after === '' || after === ' ' || after === '\t')
    );
  }

  private isHashCommentStart(): boolean {
    if (this.peek() !== '#') {
      return false;
    }
    if (this.atLineStart) {
      return true;
    }
    const previous = this.source[this.offset - 1];
    return previous === ' ' || previous === '\t';
  }

  private headerNameLength(): number {
    let index = this.offset;
    while (index < this.source.length && this.isHeaderNameCharacter(this.source[index] ?? '')) {
      index += 1;
    }
    return index > this.offset && this.source[index] === ':'
      ? index - this.offset
      : 0;
  }

  private peekWord(): string {
    let index = this.offset;
    while (index < this.source.length) {
      const character = this.source[index] ?? '';
      if (!this.isAsciiLetter(character)) {
        break;
      }
      index += 1;
    }
    const word = this.source.slice(this.offset, index);
    const following = this.source[index] ?? '';
    return following === '' ||
      following === ' ' ||
      following === '\t' ||
      following === '\r' ||
      following === '\n'
      ? word
      : '';
  }

  private isNumberStart(): boolean {
    const character = this.peek();
    if (this.isDigit(character)) {
      return true;
    }
    return (
      (character === '+' || character === '-') && this.isDigit(this.peek(1))
    );
  }

  private exponentHasDigits(): boolean {
    let lookahead = 1;
    if (this.peek(lookahead) === '+' || this.peek(lookahead) === '-') {
      lookahead += 1;
    }
    return this.isDigit(this.peek(lookahead));
  }

  private hasFourHexDigits(offset: number): boolean {
    if (offset + 4 > this.source.length) {
      return false;
    }
    for (let index = offset; index < offset + 4; index += 1) {
      if (!this.isHexDigit(this.source[index] ?? '')) {
        return false;
      }
    }
    return true;
  }

  private isHeaderNameCharacter(character: string): boolean {
    return (
      this.isAsciiLetter(character)
      || this.isDigit(character)
      || (character !== '' && "!#$%&'*+-.^_`|~".includes(character))
    );
  }

  private isDirectiveCharacter(character: string): boolean {
    return (
      this.isAsciiLetter(character)
      || this.isDigit(character)
      || character === '_'
      || character === '.'
      || character === '-'
    );
  }

  private isAsciiLetter(character: string): boolean {
    return (
      (character >= 'A' && character <= 'Z')
      || (character >= 'a' && character <= 'z')
    );
  }

  private isHexDigit(character: string): boolean {
    return (
      this.isDigit(character)
      || (character >= 'A' && character <= 'F')
      || (character >= 'a' && character <= 'f')
    );
  }

  private isDigit(character: string): boolean {
    return character >= '0' && character <= '9';
  }

  private isUnexpectedControl(character: string): boolean {
    if (character.length === 0) {
      return false;
    }
    const code = character.charCodeAt(0);
    return (code >= 0 && code < 0x20) || code === 0x7f;
  }

  private consumeUntilNewline(): void {
    this.consumeWhile(
      (character) => character !== '\r' && character !== '\n',
    );
  }

  private consumeWhile(predicate: (character: string) => boolean): void {
    while (!this.isAtEnd() && predicate(this.peek())) {
      this.advance();
    }
  }

  private advanceBy(length: number): void {
    for (let count = 0; count < length; count += 1) {
      this.advance();
    }
  }

  private advance(): void {
    this.offset += 1;
    this.column += 1;
  }

  private peek(lookahead = 0): string {
    return this.source[this.offset + lookahead] ?? '';
  }

  private startsWith(value: string): boolean {
    return this.source.startsWith(value, this.offset);
  }

  private isAtEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private position(): Position {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  private slice(start: Position): string {
    return this.source.slice(start.offset, this.offset);
  }

  private emit(
    kind: TokenKind,
    start: Position,
    normalized?: string,
    diagnostic?: TokenizerDiagnostic,
  ): void {
    this.tokens.push(
      this.createToken(kind, start, this.position(), normalized, diagnostic),
    );
  }

  private createToken(
    kind: TokenKind,
    start: Position,
    end: Position,
    normalized?: string,
    diagnostic?: TokenizerDiagnostic,
  ): Token {
    const span: Span = {
      offset: start.offset,
      length: end.offset - start.offset,
    };
    const range: Range = { start, end };
    return {
      kind,
      raw: this.source.slice(start.offset, end.offset),
      normalized,
      start,
      end,
      line: start.line,
      column: start.column,
      length: span.length,
      span,
      location: this.location(range, span),
      diagnostic:
        diagnostic === undefined
          ? undefined
          : { code: diagnostic.code, message: diagnostic.message },
    };
  }

  private report(
    code: TokenizerDiagnosticCode,
    message: string,
    start: Position,
  ): TokenizerDiagnostic {
    const end = this.position();
    const range: Range = { start, end };
    const span: Span = {
      offset: start.offset,
      length: end.offset - start.offset,
    };
    const diagnostic: TokenizerDiagnostic = {
      severity: TokenizerDiagnosticSeverity.Error,
      message,
      range,
      location: this.location(range, span),
      code,
    };
    this.diagnostics.push(diagnostic);
    return diagnostic;
  }

  private location(range: Range, span: Span): Location {
    return this.sourceId === undefined
      ? { range, span }
      : { sourceId: this.sourceId, range, span };
  }
}
