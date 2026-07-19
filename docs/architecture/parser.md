# Parser architecture

## Decision

`ApiDocument` is the canonical parsed representation of an API source file.
All new parser-backed features must call `parseApiDocument(sourceText, options)`
from `src/parser` and consume the returned `ParserResult`.

No new parser, document, request, syntax-tree, or line-analysis model may be
introduced. Extend `ApiDocument` and its node union when the language requires
new syntax. A short-lived adapter is allowed only at an existing integration
boundary and must not become a feature-facing representation.

## Stable public API

```ts
import { parseApiDocument } from './parser';

const result = parseApiDocument(sourceText, { sourceId });
// result.ast is always ApiDocument
// result.diagnostics contains recoverable parser diagnostics
```

`parseApiDocument` is the one recommended stable parsing entry point. It owns
the complete source-text pipeline and returns the rich, recoverable AST.

`Parser`, the lower-level `parse` function, `Lexer`, and `tokenize` remain
exported for compatibility and focused parser tooling. `Parser` and `parse`
are deprecated as feature entry points. Token and lexical result shapes are
pipeline contracts, not alternate parsed document models.

The old asynchronous `DocumentParser` contract remains available only for
existing consumers. Its result is named `LegacyParserResult`; the old
`document-parser` `ParserResult` name is a deprecated compatibility alias.
The unqualified `ParserResult` exported by `src/parser` always means the
canonical result containing a required `ApiDocument`.

## Pipeline and ownership

Dependency direction is one way:

```text
source text
  -> tokenizer
  -> lexer
  -> parser
  -> ApiDocument + parser AstDiagnostic[]
  -> semantic validator
  -> ValidationResult
  -> Request Builder
  -> immutable RuntimeRequest and feature adapters
```

- **Tokenizer** (`src/parser/tokenizer`) owns character scanning, raw `Token`
  production, source coordinates, and tokenizer diagnostics. It does not
  construct syntax nodes.
- **Lexer** (`src/parser/lexer`) owns normalization from tokenizer tokens to
  parser-ready `LexicalToken` values and lexer diagnostics. It may depend on
  tokenizer contracts, never on AST consumers or VS Code.
- **Parser** (`src/parser/parser.ts`) owns grammar, recovery, parser
  diagnostics, and construction of the canonical AST. It consumes lexer
  output and uses the AST builder.
- **AST** (`src/parser/ast/models.ts`) owns `ApiDocument`, all canonical node
  contracts, discriminants, source locations, metadata, and AST diagnostics.
  AST contracts are framework-independent.
- **Diagnostics** are created at the layer that detects a problem and are
  normalized into `AstDiagnostic` by the parser. Features consume canonical
  diagnostics and must not define another parser diagnostic model.
- **Semantic validation** (`src/parser/validation`) operates only on an
  already-parsed `ApiDocument`, contributes modular domain rules, and returns
  `ValidationResult`. See [validation.md](validation.md) for rule ownership,
  diagnostic flow, and extension points.
- **Builders** (`src/parser/ast/builder.ts`) own immutable node construction,
  child lists, parent links, ranges, and locations. Builders do not parse
  source text.
- **Visitors/traversal** (`src/parser/ast/traversal.ts`) own framework-neutral
  navigation over `AstNode`. Features should traverse the AST through these
  helpers rather than rebuilding a second tree.

Core parser layers must not depend on language providers, VS Code APIs,
services, storage, execution, or UI modules. Integration dependencies point
toward the parser.

## Current representations

The repository currently contains these parse-related representations:

1. `ApiDocument` and `AstNode` in `src/parser/ast`: canonical and supported for
   all future features.
2. `ParserResult` in `src/parser/parser.ts`: canonical result containing a
   required `ApiDocument`.
3. `TokenizeResult`/`Token` and `LexerResult`/`LexicalToken`: internal pipeline
   stage contracts, not document representations.
4. `ParserAst`, `ParserAstNode`, and `SourceRange` in `src/models/parser-ast.ts`:
   legacy generic tree, deprecated.
5. `DocumentParser`, `ParserInput`, and `LegacyParserResult` in
   `src/parser/document-parser.ts`, plus `ParserService`: legacy asynchronous
   orchestration contracts, deprecated.
6. `LineAnalysis`, `RequestLine`, `LanguageDiagnostic`, `FoldRegion`, and
   `LineSpan` in `src/language-support/core`: deprecated compatibility
   contracts. Runtime providers no longer consume them.

The request and diagnostic domain models elsewhere under `src/models` are
application models, not parser ASTs. They must be produced through explicit
adapters when runtime integration begins; they must not replace
`ApiDocument`.

## Deprecation and compatibility

Legacy contracts are retained and marked with TypeScript/JSDoc `@deprecated`
so existing consumers continue to compile. New imports should be rejected in
review unless they maintain an existing compatibility boundary.

Runtime language providers are migrated to the canonical parser through
`RuntimeParserAdapter`. The deprecated line-analysis exports remain available
to preserve public API compatibility, but have no runtime provider consumers.
Tokenizer, lexer, and parser public APIs remain unchanged.

Remaining migration sequence:

1. Adapt or remove `DocumentParser`/`ParserService` consumers.
2. Remove deprecated line-analysis and legacy parser exports only in an
   explicitly announced breaking change.

## Shared registries

`src/parser/registry` is reserved as the eventual canonical ownership boundary
for parser-owned directives, diagnostic codes, and token types. It exports no
runtime values today because copying current values there before migrating
consumers would create another competing source of truth. HTTP methods are
shared by parser, runtime, and language support through the framework-neutral
`HTTP_METHODS` declaration in `src/types`.

Current ownership is distributed:

- HTTP methods: consolidated; `ApiHttpMethod` and runtime `HttpMethod` derive
  from the shared tuple used by tokenizer and language support.
- Directives: lexer, AST `KNOWN_DIRECTIVE_NAMES`, and language constants.
- Diagnostic codes: tokenizer diagnostics, lexer diagnostic types, parser
  literals, and language diagnostic constants.
- Token types: tokenizer `TokenKind` and the lexer's normalized lexical kinds.

Future registry work must move one category at a time, update every affected
consumer in the same change, and preserve emitted values. Until then, edit the
current owning layer and keep duplicates synchronized; do not add a new list.

## Runtime language-provider integration

Runtime integration is complete for document symbols, hover, completion,
folding, and diagnostics.

```text
VS Code TextDocument
  -> RuntimeParserAdapter(source text, source ID)
  -> parseApiDocument()
  -> ApiDocument + AstDiagnostic[]
  -> validateApiDocument(ApiDocument)
  -> ValidationResult
  -> combined canonical diagnostics
  -> framework-neutral runtime projections
  -> provider translation to VS Code types
```

The VS Code registration boundary keeps one adapter per document URI and
version, allowing diagnostics and provider requests for the same immutable
document version to reuse one `ParserResult`. A changed version replaces the
entry, document close removes it, and registration disposal clears the cache.
The cache is not global and does not enter the parser or framework-neutral
adapter layers.

### Adapter responsibilities

`src/language-support/core/runtime-parser-adapter.ts` is the only runtime
language integration boundary. It:

- calls the stable `parseApiDocument` entry point;
- derives outline symbols from `RequestNode`, `DirectiveNode`, and canonical
  ranges;
- derives method/directive hover targets from recognized AST nodes;
- derives request, directive-group, and nested JSON folding from AST ranges;
- validates the parsed document and exposes parser plus semantic canonical
  `AstDiagnostic` values exactly once;
- classifies incomplete cursor prefixes for completion and returns
  framework-neutral completion descriptions.

The adapter contains no VS Code imports or types. It is not another syntax tree
and does not expose a competing document model.

### Provider ownership

`src/language-support/language-providers.ts` owns only VS Code lifecycle and
translation:

- registration and disposal;
- feature-setting gates;
- conversion between parser and VS Code positions/ranges;
- construction of `DocumentSymbol`, `Hover`, `CompletionItem`,
  `FoldingRange`, and `Diagnostic` values.

Providers do not scan lines, apply syntax regular expressions, validate
language constructs, or construct parser nodes.

### Temporary compatibility paths

The canonical AST currently omits two pieces of lossless editor context:

1. request-boundary (`###`) line nodes used by outline ranges; and
2. cursor context for syntactically incomplete completion prefixes.

The adapter performs small source-level checks for those two cases. Boundary
checks preserve outline block starts. Completion prefix classification
preserves existing method, directive, header, MIME, and variable suggestions
while a line is incomplete. These checks do not create syntax nodes and must
be removed when the parser exposes equivalent boundary and cursor-context APIs.

Request-block identity needed by semantic rules is retained as canonical node
metadata, so duplicate directives and multiple request declarations do not use
the compatibility source scan. Duplicate singleton directives, missing
directive values, non-integer `@timeout` values, missing URLs, and unknown
directives are owned by `src/parser/validation`. Malformed tokens, header
separators, variables, and JSON remain lower-layer syntax diagnostics.

Execution and request services must consume the immutable `RuntimeRequest`
projection described by the [runtime architecture](runtime.md) and produced by
the [Request Builder](request-builder.md); they must not accept parser nodes
or parse source independently. Authentication, variables, environments,
history, storage, webviews, AI, and response viewing remain outside this
integration.
