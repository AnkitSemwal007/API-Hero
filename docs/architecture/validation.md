# Semantic validation architecture

## Pipeline and ownership

API language features use one forward pipeline:

```text
source
  -> tokenizer
  -> lexer
  -> parser
  -> ApiDocument
  -> semantic validator
  -> ValidationResult
  -> Request Builder
  -> immutable RuntimeRequest and language providers
```

`parseApiDocument()` owns tokenization, lexing, recoverable grammar parsing, and
construction of the canonical `ApiDocument`. The parser reports lexical and
syntactic failures. It does not resolve variables, execute authentication, or
decide whether parsed language constructs are meaningful.

`validateApiDocument(document)` accepts an already-parsed `ApiDocument`. It
does not accept source text and cannot reparse. It reports semantic diagnostics
such as missing request fields, duplicate headers and singleton directives,
unknown directives, invalid directive values, malformed element ordering, and
invalid parser-visible variable expressions. Validation never resolves a
variable, environment, connection, or authentication value.

## Rule architecture

`SemanticValidator` is a small rule runner. A `ValidationRule` contributes an
`id` and a `validate(document, context)` method. The default rules are split by
domain under `src/parser/validation/rules`:

- requests;
- headers;
- directives;
- variables and parser-visible references.

The engine builds shared request, header, directive, variable, and node indexes
with one AST traversal. Every rule receives those immutable indexes through
`ValidationContext`, so rules do not need to rebuild a tree or repeatedly walk
the document. A future domain contributes another `ValidationRule` and adds it
to the default rule list; the validator engine does not change. Callers may
also construct `SemanticValidator` or pass an explicit rule list to
`validateApiDocument` for focused validation.

Request-block identity is losslessly retained as parser metadata on requests
and directives. Rules use it to detect multiple request declarations and
duplicate singleton directives without scanning source lines.

## Diagnostics

Validation uses the canonical `AstDiagnostic` model. No validation-specific
diagnostic shape exists. Every diagnostic includes severity, message, stable
code, range, and location. Duplicate diagnostics include related information
pointing to the first declaration.

`ValidationResult` contains only semantic diagnostics and a `valid` flag.
Parser diagnostics remain on `ParserResult`. Integration boundaries combine
the two arrays once:

```ts
const parsed = parseApiDocument(source, { sourceId });
const validated = validateApiDocument(parsed.ast);
const diagnostics = [...parsed.diagnostics, ...validated.diagnostics];
```

The validator suppresses a semantic duplicate when the canonical document
already carries the same source occurrence from a lower layer. For example,
the tokenizer remains responsible for recognizing and locating an unterminated
`{{...}}` token; the variable rule validates equivalent malformed canonical
nodes created by other parser-compatible producers.

## Runtime provider integration

`RuntimeParserAdapter` parses once, validates the returned `ApiDocument`, and
exposes the combined canonical diagnostics. VS Code providers translate those
diagnostics, including related information, without applying validation rules.
The same adapter instance and immutable document are cached per URI and
document version.

The adapter retains source-level compatibility only where `ApiDocument` lacks
editor information:

- request-boundary line positions used to extend outline ranges; and
- incomplete cursor prefixes used to select completion candidates.

Duplicate directive, missing directive value, and `@timeout` checks no longer
exist in the adapter. They are permanent semantic rules.

## Current rule boundaries

Reserved-header validation is intentionally absent because the current
language defines completion candidates but no reserved-header policy. It
should be added only when a canonical convention exists.

Malformed header separators, malformed JSON, unknown method tokens, and
unterminated lexical variables remain syntax diagnostics from tokenizer,
lexer, or parser. Semantic rules validate the meaning of successfully
recovered nodes and avoid reporting the same source occurrence twice.

Validation does not perform HTTP execution, networking, authentication,
variable/environment resolution, persistence, history, response rendering,
AI behavior, or OpenAPI processing.

After successful parsing and semantic validation, execution-facing features
use the [Request Builder](request-builder.md) to enter the
[runtime domain](runtime.md). The builder does not add another diagnostic
model; its errors indicate violated caller preconditions.
