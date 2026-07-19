import {
  AstBuilder,
  KNOWN_DIRECTIVE_NAMES,
  type ApiDocument,
  type ApiHttpMethod,
  type AstDiagnostic,
  type BodyNode,
  type CommentNode,
  type DirectiveNode,
  type HeaderNode,
  type KnownDirectiveName,
  type LiteralNode,
  type ObjectPropertyNode,
  type RequestNode,
  type VariableNode,
} from './ast';
import {
  type LexerDiagnostic,
  type LexerResult,
  type LexicalToken,
} from './lexer';
import type { Position, Range } from './types';

/** Controls source attribution and defensive JSON nesting limits. */
export interface ParserOptions {
  readonly sourceId?: string;
  readonly maxNestingDepth?: number;
}

/**
 * Complete, recoverable canonical parse result.
 *
 * `ast` is always the rich {@link ApiDocument}; parser diagnostics are also
 * attached to the document and relevant descendant nodes.
 */
export interface ParserResult {
  readonly ast: ApiDocument;
  readonly diagnostics: readonly AstDiagnostic[];
}

type ParserInput = LexerResult | readonly LexicalToken[];

const DEFAULT_MAX_NESTING_DEPTH = 512;
const KNOWN_DIRECTIVES = new Set<string>(KNOWN_DIRECTIVE_NAMES);

/**
 * Single-pass recursive descent parser for API document lexical tokens.
 *
 * The parser never rewinds. Invalid constructs are represented as far as
 * possible and synchronized at newlines, JSON delimiters, or request starts.
 *
 * @deprecated Feature code should call `parseApiDocument` from the parser
 * public API. Direct construction is retained for compatibility and focused
 * parser tests.
 */
export class Parser {
  private readonly tokens: readonly LexicalToken[];
  private readonly builder: AstBuilder;
  private readonly maxNestingDepth: number;
  private readonly diagnostics: AstDiagnostic[] = [];
  private readonly jsonVariables: VariableNode[] = [];
  private readonly requestBoundaries: Range[] = [];
  private index = 0;
  private requestBlock = 0;

  public constructor(input: ParserInput, options: ParserOptions = {}) {
    this.tokens = isLexerResult(input) ? input.tokens : input;
    const sourceId =
      options.sourceId ?? this.tokens[0]?.location.sourceId;
    this.builder = new AstBuilder(sourceId);
    this.maxNestingDepth = Math.max(
      1,
      Math.floor(options.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH),
    );

    const lexerDiagnostics = isLexerResult(input) ? input.diagnostics : [];
    for (const diagnostic of lexerDiagnostics) {
      this.diagnostics.push(this.fromLexerDiagnostic(diagnostic));
    }
  }

  public parse(): ParserResult {
    const requests: RequestNode[] = [];
    const directives: DirectiveNode[] = [];
    const comments: CommentNode[] = [];

    while (!this.atEnd()) {
      this.skipNewlines();
      const token = this.current();
      if (token === undefined || token.kind === 'EOF') {
        break;
      }

      switch (token.kind) {
        case 'HttpMethod':
          requests.push(this.parseRequest());
          break;
        case 'Directive':
          directives.push(this.parseDirective());
          break;
        case 'Comment':
          comments.push(this.parseComment());
          this.consumeLineRemainder();
          break;
        case 'RequestBoundary':
          this.requestBoundaries.push(token.location.range);
          this.advance();
          this.consumeLineRemainder();
          this.requestBlock += 1;
          break;
        default:
          this.report(
            'parser.unexpected-token',
            `Unexpected token ${JSON.stringify(token.raw)} outside a request.`,
            token,
          );
          this.consumeLineRemainder();
          break;
      }
    }

    const start = this.tokens[0]?.location.range.start ?? zeroPosition();
    const end =
      this.tokens.at(-1)?.location.range.end ??
      this.tokens.at(-1)?.location.range.start ??
      start;
    const ast = this.builder.document({
      requests,
      directives,
      comments,
      diagnostics: this.diagnostics,
      metadata: {
        requestBoundaries: Object.freeze([...this.requestBoundaries]),
      },
      range: makeRange(start, end),
    });
    return {
      ast,
      diagnostics: Object.freeze([...this.diagnostics]),
    };
  }

  private parseRequest(): RequestNode {
    const methodToken = this.advance();
    const requestStart = methodToken?.location.range.start ?? zeroPosition();
    const method = (methodToken?.value ?? methodToken?.raw ?? 'GET') as ApiHttpMethod;
    const requestDiagnosticStart = this.diagnostics.length;
    const requestLineTokens = this.takeUntilLineEnd();
    const inlineCommentIndex = requestLineTokens.findIndex(
      (token) => token.kind === 'Comment',
    );
    const urlTokens =
      inlineCommentIndex < 0
        ? requestLineTokens
        : requestLineTokens.slice(0, inlineCommentIndex);
    const url = joinTokens(urlTokens).trim();
    const variables: VariableNode[] = this.createVariables(urlTokens);
    const headers: HeaderNode[] = [];
    const directives: DirectiveNode[] = [];
    const inlineComment =
      inlineCommentIndex < 0
        ? undefined
        : requestLineTokens[inlineCommentIndex];
    const comments: CommentNode[] =
      inlineComment === undefined
        ? []
        : [this.createComment(inlineComment)];
    let body: BodyNode | undefined;
    let requestEnd =
      requestLineTokens.at(-1)?.location.range.end ??
      methodToken?.location.range.end ??
      requestStart;

    this.skipOneNewline();

    while (!this.atEnd() && !this.isRequestTerminator(this.current())) {
      if (this.match('Newline')) {
        continue;
      }

      const token = this.current();
      if (token === undefined) {
        break;
      }
      if (token.kind === 'Comment') {
        const comment = this.parseComment();
        comments.push(comment);
        requestEnd = comment.range.end;
        this.consumeLineRemainder();
        continue;
      }
      // Additive assertion lines: skip without body/header semantics.
      // Association remains source-based (see src/assertions/extract.ts).
      if (isExpectLineStart(token)) {
        const lineTokens = this.takeUntilLineEnd();
        const last = lineTokens.at(-1);
        requestEnd = last?.location.range.end ?? token.location.range.end;
        this.skipOneNewline();
        continue;
      }
      if (token.kind === 'Directive') {
        const directive = this.parseDirective();
        directives.push(directive);
        requestEnd = directive.range.end;
        continue;
      }
      if (token.kind === 'HeaderName' && body === undefined) {
        const header = this.parseHeader(variables);
        headers.push(header);
        requestEnd = header.range.end;
        continue;
      }
      if (body === undefined) {
        body = this.parseBody();
        requestEnd = body.range.end;
        continue;
      }

      this.report(
        'parser.unexpected-token',
        `Unexpected token ${JSON.stringify(token.raw)} after the request body.`,
        token,
      );
      this.consumeLineRemainder();
    }

    variables.push(...this.jsonVariables.splice(0));
    const requestDiagnostics = this.diagnostics.slice(requestDiagnosticStart);
    return this.builder.request({
      method,
      url,
      headers,
      body,
      directives,
      variables,
      comments,
      diagnostics: requestDiagnostics,
      metadata: { requestBlock: this.requestBlock },
      range: makeRange(requestStart, requestEnd),
    });
  }

  private parseHeader(requestVariables: VariableNode[]): HeaderNode {
    const nameToken = this.advance();
    const start = nameToken?.location.range.start ?? zeroPosition();
    const name = String(nameToken?.raw ?? nameToken?.value ?? '');
    let end = nameToken?.location.range.end ?? start;

    if (!this.match('Colon')) {
      this.report(
        'parser.missing-header-colon',
        `Header "${name}" is missing ":".`,
        this.current() ?? nameToken,
      );
    }

    const valueTokens = this.takeUntilLineEnd();
    requestVariables.push(...this.createVariables(valueTokens));
    const value = joinTokens(valueTokens).trim();
    end = valueTokens.at(-1)?.location.range.end ?? end;
    if (value.length === 0) {
      this.report(
        'parser.missing-header-value',
        `Header "${name}" is missing a value.`,
        nameToken,
      );
    }
    this.skipOneNewline();
    return this.builder.header(name, value, {
      range: makeRange(start, end),
    });
  }

  private parseDirective(): DirectiveNode {
    const directiveToken = this.advance();
    const start = directiveToken?.location.range.start ?? zeroPosition();
    const valueTokens = this.takeUntilLineEnd();
    const end =
      valueTokens.at(-1)?.location.range.end ??
      directiveToken?.location.range.end ??
      start;
    const normalizedName = String(
      directiveToken?.value ?? directiveToken?.raw.slice(1) ?? '',
    ).toLowerCase();
    const knownName = KNOWN_DIRECTIVES.has(normalizedName)
      ? (normalizedName as KnownDirectiveName)
      : undefined;
    const variables = this.createVariables(valueTokens);
    this.skipOneNewline();
    return this.builder.directive({
      name: directiveToken?.raw ?? `@${normalizedName}`,
      knownName,
      value: joinTokens(valueTokens).trim(),
      variables,
      metadata: { requestBlock: this.requestBlock },
      range: makeRange(start, end),
    });
  }

  private parseComment(): CommentNode {
    const token = this.advance();
    return this.createComment(token);
  }

  private createComment(token: LexicalToken | undefined): CommentNode {
    const raw = token?.raw ?? '';
    const style = raw.startsWith('//') ? '//' : '#';
    return this.builder.comment(
      raw,
      String(token?.value ?? raw.slice(style.length).trim()),
      style,
      { range: tokenRange(token) },
    );
  }

  private parseBody(): BodyNode {
    const token = this.current();
    if (token?.kind === 'LeftBrace' || token?.kind === 'LeftBracket') {
      const start = token.location.range.start;
      const value = this.parseJsonValue(0);
      return this.builder.jsonBody(value, {
        range: makeRange(start, value.range.end),
      });
    }

    const bodyTokens: LexicalToken[] = [];
    while (!this.atEnd() && !this.isRequestTerminator(this.current())) {
      const current = this.advance();
      if (current !== undefined) {
        bodyTokens.push(current);
      }
    }
    const contentTokens = bodyTokens.filter((item) => item.kind !== 'EOF');
    const variables = this.createVariables(contentTokens);
    const start = contentTokens[0]?.location.range.start ?? zeroPosition();
    const end = contentTokens.at(-1)?.location.range.end ?? start;
    const content = joinTokens(contentTokens).trimEnd();
    return this.builder.rawBody({
      content,
      variables,
      range: makeRange(start, end),
    });
  }

  private parseJsonValue(depth: number): LiteralNode {
    this.skipJsonTrivia();
    const token = this.current();
    if (token === undefined || token.kind === 'EOF') {
      const diagnostic = this.report(
        'parser.unexpected-eof',
        'Unexpected end of file while parsing JSON.',
        token,
      );
      return this.syntheticNull(token, diagnostic);
    }
    if (depth >= this.maxNestingDepth) {
      const diagnostic = this.report(
        'parser.maximum-nesting',
        `JSON nesting exceeds the configured limit of ${this.maxNestingDepth}.`,
        token,
      );
      this.advance();
      return this.syntheticNull(token, diagnostic);
    }

    switch (token.kind) {
      case 'LeftBrace':
        return this.parseObject(depth + 1);
      case 'LeftBracket':
        return this.parseArray(depth + 1);
      case 'String':
        this.advance();
        return this.builder.stringLiteral(String(token.value ?? ''), token.raw, {
          range: tokenRange(token),
          diagnostics: this.tokenDiagnostics(token),
        });
      case 'Number':
        this.advance();
        return this.builder.numberLiteral(Number(token.value), token.raw, {
          range: tokenRange(token),
          diagnostics: this.tokenDiagnostics(token),
        });
      case 'Boolean':
        this.advance();
        return this.builder.booleanLiteral(Boolean(token.value), token.raw, {
          range: tokenRange(token),
          diagnostics: this.tokenDiagnostics(token),
        });
      case 'Null':
        this.advance();
        return this.builder.nullLiteral(token.raw, {
          range: tokenRange(token),
          diagnostics: this.tokenDiagnostics(token),
        });
      case 'Variable': {
        this.advance();
        this.jsonVariables.push(this.createVariable(token));
        return this.builder.stringLiteral(token.raw, token.raw, {
          metadata: { variableName: String(token.value ?? '') },
          range: tokenRange(token),
          diagnostics: this.tokenDiagnostics(token),
        });
      }
      default: {
        const diagnostic = this.report(
          'parser.expected-json-value',
          `Expected a JSON value but found ${JSON.stringify(token.raw)}.`,
          token,
        );
        if (!isJsonDelimiter(token.kind)) {
          this.advance();
        }
        return this.syntheticNull(token, diagnostic);
      }
    }
  }

  private parseObject(depth: number): LiteralNode {
    const startIndex = this.index;
    const open = this.advance();
    const start = open?.location.range.start ?? zeroPosition();
    const properties: ObjectPropertyNode[] = [];
    let end = open?.location.range.end ?? start;

    this.skipJsonTrivia();
    while (!this.atEnd() && this.current()?.kind !== 'RightBrace') {
      const keyToken = this.current();
      if (keyToken?.kind !== 'String') {
        this.report(
          'parser.expected-property-key',
          'Expected a quoted JSON object property name.',
          keyToken,
        );
        this.synchronizeJsonProperty();
        if (this.match('Comma')) {
          this.skipJsonTrivia();
          continue;
        }
        break;
      }

      this.advance();
      const key = this.builder.stringLiteral(
        String(keyToken.value ?? ''),
        keyToken.raw,
        { range: tokenRange(keyToken), diagnostics: this.tokenDiagnostics(keyToken) },
      );
      this.skipJsonTrivia();
      if (!this.match('Colon')) {
        this.report(
          'parser.missing-property-colon',
          `Property ${JSON.stringify(key.value)} is missing ":".`,
          this.current() ?? keyToken,
        );
      }
      const value = this.parseJsonValue(depth);
      properties.push(
        this.builder.objectProperty(key, value, {
          range: makeRange(key.range.start, value.range.end),
        }),
      );
      end = value.range.end;
      this.skipJsonTrivia();
      if (this.match('Comma')) {
        this.skipJsonTrivia();
        continue;
      }
      if (this.current()?.kind !== 'RightBrace') {
        this.report(
          'parser.missing-comma',
          'Expected "," between JSON object properties.',
          this.current(),
        );
        this.synchronizeJsonProperty();
        this.match('Comma');
        this.skipJsonTrivia();
      }
    }

    if (this.current()?.kind === 'RightBrace') {
      end = this.advance()?.location.range.end ?? end;
    } else {
      this.report(
        'parser.unexpected-eof',
        'JSON object is missing its closing "}".',
        this.current() ?? open,
      );
    }
    return this.builder.objectLiteral(
      properties,
      joinTokens(this.tokens.slice(startIndex, this.index)),
      {
        range: makeRange(start, end),
      },
    );
  }

  private parseArray(depth: number): LiteralNode {
    const startIndex = this.index;
    const open = this.advance();
    const start = open?.location.range.start ?? zeroPosition();
    const elements: LiteralNode[] = [];
    let end = open?.location.range.end ?? start;

    this.skipJsonTrivia();
    while (!this.atEnd() && this.current()?.kind !== 'RightBracket') {
      const value = this.parseJsonValue(depth);
      elements.push(value);
      end = value.range.end;
      this.skipJsonTrivia();
      if (this.match('Comma')) {
        this.skipJsonTrivia();
        continue;
      }
      if (this.current()?.kind !== 'RightBracket') {
        this.report(
          'parser.missing-comma',
          'Expected "," between JSON array elements.',
          this.current(),
        );
        this.synchronizeJsonArray();
        this.match('Comma');
        this.skipJsonTrivia();
      }
    }

    if (this.current()?.kind === 'RightBracket') {
      end = this.advance()?.location.range.end ?? end;
    } else {
      this.report(
        'parser.unexpected-eof',
        'JSON array is missing its closing "]".',
        this.current() ?? open,
      );
    }
    return this.builder.arrayLiteral(
      elements,
      joinTokens(this.tokens.slice(startIndex, this.index)),
      {
        range: makeRange(start, end),
      },
    );
  }

  private synchronizeJsonProperty(): void {
    while (!this.atEnd()) {
      const kind = this.current()?.kind;
      if (
        kind === 'Comma' ||
        kind === 'RightBrace' ||
        kind === 'RequestBoundary' ||
        kind === 'HttpMethod'
      ) {
        return;
      }
      this.advance();
    }
  }

  private synchronizeJsonArray(): void {
    while (!this.atEnd()) {
      const kind = this.current()?.kind;
      if (
        kind === 'Comma' ||
        kind === 'RightBracket' ||
        kind === 'RequestBoundary' ||
        kind === 'HttpMethod'
      ) {
        return;
      }
      this.advance();
    }
  }

  private syntheticNull(
    token: LexicalToken | undefined,
    diagnostic: AstDiagnostic,
  ): LiteralNode {
    return this.builder.nullLiteral('', {
      metadata: { synthetic: true },
      diagnostics: [diagnostic],
      range: tokenRange(token),
    });
  }

  private createVariables(tokens: readonly LexicalToken[]): VariableNode[] {
    return tokens
      .filter((token) => token.kind === 'Variable')
      .map((token) => this.createVariable(token));
  }

  private createVariable(token: LexicalToken): VariableNode {
    return this.builder.variable(
      token.raw,
      String(token.value ?? ''),
      {
        range: tokenRange(token),
        diagnostics: this.tokenDiagnostics(token),
      },
    );
  }

  private tokenDiagnostics(token: LexicalToken): readonly AstDiagnostic[] {
    return (token.diagnostics ?? []).map((diagnostic) =>
      this.fromLexerDiagnostic(diagnostic),
    );
  }

  private fromLexerDiagnostic(diagnostic: LexerDiagnostic): AstDiagnostic {
    return this.builder.diagnostic({
      code: `lexer.${diagnostic.code}`,
      message: diagnostic.message,
      severity: diagnostic.severity,
      range: diagnostic.location.range,
      source: 'api-lexer',
    });
  }

  private report(
    code: string,
    message: string,
    token: LexicalToken | undefined,
    severity: 'error' | 'warning' = 'error',
  ): AstDiagnostic {
    const diagnostic = this.builder.diagnostic({
      code,
      message,
      severity,
      range: tokenRange(token),
      source: 'api-parser',
    });
    this.diagnostics.push(diagnostic);
    return diagnostic;
  }

  private takeUntilLineEnd(): LexicalToken[] {
    const tokens: LexicalToken[] = [];
    while (!this.atEnd()) {
      const token = this.current();
      if (
        token === undefined ||
        token.kind === 'Newline' ||
        token.kind === 'RequestBoundary'
      ) {
        break;
      }
      tokens.push(token);
      this.advance();
    }
    return tokens;
  }

  private consumeLineRemainder(): void {
    while (!this.atEnd() && this.current()?.kind !== 'Newline') {
      this.advance();
    }
    this.skipOneNewline();
  }

  private skipJsonTrivia(): void {
    while (
      this.current()?.kind === 'Newline' ||
      this.current()?.kind === 'Comment'
    ) {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.match('Newline')) {
      // Intentionally empty.
    }
  }

  private skipOneNewline(): void {
    this.match('Newline');
  }

  private isRequestTerminator(token: LexicalToken | undefined): boolean {
    return (
      token?.kind === 'HttpMethod' ||
      token?.kind === 'RequestBoundary' ||
      token?.kind === 'EOF'
    );
  }

  private match(kind: LexicalToken['kind']): boolean {
    if (this.current()?.kind !== kind) {
      return false;
    }
    this.advance();
    return true;
  }

  private current(): LexicalToken | undefined {
    return this.tokens[this.index];
  }

  private advance(): LexicalToken | undefined {
    const token = this.current();
    if (token !== undefined) {
      this.index += 1;
    }
    return token;
  }

  private atEnd(): boolean {
    return (
      this.index >= this.tokens.length || this.current()?.kind === 'EOF'
    );
  }
}

/**
 * Parses a lexical token stream without requiring a Parser instance.
 *
 * @deprecated Call `parseApiDocument(sourceText, options)` from the parser
 * public API. This lower-level entry point is retained for callers that
 * already own a lexical token stream.
 */
export function parse(
  input: ParserInput,
  options: ParserOptions = {},
): ParserResult {
  return new Parser(input, options).parse();
}

function joinTokens(tokens: readonly LexicalToken[]): string {
  let value = '';
  let previousEnd: Position | undefined;
  for (const token of tokens) {
    if (token.kind === 'EOF') {
      continue;
    }
    if (previousEnd !== undefined) {
      if (token.location.range.start.line > previousEnd.line) {
        value += '\n'.repeat(token.location.range.start.line - previousEnd.line);
      } else {
        const gap = token.location.range.start.offset - previousEnd.offset;
        if (gap > 0) {
          value += ' '.repeat(gap);
        }
      }
    }
    value += token.raw;
    previousEnd = token.location.range.end;
  }
  return value;
}

function tokenRange(token: LexicalToken | undefined): Range {
  if (token !== undefined) {
    return token.location.range;
  }
  const zero = zeroPosition();
  return makeRange(zero, zero);
}

function makeRange(start: Position, end: Position): Range {
  return { start, end };
}

function zeroPosition(): Position {
  return { offset: 0, line: 0, column: 0 };
}

function isJsonDelimiter(kind: LexicalToken['kind']): boolean {
  return (
    kind === 'Comma' ||
    kind === 'RightBrace' ||
    kind === 'RightBracket' ||
    kind === 'RequestBoundary' ||
    kind === 'HttpMethod' ||
    kind === 'EOF'
  );
}

function isLexerResult(input: ParserInput): input is LexerResult {
  return !Array.isArray(input);
}

/** True when the token begins an assertion `expect …` line. */
function isExpectLineStart(token: LexicalToken): boolean {
  if (token.kind !== 'Identifier') {
    return false;
  }
  const text = String(token.value ?? token.raw ?? '');
  return text.toLowerCase() === 'expect';
}
