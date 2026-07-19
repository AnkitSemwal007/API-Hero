# Runtime architecture

## Ownership and boundary

`src/models/request.ts` owns the parser-independent runtime domain.
Staged runtime contracts (`RuntimeRequest` → `ResolvedRequest` →
`AuthenticatedRequest`) are the only inputs on the live execution path:

```text
source -> ApiDocument -> ValidationResult -> Request Builder
       -> RuntimeRequest -> variable resolution -> ResolvedRequest
       -> authentication -> AuthenticatedRequest -> RequestExecutor
       -> RuntimeResponse / ExecutionResult -> Response Viewer
```

Runtime models contain no AST nodes, source ranges, diagnostics, editor values,
VS Code APIs, storage handles, or parser services. Orchestration and the
executor accept these staged contracts, never `ApiDocument`, `RequestNode`,
diagnostics, or source text.

There is no networking or transport implementation in this layer. The builder
does not execute, reparse, resolve variables, select environments, read
secrets, authenticate, load files, persist cookies, or process OpenAPI.
See [request-execution-pipeline.md](./request-execution-pipeline.md) and
[execution.md](./execution.md) for the live wiring.

## RuntimeRequest

`RuntimeRequest` is the immutable execution contract. It contains:

- deterministic request identity, optional name, normalized method and URL;
- ordered, duplicate-preserving headers and encoded query parameters;
- ordered unresolved path and variable placeholders;
- a future-ready cookie collection;
- discriminated JSON, text, form, raw, multipart, and binary body shapes;
- unresolved authentication and environment placeholders;
- timeout, redirect, and SSL execution options;
- optional proxy, retry, and streaming extension contracts;
- normalized directives, metadata, tags, and description.

Multipart uses `RuntimeMultipartPart[]`, not `never[]`. The parser currently
does not produce parts, so the builder emits a frozen empty collection while
retaining the raw multipart content. Cookie, proxy, retry, streaming, binary,
OpenAPI, and multipart behavior remain unimplemented extension points on the
runtime builder path. OpenAPI **import** (spec → `.api` files) is a separate
subsystem — see [openapi-import.md](./openapi-import.md).

## Builder and validation preconditions

`buildRequest(document, validation?)` requires exactly one declaration.
`buildRequests(document, validation?)` explicitly builds every declaration in
source order. A single-request build never chooses among multiple targets.

Callers parse and semantically validate first. Passing the `ValidationResult`
to the builder makes that precondition explicit and rejects `valid: false`.
The optional argument preserves the existing API; when omitted, the caller is
still responsible for successful semantic validation. The builder performs
small invariant checks as a programming-error safety net and never creates
user-facing syntax or semantic diagnostics.

`RuntimeDomainError` is the common programming-error base.
`RequestBuildError` owns builder failures. `BuilderInvariantError` identifies
violated target, validation, directive, request, or body invariants.
`RequestBuilderError` remains in the inheritance chain for compatibility.
`InvalidRuntimeStateError` is reserved for an executor or resolution
boundary that receives unresolved or otherwise non-executable state.

## Deterministic normalization and immutability

The builder allocates detached runtime objects and deeply freezes every object
and collection. Runtime values do not alias parser nodes or parser-owned
arrays.

- Methods are uppercase and checked against the shared `HTTP_METHODS` registry.
- Leading/trailing request URL whitespace is removed; URL encoding and
  templates remain unchanged.
- Header names and values remove surrounding insignificant whitespace while
  preserving spelling, order, duplicates, and interior content.
- Query/form names and values remain encoded, ordered, and duplicate
  preserving. Missing and explicitly empty values remain distinct.
- Body content remains authoritative and is not trimmed. JSON additionally
  receives a detached immutable value projection.
- Directive names are lowercase without `@`; values remove surrounding
  whitespace. Directive order and duplicates are retained.
- Singleton directives use the last request-level value, then the last
  document-level value. Tags accumulate in source-scope order.

## Resolution pipeline

The builder emits `AuthenticationPlaceholder` and
`RuntimeEnvironmentPlaceholder`; it does not resolve them. Live variable and
authentication stages (outside this module) produce new deeply immutable
`ResolvedRequest` / `AuthenticatedRequest` values before execution. Secret
lookup belongs to the authentication resolver and must never move into the
builder.

Future cookie materialization, multipart part construction, file loading,
proxy selection, retry policy enhancements, streaming, and OpenAPI runtime
adaptation (distinct from OpenAPI import — see
[openapi-import.md](./openapi-import.md))
follow the same rule: resolution returns a new immutable request stage;
execution consumes only the authenticated contract.

## Compatibility

The `Runtime*` declarations are the source of truth. Existing public names
such as `Request`, `Header`, `RequestBody`, `RequestParameter`,
`RequestMetadata`, and `RequestSslOptions` are type aliases to those canonical
runtime declarations. They are not parallel structures. Existing
`timeoutMs`, `redirectPolicy`, `ssl`, `configuration`, and metadata placement
remain source-compatible.

`RequestExecutor` and `RequestService` now state `RuntimeRequest` explicitly.
Because `Request` is an alias of the same type, existing consumers continue to
compile while new execution-facing code communicates the runtime boundary.

Execution outcomes flow into the framework-neutral response presentation and
VS Code viewer described in [response.md](./response.md).
