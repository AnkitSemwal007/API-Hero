/**
 * Reserved ownership boundary for parser-wide registries.
 *
 * Directives, diagnostic codes, and token types currently have multiple
 * runtime owners. They intentionally remain in place until each migration can
 * preserve tokenizer, lexer, parser, and language-provider behavior.
 *
 * This module deliberately exports no values yet: adding duplicate registry
 * data before consumers migrate would create another competing source of
 * truth. HTTP methods are already shared through the framework-neutral
 * `src/types` boundary so runtime models do not depend on the parser. See
 * `docs/architecture/parser.md` for current owners and migration order.
 */
export {};
