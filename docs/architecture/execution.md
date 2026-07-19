# HTTP execution architecture

## Pipeline and ownership

```text
immutable AuthenticatedRequest
  -> RequestExecutor
  -> serialized HttpTransportRequest
  -> HttpTransport
  -> immutable RuntimeResponse or ExecutionError
  -> ExecutionResult
```

The executor type boundary requires the post-variable, post-authentication
`AuthenticatedRequest` stage. `src/execution` owns execution contracts and implementations. It imports only
parser-free runtime types and Node platform APIs. It has no AST, parser,
validation, editor, storage, or VS Code dependency. Consumers should import
from `src/execution`; this dedicated barrel does not transitively load the
parser-coupled request builder. `src/request/request-executor.ts` is only a
compatibility type re-export.

`DefaultRequestExecutor` owns request serialization, timeout/cancellation,
timing, immutable response projection, and error classification.
`HttpTransport` is an injected I/O boundary. `NodeHttpTransport` is the
concrete adapter and uses the built-in `node:http` and `node:https` modules, so
execution adds no package dependency.

Extension activation now composes
`DefaultRequestExecutor(new NodeHttpTransport())` as the preferred request
execution implementation. The single-request orchestration flow builds one
selected runtime request and passes the active workflow `AbortSignal`; see
[request-execution-pipeline.md](./request-execution-pipeline.md).

The live product path is singular:

```text
orchestration → request builder → variables → auth → executor → response viewer
```

Legacy abstract service/repository scaffolding (`src/services`,
`src/connections`, `ResponseStore`) has been removed so it cannot compete with
this path. Request History is implemented as a dedicated subsystem — see
[history.md](./history.md).

## Public API

The primary API is:

```ts
execute(request: AuthenticatedRequest, context?: ExecutionContext):
  Promise<ExecutionResult>
```

`RuntimeExecutionOptions` remains request-owned configuration.
`ExecutionContext` owns per-call overrides (`timeoutMs`, `maxResponseBytes`, and
`AbortSignal`). `RequestExecutionOptions` is a compatibility alias of
`ExecutionContext`, not a parallel model.

Operational outcomes are returned as the discriminated `ExecutionResult`.
Programming contract violations, such as an invalid timeout supplied directly
by code or an invalid response from an injected transport, throw.

## Request serialization

`RuntimeRequest.url` is authoritative and is sent exactly once. Its
`queryParameters` collection is a duplicate-preserving projection for
consumers; execution never appends it to the URL, preventing builder-derived
parameters from being duplicated.

Headers are passed in declaration order with original casing and duplicate
entries. JSON, text, raw, and form bodies encode their authoritative `content`
as UTF-8. The executor does not regenerate JSON from `value` or form content
from `fields`. No implicit content-type header is added.

An empty multipart placeholder (`content === ""` and no parts) executes as a
zero-byte body. Any non-empty multipart content or parts returns
`UNSUPPORTED_BODY`; no boundary or file upload is invented. Binary bodies also
return `UNSUPPORTED_BODY` until a file-loading layer exists.

## Transport and redirects

`HttpTransport` receives only a serialized HTTP request and abort signal. The
Node adapter supports HTTP and HTTPS, certificate verification configuration,
ordered duplicate request/response headers, and redirect modes `follow`,
`manual`, and `error`. Follow mode defaults to 20 redirects when no maximum is
provided. For conventional HTTP behavior, 303 and POST responses with 301/302
become GET and remove entity headers/body; 307/308 retain method and body.

Cross-origin redirects are defined by a change in `URL.origin` (scheme,
hostname, or effective port). On a cross-origin hop the transport strips
`Authorization`, `Cookie`, and `Proxy-Authorization` case-insensitively. Same-
origin credentials are preserved. Whenever the redirect host (`hostname:port`)
changes, an explicit `Host` header is also stripped so Node recomputes it for
the next request.

Redirect-policy rejection (`mode: 'error'`), redirect limit/loop exhaustion,
and malformed or unsupported redirect targets are classified as non-retryable
`REDIRECT` failures. They are not transient `NETWORK` errors.

The raw transport response includes final URL, redirect count, and redirect
state where available. The executor detaches all data before publishing it.

Today transports fully buffer the response body into one `Uint8Array`. The
`HttpTransport` contract documents that a future streaming method (or streaming
response variant) can be added without redesigning `RuntimeResponseBody`.

## Timeout, size limits, and cancellation

The per-call timeout overrides the request timeout. Undefined or zero means no
timer. A caller signal and timeout feed one internal `AbortController`; the
first observed event determines classification. An already-aborted caller is
classified as `CANCELLED` before URL validation or transport work.

`ExecutionContext.maxResponseBytes` caps buffered response bodies. The setting
`apiRunner.maxResponseBytes` (default **10 MiB** / `10485760`) is supplied by
activation. `0` means unlimited. When the limit is exceeded while the Node
transport reads chunks, buffering aborts and execution returns non-retryable
`RESPONSE_TOO_LARGE`.

Execution races transport completion against abort, so a transport that
ignores its signal cannot delay timeout/cancellation completion. All caller
listeners and timeout handles are removed in `finally`. Late transport
resolution/rejection is observed but cannot mutate the already returned
immutable result.

## Response, errors, timing, and immutability

`RuntimeResponse` captures status code/text, ordered case-preserving headers,
body size, content type, final URL, redirects, and execution timing. Duplicate
response headers remain separate entries. Content type uses the last
case-insensitive header value.

`RuntimeResponseBody.bytes` is an `ImmutableBytes` seal: a thin frozen wrapper
over a privately detached `Uint8Array`. The transport concatenates chunks into
one owned buffer and transfers it; `freezeDetachedBytes` performs the single
public detach copy into that private buffer. Node cannot freeze TypedArray
elements, so the wrapper exposes `byteLength` / `length`, `at`, iteration, and
copy-out (`slice` / `copyOut`) without retaining a `number[]`. Prefer those APIs
over attempting to mutate published bytes. Text-like media types include decoded
UTF-8 text; valid JSON media types additionally include a deeply frozen JSON
value.

Timing uses one clock for ISO start/completion values and total duration,
including redirects and response buffering.

`ExecutionError` classifies malformed URL, unsupported body, timeout, caller
cancellation, DNS, SSL/TLS, connection refusal, generic network, redirect
policy/target failures, response-too-large, and unexpected runtime failures.
Retryability is explicit: `DNS`, `CONNECTION_REFUSED`, `NETWORK`, and `TIMEOUT`
are retryable; `SSL_TLS`, `REDIRECT`, `MALFORMED_URL`, `UNSUPPORTED_BODY`,
`CANCELLED`, `RESPONSE_TOO_LARGE`, and `UNEXPECTED` are not. Malformed-URL
messages redact URL userinfo while keeping the `MALFORMED_URL` classification.
Errors expose only copied/frozen name, code, and message cause metadata, never
a mutable native error. Unexpected errors use a stable public message.
Operational failures return `success: false`.

Every public result, response, timing object, header collection, body byte
buffer, parsed JSON value, error, and nested cause is deeply frozen.

The response presentation and VS Code viewer consume this boundary without
changing canonical response ownership; see [response.md](./response.md).

## Deferred future work

The following are intentionally deferred and must not be partially scaffolded
in competing unused modules:

- Secret lifecycle store/delete/orphan cleanup
- OAuth and broader auth enhancements
- Streaming transport (alternate `HttpTransport` method / streaming response)
- GraphQL, WebSocket, gRPC
- OpenAPI **export** and Swagger 2.0 (OpenAPI 3 import is implemented — see
  [openapi-import.md](./openapi-import.md))
- AI-assisted features
- Placeholder commands still contributed but not implemented:
  `apiRunner.runFile`, `apiRunner.login`, `apiRunner.logout`
  (thin stubs only; no unused service scaffolding)

Collection Runner (sequential batch execution via the orchestrator) is
implemented — see [collection-runner.md](./collection-runner.md). Request History
is implemented — see [history.md](./history.md). OpenAPI 3 import is implemented
— see [openapi-import.md](./openapi-import.md).

Document updates for deferred features should land with the implementing sprint.

## Future extensions

Authentication, variable/environment resolution, cookie persistence,
streaming, retries, proxies, multipart construction/file loading, and other
protocols remain outside this subsystem except where already integrated on the
live path above. Request History observes finished executions — see
[history.md](./history.md). The response viewer is a downstream consumer, not
part of execution. Run Request and CodeLens reach it through the orchestration
layer. Future transports can implement `HttpTransport`; future callers reuse
`RequestExecutor` without depending on parser or VS Code layers.

