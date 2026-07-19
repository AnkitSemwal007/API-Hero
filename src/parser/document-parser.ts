import type { Diagnostic, ParserAst } from '../models';

/**
 * Input accepted by the legacy asynchronous parser boundary.
 *
 * @deprecated Call `parseApiDocument(content, { sourceId })` from the parser
 * public API.
 */
export interface ParserInput {
  readonly sourceId: string;
  readonly content: string;
}

/**
 * Framework-neutral result returned by the legacy parser boundary.
 *
 * @deprecated Use the canonical `ParserResult` and its required
 * `ApiDocument` AST from the parser public API.
 */
export interface LegacyParserResult {
  readonly ast?: ParserAst;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parsing boundary used by the legacy parser service.
 *
 * @deprecated Call `parseApiDocument` from the parser public API. New
 * integrations must consume the canonical `ApiDocument` representation.
 */
export interface DocumentParser {
  parse(input: ParserInput): Promise<LegacyParserResult>;
}

/**
 * Compatibility name for the legacy result.
 *
 * @deprecated Import `LegacyParserResult` only when maintaining an existing
 * legacy consumer. New code should use the canonical `ParserResult`.
 */
export type ParserResult = LegacyParserResult;
