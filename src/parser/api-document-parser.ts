import { Lexer } from './lexer';
import {
  Parser,
  type ParserOptions,
  type ParserResult,
} from './parser';

/**
 * Parses API source text into the canonical rich {@link ApiDocument} AST.
 *
 * This is the stable parser entry point for feature code. Tokenizer, lexer,
 * and parser classes remain available for compatibility and focused tooling,
 * but callers that need a parsed document should use this function.
 */
export function parseApiDocument(
  sourceText: string,
  options: ParserOptions = {},
): ParserResult {
  const lexical = new Lexer({ sourceId: options.sourceId }).lex(sourceText);
  return new Parser(lexical, options).parse();
}
