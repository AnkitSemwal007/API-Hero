/**
 * JSON-friendly boolean expression parser/evaluator for scenario conditions.
 * Supports statusCode, headers["name"], {{name}} references, comparisons,
 * && / || / !, and parentheses. No code execution.
 */

export type ConditionAst =
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'statusCode' }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'unary'; readonly op: '!'; readonly argument: ConditionAst }
  | {
      readonly kind: 'binary';
      readonly op: '==' | '!=' | '>' | '>=' | '<' | '<=' | '&&' | '||';
      readonly left: ConditionAst;
      readonly right: ConditionAst;
    };

export interface ConditionEvaluationContext {
  readonly statusCode?: number;
  /** Header lookup is case-insensitive. */
  readonly headers?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  /** Resolved variable values keyed by bare name (no braces). */
  readonly variables: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

export type ParseConditionExpressionResult =
  | { readonly ok: true; readonly ast: ConditionAst }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface EvaluateConditionExpressionResult {
  readonly ok: boolean;
  readonly result?: boolean;
  readonly usedVariables: readonly string[];
  readonly errors: readonly string[];
}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'ident'; readonly value: string }
  | { readonly kind: 'variable'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string }
  | { readonly kind: 'lparen' }
  | { readonly kind: 'rparen' }
  | { readonly kind: 'lbracket' }
  | { readonly kind: 'rbracket' };

function tokenize(input: string): { readonly ok: true; readonly tokens: readonly Token[] } | { readonly ok: false; readonly errors: readonly string[] } {
  const tokens: Token[] = [];
  let i = 0;
  const errors: string[] = [];

  const peek = (): string => input[i] ?? '';
  const advance = (): string => input[i++] ?? '';

  while (i < input.length) {
    const ch = peek();
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === '[') {
      tokens.push({ kind: 'lbracket' });
      i += 1;
      continue;
    }
    if (ch === ']') {
      tokens.push({ kind: 'rbracket' });
      i += 1;
      continue;
    }

    if (ch === '{' && input[i + 1] === '{') {
      i += 2;
      let name = '';
      while (i < input.length && !(input[i] === '}' && input[i + 1] === '}')) {
        name += advance();
      }
      if (!(input[i] === '}' && input[i + 1] === '}')) {
        errors.push('Unclosed variable reference {{...}}.');
        break;
      }
      i += 2;
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        errors.push('Empty variable reference {{}}.');
        break;
      }
      tokens.push({ kind: 'variable', value: trimmed });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = advance();
      let value = '';
      let closed = false;
      while (i < input.length) {
        const c = advance();
        if (c === quote) {
          closed = true;
          break;
        }
        if (c === '\\') {
          value += advance();
          continue;
        }
        value += c;
      }
      if (!closed) {
        errors.push('Unclosed string literal.');
        break;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }

    if (/[0-9]/u.test(ch) || (ch === '-' && /[0-9]/u.test(input[i + 1] ?? ''))) {
      let raw = advance();
      while (/[0-9.]/u.test(peek())) raw += advance();
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        errors.push(`Invalid number "${raw}".`);
        break;
      }
      tokens.push({ kind: 'number', value: num });
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '!') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }

    if (/[A-Za-z_]/u.test(ch)) {
      let ident = '';
      while (/[A-Za-z0-9_./-]/u.test(peek())) ident += advance();
      if (ident === 'true' || ident === 'false') {
        tokens.push({ kind: 'boolean', value: ident === 'true' });
      } else if (ident === 'null') {
        tokens.push({ kind: 'null' });
      } else {
        tokens.push({ kind: 'ident', value: ident });
      }
      continue;
    }

    errors.push(`Unexpected character "${ch}" at position ${i}.`);
    break;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, tokens };
}

class Parser {
  private index = 0;
  public constructor(private readonly tokens: readonly Token[]) {}

  public parse(): ConditionAst {
    const ast = this.parseOr();
    if (this.index < this.tokens.length) {
      throw new Error('Unexpected trailing tokens in condition expression.');
    }
    return ast;
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.current();
    if (token === undefined) throw new Error('Unexpected end of expression.');
    this.index += 1;
    return token;
  }

  private matchOp(...ops: readonly string[]): string | undefined {
    const token = this.current();
    if (token?.kind === 'op' && ops.includes(token.value)) {
      this.index += 1;
      return token.value;
    }
    return undefined;
  }

  private parseOr(): ConditionAst {
    let left = this.parseAnd();
    while (this.matchOp('||')) {
      left = { kind: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ConditionAst {
    let left = this.parseEquality();
    while (this.matchOp('&&')) {
      left = { kind: 'binary', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): ConditionAst {
    let left = this.parseComparison();
    for (;;) {
      const op = this.matchOp('==', '!=');
      if (op === undefined) break;
      left = {
        kind: 'binary',
        op: op as '==' | '!=',
        left,
        right: this.parseComparison(),
      };
    }
    return left;
  }

  private parseComparison(): ConditionAst {
    let left = this.parseUnary();
    for (;;) {
      const op = this.matchOp('>', '>=', '<', '<=');
      if (op === undefined) break;
      left = {
        kind: 'binary',
        op: op as '>' | '>=' | '<' | '<=',
        left,
        right: this.parseUnary(),
      };
    }
    return left;
  }

  private parseUnary(): ConditionAst {
    if (this.matchOp('!')) {
      return { kind: 'unary', op: '!', argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ConditionAst {
    const token = this.consume();
    if (token.kind === 'lparen') {
      const inner = this.parseOr();
      const close = this.consume();
      if (close.kind !== 'rparen') throw new Error('Expected ")" after expression.');
      return inner;
    }
    if (token.kind === 'number') return { kind: 'literal', value: token.value };
    if (token.kind === 'string') return { kind: 'literal', value: token.value };
    if (token.kind === 'boolean') return { kind: 'literal', value: token.value };
    if (token.kind === 'null') return { kind: 'literal', value: null };
    if (token.kind === 'variable') return { kind: 'variable', name: token.value };
    if (token.kind === 'ident') {
      if (token.value === 'statusCode') return { kind: 'statusCode' };
      if (token.value === 'headers') {
        const open = this.consume();
        if (open.kind !== 'lbracket') throw new Error('Expected "[" after headers.');
        const nameToken = this.consume();
        if (nameToken.kind !== 'string') {
          throw new Error('headers[...] requires a string header name.');
        }
        const close = this.consume();
        if (close.kind !== 'rbracket') throw new Error('Expected "]" after header name.');
        return { kind: 'header', name: nameToken.value };
      }
      // Bare identifier treated as variable name (same as {{name}}).
      return { kind: 'variable', name: token.value };
    }
    throw new Error('Unexpected token in condition expression.');
  }
}

/** Parses a condition expression into an AST. */
export function parseConditionExpression(expression: string): ParseConditionExpressionResult {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ['Condition expression must be non-empty.'] };
  }
  const tokens = tokenize(trimmed);
  if (!tokens.ok) return tokens;
  try {
    return { ok: true, ast: new Parser(tokens.tokens).parse() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Failed to parse expression.';
    return { ok: false, errors: [message] };
  }
}

function lookupVariable(
  name: string,
  variables: ConditionEvaluationContext['variables'],
): string | undefined {
  const bare = name.startsWith('scenario.') ? name.slice('scenario.'.length) : name;
  if (!(variables instanceof Map)) {
    const record = variables as Readonly<Record<string, string>>;
    return record[bare] ?? record[name];
  }
  return variables.get(bare) ?? variables.get(name);
}

function lookupHeader(
  name: string,
  headers: ConditionEvaluationContext['headers'],
): string | undefined {
  if (headers === undefined) return undefined;
  const needle = name.toLowerCase();
  if (headers instanceof Map) {
    for (const [key, value] of headers.entries()) {
      if (key.toLowerCase() === needle) return value;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) return value;
  }
  return undefined;
}

function toComparable(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    const num = Number(trimmed);
    if (trimmed.length > 0 && Number.isFinite(num) && /^-?\d+(\.\d+)?$/u.test(trimmed)) {
      return num;
    }
    return value;
  }
  return String(value);
}

function compareValues(
  op: '==' | '!=' | '>' | '>=' | '<' | '<=',
  left: unknown,
  right: unknown,
): boolean {
  const l = toComparable(left);
  const r = toComparable(right);
  switch (op) {
    case '==':
      return l === r;
    case '!=':
      return l !== r;
    case '>':
    case '>=':
    case '<':
    case '<=': {
      if (typeof l !== 'number' || typeof r !== 'number') return false;
      if (op === '>') return l > r;
      if (op === '>=') return l >= r;
      if (op === '<') return l < r;
      return l <= r;
    }
  }
}

function evalAst(
  ast: ConditionAst,
  context: ConditionEvaluationContext,
  used: Set<string>,
  errors: string[],
): unknown {
  switch (ast.kind) {
    case 'literal':
      return ast.value;
    case 'statusCode':
      if (context.statusCode === undefined) {
        errors.push('statusCode is unavailable (no prior request response).');
        return undefined;
      }
      return context.statusCode;
    case 'header': {
      const value = lookupHeader(ast.name, context.headers);
      if (value === undefined) {
        errors.push(`Header "${ast.name}" is unavailable.`);
        return undefined;
      }
      return value;
    }
    case 'variable': {
      used.add(ast.name.startsWith('scenario.') ? ast.name.slice('scenario.'.length) : ast.name);
      const value = lookupVariable(ast.name, context.variables);
      if (value === undefined) {
        errors.push(`Variable "${ast.name}" is unresolved.`);
        return '';
      }
      return value;
    }
    case 'unary': {
      const arg = evalAst(ast.argument, context, used, errors);
      return !truthy(arg);
    }
    case 'binary': {
      if (ast.op === '&&') {
        const left = evalAst(ast.left, context, used, errors);
        if (!truthy(left)) return false;
        return truthy(evalAst(ast.right, context, used, errors));
      }
      if (ast.op === '||') {
        const left = evalAst(ast.left, context, used, errors);
        if (truthy(left)) return true;
        return truthy(evalAst(ast.right, context, used, errors));
      }
      const left = evalAst(ast.left, context, used, errors);
      const right = evalAst(ast.right, context, used, errors);
      return compareValues(ast.op, left, right);
    }
  }
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0 && value !== 'false' && value !== '0';
  return Boolean(value);
}

/** Evaluates a condition expression against a secret-safe context. */
export function evaluateConditionExpression(
  expression: string,
  context: ConditionEvaluationContext,
): EvaluateConditionExpressionResult {
  const parsed = parseConditionExpression(expression);
  if (!parsed.ok) {
    return { ok: false, usedVariables: [], errors: parsed.errors };
  }
  const used = new Set<string>();
  const errors: string[] = [];
  const value = evalAst(parsed.ast, context, used, errors);
  if (errors.some((e) => e.includes('unavailable') || e.includes('Unclosed') || e.includes('Invalid'))) {
    // Soft errors for missing vars still yield a boolean; hard parse already handled.
  }
  return {
    ok: errors.filter((e) => e.includes('unavailable') && e.includes('statusCode')).length === 0,
    result: truthy(value),
    usedVariables: [...used].sort((a, b) => a.localeCompare(b)),
    errors,
  };
}
