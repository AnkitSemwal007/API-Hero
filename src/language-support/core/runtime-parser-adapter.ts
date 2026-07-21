import {
  AstNodeType,
  parseApiDocument,
  validateApiDocument,
  walkAst,
  type ApiDocument,
  type AstDiagnostic,
  type DirectiveNode,
  type ParserResult,
  type Position,
  type Range,
  type RequestNode,
  type VariableNode,
} from '../../parser';
import {
  DefaultVariableResolver,
  MASKED_VARIABLE_VALUE,
  VARIABLE_DIAGNOSTIC_CODES,
  extractDocumentVariables,
  type VariableAnalysis,
  type VariableResolutionContext,
  type VariableResolver,
} from '../../variables';
import {
  DIRECTIVES,
  HOVER_DOCUMENTATION,
  HTTP_HEADERS,
  HTTP_METHODS,
  MIME_TYPES,
} from '../constants';
import {
  createAuthenticationDiagnostics,
  type AuthenticationDiagnosticContext,
} from './authentication-diagnostics';

export interface RuntimeSymbol {
  readonly name: string;
  readonly detail: string;
  readonly range: Range;
  readonly selectionRange: Range;
}

export interface RuntimeFold {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: 'request' | 'directives' | 'json';
}

export interface RuntimeHover {
  readonly key: string;
  readonly documentation: string;
  readonly range: Range;
}

export type RuntimeCompletionKind =
  | 'method'
  | 'directive'
  | 'header'
  | 'mime'
  | 'variable'
  | 'variable-template';

export interface RuntimeCompletion {
  readonly label: string;
  readonly kind: RuntimeCompletionKind;
  readonly detail?: string;
}

/**
 * Framework-neutral runtime projection of one canonical parser result.
 *
 * The source is parsed exactly once per adapter instance. Providers create an
 * instance for a request and only translate the returned projections to their
 * host editor's types.
 */
export class RuntimeParserAdapter {
  public readonly document: ApiDocument;
  public readonly diagnostics: readonly AstDiagnostic[];

  private readonly lines: readonly string[];
  private readonly lineOffsets: readonly number[];
  private readonly variableAnalysis: VariableAnalysis;
  private readonly variableNodes: readonly VariableNode[];

  public constructor(
    private readonly source: string,
    sourceId?: string,
    variableContext: VariableResolutionContext = { definitions: [] },
    variableResolver: VariableResolver = new DefaultVariableResolver(),
    authenticationContext?: AuthenticationDiagnosticContext,
  ) {
    const result: ParserResult = parseApiDocument(source, { sourceId });
    const lineData = createLineData(source);
    this.document = result.ast;
    this.lines = lineData.lines;
    this.lineOffsets = lineData.offsets;
    const validation = validateApiDocument(this.document);
    const extraction = extractDocumentVariables(this.document);
    this.variableAnalysis = variableResolver.analyze({
      definitions: [
        ...variableContext.definitions,
        ...extraction.definitions,
      ],
    });
    this.variableNodes = variableNodes(this.document);
    const variableDiagnostics = createVariableDiagnostics(
      this.document,
      this.variableNodes,
      this.variableAnalysis,
    );
    const authenticationDiagnostics = createAuthenticationDiagnostics(
      this.document,
      authenticationContext,
    );
    this.diagnostics = deduplicateDiagnostics([
      ...result.diagnostics,
      ...validation.diagnostics,
      ...extraction.diagnostics,
      ...variableDiagnostics,
      ...authenticationDiagnostics,
    ]);
  }

  public getSymbols(): readonly RuntimeSymbol[] {
    return this.document.requests.map((request, index, requests) => {
      const previous = requests[index - 1];
      const blockStartLine = this.findBlockStartLine(
        previous?.range.end.line ?? -1,
        request.range.start.line,
      );
      const precedingName = this.findPrecedingName(request, blockStartLine);
      const followingName = request.directives.find(
        (directive) => directive.knownName === 'name',
      )?.value;
      const name =
        precedingName ??
        followingName ??
        `${request.method} ${request.url}`.trim();

      return {
        name,
        detail: `${request.method} request`,
        range: {
          start: this.positionAtLine(blockStartLine),
          end: this.positionAtLineEnd(request.range.end.line),
        },
        selectionRange: this.lineRange(request.range.start.line),
      };
    });
  }

  public getFolds(): readonly RuntimeFold[] {
    const folds: RuntimeFold[] = [];

    for (const request of this.document.requests) {
      if (request.range.end.line > request.range.start.line) {
        folds.push({
          startLine: request.range.start.line,
          endLine: request.range.end.line,
          kind: 'request',
        });
      }
    }

    const directives = this.getAllDirectives();
    let groupStart: number | undefined;
    let groupEnd: number | undefined;
    for (const directive of directives) {
      const line = directive.range.start.line;
      if (groupEnd !== undefined && line > groupEnd + 1) {
        addDirectiveFold(folds, groupStart, groupEnd);
        groupStart = line;
      } else {
        groupStart ??= line;
      }
      groupEnd = directive.range.end.line;
    }
    addDirectiveFold(folds, groupStart, groupEnd);

    walkAst(this.document, {
      enterNode(node) {
        if (
          (node.type === AstNodeType.ObjectLiteral ||
            node.type === AstNodeType.ArrayLiteral) &&
          node.range.end.line > node.range.start.line
        ) {
          folds.push({
            startLine: node.range.start.line,
            endLine: node.range.end.line,
            kind: 'json',
          });
        }
      },
    });

    return folds;
  }

  public getHover(position: Position): RuntimeHover | undefined {
    const variable = this.variableNodes.find((node) =>
      containsPosition(node.range, position));
    if (variable !== undefined) {
      const value = this.variableAnalysis.values.get(variable.name);
      if (value !== undefined) {
        return {
          key: variable.originalText,
          documentation: `${value.scope} variable · ${
            value.sensitive ? MASKED_VARIABLE_VALUE : value.value
          }`,
          range: variable.range,
        };
      }
      const issue = this.variableAnalysis.errors.find((error) =>
        error.variableName === variable.name || error.chain.includes(variable.name));
      return {
        key: variable.originalText,
        documentation: issue?.message ?? `Variable "${variable.name}" is unresolved.`,
        range: variable.range,
      };
    }
    for (const request of this.document.requests) {
      const range = methodRange(request);
      if (containsPosition(range, position)) {
        return hoverFor(request.method, range);
      }
    }

    for (const directive of this.getAllDirectives()) {
      const range = directiveNameRange(directive);
      if (containsPosition(range, position)) {
        return hoverFor(directive.name.toLowerCase(), range);
      }
    }

    return undefined;
  }

  /**
   * Completion context is a temporary lexical compatibility boundary because
   * the canonical AST does not expose cursor context for incomplete lines.
   * Candidate registries and recognized request/header nodes remain canonical
   * parser knowledge; this method only classifies the current line prefix.
   */
  public getCompletions(position: Position): readonly RuntimeCompletion[] {
    const line = this.lines[position.line] ?? '';
    const prefix = line.slice(0, position.column);
    const items: RuntimeCompletion[] = [];

    if (isWhitespaceThen(prefix, isAsciiLetter)) {
      items.push(...HTTP_METHODS.map((label) => completion(label, 'method')));
    }
    if (isDirectivePrefix(prefix)) {
      items.push(...DIRECTIVES.map((label) => completion(label, 'directive')));
    }
    if (isWhitespaceThen(prefix, isHeaderNameCharacter)) {
      items.push(...HTTP_HEADERS.map((label) => completion(label, 'header')));
    }
    if (isMimeValuePrefix(prefix)) {
      items.push(...MIME_TYPES.map((label) => completion(label, 'mime')));
    }
    if (hasOpenVariable(prefix)) {
      items.push(...[...this.variableAnalysis.values.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((value) => ({
          label: value.name,
          kind: 'variable' as const,
          detail: `${value.scope}${value.sensitive ? ' · sensitive' : ''}`,
        })));
    } else if (prefix.length === 0 || endsCompletionBoundary(prefix)) {
      items.push(completion('{{variable}}', 'variable-template'));
    }

    return items;
  }

  private getAllDirectives(): readonly DirectiveNode[] {
    return [...this.document.directives, ...this.document.requests.flatMap(
      (request) => request.directives,
    )].sort((left, right) => left.range.start.offset - right.range.start.offset);
  }

  private findPrecedingName(
    request: RequestNode,
    blockStartLine: number,
  ): string | undefined {
    return this.document.directives
      .filter(
        (directive) =>
          directive.knownName === 'name' &&
          directive.range.start.line >= blockStartLine &&
          directive.range.end.offset <= request.range.start.offset,
      )
      .at(-1)?.value;
  }

  private findBlockStartLine(
    previousRequestEndLine: number,
    requestLine: number,
  ): number {
    let startLine = previousRequestEndLine + 1;
    for (let line = requestLine - 1; line >= startLine; line -= 1) {
      if (isRequestBoundary(this.lines[line] ?? '')) {
        startLine = line + 1;
        break;
      }
    }
    return Math.min(startLine, requestLine);
  }

  private positionAtLine(line: number): Position {
    return {
      line,
      column: 0,
      offset: this.lineOffsets[line] ?? this.source.length,
    };
  }

  private positionAtLineEnd(line: number): Position {
    const start = this.positionAtLine(line);
    const length = this.lines[line]?.length ?? 0;
    return {
      line,
      column: length,
      offset: start.offset + length,
    };
  }

  private lineRange(line: number): Range {
    return {
      start: this.positionAtLine(line),
      end: this.positionAtLineEnd(line),
    };
  }
}

function variableNodes(document: ApiDocument): readonly VariableNode[] {
  const nodes: VariableNode[] = [];
  walkAst(document, {
    enterNode(node) {
      if (node.type === AstNodeType.Variable) {
        nodes.push(node);
      }
    },
  });
  return nodes;
}

function createVariableDiagnostics(
  document: ApiDocument,
  nodes: readonly VariableNode[],
  analysis: VariableAnalysis,
): readonly AstDiagnostic[] {
  const diagnostics: AstDiagnostic[] = [];
  for (const node of nodes) {
    const issue = analysis.errors.find((error) =>
      error.variableName === node.name || error.chain.includes(node.name));
    if (issue === undefined && analysis.values.has(node.name)) {
      continue;
    }
    const unsupportedBuiltIn =
      node.name === '$timestamp' || node.name === '$uuid';
    diagnostics.push({
      code: issue === undefined
        ? unsupportedBuiltIn
          ? VARIABLE_DIAGNOSTIC_CODES.unsupportedBuiltIn
          : VARIABLE_DIAGNOSTIC_CODES.missing
        : issue.code === 'MISSING_VARIABLE'
        ? VARIABLE_DIAGNOSTIC_CODES.missing
        : issue.code === 'CYCLE'
          ? VARIABLE_DIAGNOSTIC_CODES.cycle
          : issue.code === 'UNSUPPORTED_BUILT_IN'
            ? VARIABLE_DIAGNOSTIC_CODES.unsupportedBuiltIn
            : issue.code === 'DUPLICATE_DEFINITION'
              ? VARIABLE_DIAGNOSTIC_CODES.duplicate
              : VARIABLE_DIAGNOSTIC_CODES.malformedDefinition,
      message: issue?.message ?? (unsupportedBuiltIn
        ? `Built-in variable "${node.name}" is recognized but not supported.`
        : `Variable "${node.name}" is not defined.`),
      severity: 'error',
      range: node.range,
      location: node.location,
      source: 'API Hero Variables',
    });
  }
  const seen = new Map<string, DirectiveNode>();
  for (const directive of document.directives) {
    if (directive.knownName !== 'variable' &&
        directive.knownName !== 'sensitive-variable') {
      continue;
    }
    const equals = directive.value.indexOf('=');
    const name = equals < 0 ? '' : directive.value.slice(0, equals).trim();
    const first = seen.get(name);
    if (name.length > 0 && first !== undefined) {
      diagnostics.push({
        code: VARIABLE_DIAGNOSTIC_CODES.duplicate,
        message: `Variable "${name}" is defined more than once in document scope.`,
        severity: 'error',
        range: directive.range,
        location: directive.location,
        source: 'API Hero Variables',
        relatedInformation: [{
          message: 'The first definition is here.',
          location: first.location,
        }],
      });
    } else {
      seen.set(name, directive);
    }
  }
  return diagnostics;
}

function deduplicateDiagnostics(items: readonly AstDiagnostic[]): readonly AstDiagnostic[] {
  const seen = new Set<string>();
  return Object.freeze(items.filter((item) => {
    const key = `${item.code}:${item.range.start.offset}:${item.range.end.offset}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }));
}

function methodRange(request: RequestNode): Range {
  const start = request.range.start;
  return {
    start,
    end: {
      line: start.line,
      column: start.column + request.method.length,
      offset: start.offset + request.method.length,
    },
  };
}

function directiveNameRange(directive: DirectiveNode): Range {
  const start = directive.range.start;
  return {
    start,
    end: {
      line: start.line,
      column: start.column + directive.name.length,
      offset: start.offset + directive.name.length,
    },
  };
}

function hoverFor(key: string, range: Range): RuntimeHover | undefined {
  const documentation = HOVER_DOCUMENTATION[key];
  return documentation === undefined ? undefined : { key, documentation, range };
}

function containsPosition(range: Range, position: Position): boolean {
  return (
    position.offset >= range.start.offset &&
    position.offset < range.end.offset
  );
}

function addDirectiveFold(
  folds: RuntimeFold[],
  startLine: number | undefined,
  endLine: number | undefined,
): void {
  if (
    startLine !== undefined &&
    endLine !== undefined &&
    endLine > startLine
  ) {
    folds.push({ startLine, endLine, kind: 'directives' });
  }
}

function completion(
  label: string,
  kind: RuntimeCompletionKind,
): RuntimeCompletion {
  return { label, kind };
}

function createLineData(source: string): {
  readonly lines: readonly string[];
  readonly offsets: readonly number[];
} {
  const lines: string[] = [];
  const offsets: number[] = [];
  let lineStart = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== '\r' && character !== '\n') {
      continue;
    }
    lines.push(source.slice(lineStart, index));
    offsets.push(lineStart);
    if (character === '\r' && source[index + 1] === '\n') {
      index += 1;
    }
    lineStart = index + 1;
  }
  lines.push(source.slice(lineStart));
  offsets.push(lineStart);
  return { lines, offsets };
}

function isRequestBoundary(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('###') &&
    (trimmed.length === 3 || isWhitespace(trimmed[3] ?? ''))
  );
}

function isWhitespaceThen(
  value: string,
  isAllowed: (character: string) => boolean,
): boolean {
  let contentStarted = false;
  for (const character of value) {
    if (!contentStarted && isWhitespace(character)) {
      continue;
    }
    contentStarted = true;
    if (!isAllowed(character)) {
      return false;
    }
  }
  return true;
}

function isDirectivePrefix(value: string): boolean {
  const trimmed = value.trimStart();
  const name = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return [...name].every(isDirectiveNameCharacter);
}

function isMimeValuePrefix(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon < 0) {
    return false;
  }
  const name = value.slice(0, colon).trim().toLowerCase();
  if (name !== 'accept' && name !== 'content-type') {
    return false;
  }
  const candidate = value.slice(colon + 1).trimStart();
  return ![...candidate].some(
    (character) => isWhitespace(character) || character === ',',
  );
}

function hasOpenVariable(value: string): boolean {
  return value.lastIndexOf('{{') > value.lastIndexOf('}}');
}

function endsCompletionBoundary(value: string): boolean {
  const last = value.at(-1) ?? '';
  return isWhitespace(last) || last === ':' || last === '=';
}

function isAsciiLetter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isHeaderNameCharacter(character: string): boolean {
  return isAsciiLetter(character) || character === '-';
}

function isDirectiveNameCharacter(character: string): boolean {
  return isAsciiLetter(character) || isAsciiDigit(character) || character === '-';
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t';
}
