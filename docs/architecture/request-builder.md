# Request Builder architecture

## Purpose and ownership

The Request Builder is the boundary between the canonical language model and
future runtime execution:

```text
source
  -> parseApiDocument()
  -> ApiDocument
  -> validateApiDocument(ApiDocument)
  -> Request Builder
  -> immutable RuntimeRequest
  -> future execution engine
```

`src/request/request-builder.ts` owns the one-way projection from parser AST
nodes to parser-independent runtime models in `src/models/request.ts`. The
complete runtime boundary is documented in [runtime.md](runtime.md). Runtime
models do not contain AST nodes, source ranges, validation results, VS Code
types, or editor objects. An execution engine must accept `RuntimeRequest`; it must
not accept `ApiDocument` or `RequestNode` and must not parse source itself.

The builder performs no HTTP execution, networking, authentication, variable
or environment resolution, persistence, cookie handling, OpenAPI processing,
or response work.

## Public API and target selection

`buildRequest(document)` is the primary API. It requires exactly one request
declaration. A document with zero requests or more than one request throws
`BuilderInvariantError` with code `REQUEST_COUNT`; the builder never silently
selects a declaration.

The grammar also permits multiple valid request blocks. `buildRequests(document)`
is the complementary explicit API for that case. It returns all requests in
source order as a frozen collection. This keeps single-request callers simple
without making multi-request target selection ambiguous.

## Parser and validator relationship

Callers must first parse and semantically validate:

```ts
const parsed = parseApiDocument(source, { sourceId });
const validation = validateApiDocument(parsed.ast);

if (parsed.diagnostics.length === 0 && validation.valid) {
  const request = buildRequest(parsed.ast, validation);
}
```

The builder assumes those preconditions. It does not invoke validation and
does not define diagnostics. `RequestBuildError` represents a programming or
precondition failure such as an invalid target count, a failed supplied
validation result, an invalid request invariant, or an unsupported body node.
`BuilderInvariantError` is the concrete builder error; `RequestBuilderError`
remains a compatibility base. These errors do not replace syntax or semantic
diagnostics.

## Runtime model and immutability

`RuntimeRequest` is transport-independent and contains:

- method and unchanged URL;
- ordered headers, query parameters, and path placeholders;
- body plus an explicit body type;
- unresolved authentication, environment, and variable placeholders;
- a future-ready cookie collection;
- request name, timeout, redirect policy, SSL options, metadata, and runtime
  configuration.

`Request` is a compatibility alias of `RuntimeRequest`, not a second model.
The builder allocates fresh runtime values and deeply freezes all nested
objects and arrays. Runtime values never alias mutable parser metadata or AST
collections. Strings and numbers are copied by value. JSON receives a detached,
deeply frozen structured projection while its original parser-produced text
remains the authoritative `content`.

## Deterministic normalization

- Header spelling, values, declaration order, and duplicate entries are
  preserved.
- The original URL is unchanged.
- Query parameters are split on `&` after the first `?` and before `#`.
  Names and values remain encoded. Declaration order and duplicates are
  preserved. A missing value (`flag`) differs from an empty value (`flag=`).
- Path parameters are unresolved `{{name}}` occurrences from the path portion
  of the URL. Their order and duplicates are preserved.
- Variables remain unresolved placeholders. Their runtime list follows source
  order across effective document directives and the request.
- Request directives override document directives for singleton runtime
  settings. Within one scope, the last declaration wins deterministically;
  semantic validation remains responsible for duplicate warnings.
- Tags accumulate document values before request values.
- IDs are deterministic: `<sourceId-or-document>#request-<one-based-index>`.
- Redirect behavior defaults to `follow`; SSL certificate verification
  defaults to `true`. Neither default performs transport work.

Raw parser bodies remain raw unless existing information permits a lossless
classification. `text/*` content is represented as text.
`application/x-www-form-urlencoded` content is represented as form data with
ordered, encoded, duplicate-preserving fields. JSON retains both original
content and an immutable structured value. The AST's reserved multipart shape
maps to an unresolved multipart body with no parsed parts. Its stable part
contract is extensible rather than `never[]`; no multipart syntax is added.
Binary bodies remain unresolved content references.

## Future extension points

Stable placeholders prevent future features from changing the builder entry
points:

- `authentication` carries an unresolved reference and extension bag;
- `variables` retains unresolved occurrences for a later environment layer;
- runtime `configuration` retains normalized directives and connection
  references;
- SSL options reserve client-certificate references without loading secrets;
- body discriminants reserve multipart and binary handling;
- metadata and extension bags can carry runtime-safe OpenAPI or labeling data;
- ordered header and parameter collections can later support cookies without
  collapsing duplicates.

Cookie materialization, multipart parsing, file streaming, variable and
environment resolution, authentication resolution, OpenAPI adaptation, and
transport execution belong to later layers. They must produce or consume the
same immutable `RuntimeRequest` contract rather than widening the builder interface.
