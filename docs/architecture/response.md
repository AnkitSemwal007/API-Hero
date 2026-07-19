# Response domain and viewer architecture

## Lifecycle and ownership

```text
AuthenticatedRequest
  -> RequestExecutor
  -> immutable ExecutionResult / RuntimeResponse
  -> presentExecutionResult
  -> immutable ResponsePresentation
  -> ResponseViewerService
  -> VS Code WebviewPanel
```

`RuntimeResponse` in `src/execution` is the canonical transport response.
`src/response/presentation.ts` creates the framework-neutral, user-facing
projection. It does not import VS Code, parser, AST, validation, storage, or
networking code and never mutates its source result.

Canonical body bytes are an `ImmutableBytes` seal on `RuntimeResponseBody.bytes`
(see [execution.md](./execution.md)). Presentation reads that buffer for binary
hex previews without converting to a number array. Persistence/history models
and `ResponseStore` scaffolding were removed; when persistence returns it should
derive from `RuntimeResponse` / `ExecutionResult` rather than a parallel truth.

Execution results carry an optional detached `ExecutionRequestSummary` with
method and original URL. The field is additive and optional for compatibility
with existing result producers; `DefaultRequestExecutor` always supplies it.

See [execution.md](./execution.md) for transport behavior and
[runtime.md](./runtime.md) for request ownership.

## Presentation adapter

`presentExecutionResult(result)` creates a deeply frozen
`ResponsePresentation`. Successful projections include status, ordered
headers, a cookie placeholder, timing, header/body/estimated response sizes,
content type, charset, original request URL/method, final URL, redirects, body
preview, and a concise summary. Failures map every `ExecutionErrorCode` to a
structured title, message, retryability, safe cause metadata, and timing
(including `RESPONSE_TOO_LARGE`).

Header order and duplicate names remain visible. `Authorization`,
`Proxy-Authorization`, `Cookie`, and `Set-Cookie` values are always replaced
with a fixed mask before reaching HTML. URL user information is also redacted
via the shared URL helper. The cookie projection exposes only the number of
Set-Cookie headers; it does not parse, reveal, or store cookies.

Body language selection starts with media type and falls back to conservative
sniffing for already-decoded text. JSON retains the exact decoded source for
Raw mode and uses a detached parsed value for Pretty mode. Malformed JSON falls
back to source. HTML and XML are always displayed as source.

## Viewer and webview boundary

`ResponseViewerService` is the stable public API:

```ts
show(result: ExecutionResult): void
update(result: ExecutionResult): void
dispose(): void
```

It owns one reusable panel and accepts a narrow `ResponseViewerPanelFactory`.
This makes update, reuse, user-close, and disposal behavior testable without a
VS Code host. `VsCodeResponsePanelFactory` is the only VS Code-specific adapter.
Activation registers the viewer once and injects it into the preferred
single-request `ExecutionOrchestrator`. Run Request and CodeLens execution now
show the latest `ExecutionResult` automatically through this shared service;
see [request-execution-pipeline.md](./request-execution-pipeline.md).

Each update replaces the complete immutable view state and generates a new
nonce. Pretty/Raw and JSON expansion are document-local state and reset when a
new result is shown. No response history or persisted UI state is introduced.

## Rendering and security

The webview is self-contained. Its CSP defaults to no access and permits only
the per-render nonce for inline style and script; remote resources, connections,
frames, objects, forms, base URL changes, and command URIs are absent. The VS
Code panel has scripts enabled only for local view controls and has no local
resource roots.

Every request, response, error, cause, header, and body string is HTML-escaped
before insertion. Highlighting emits escaped text plus fixed class names. HTML
and XML bodies are never mounted as markup. JSON trees use fixed generated
elements and escaped keys/values. The only webview-to-host message is the
payload-free `{ type: "ready" }` shape, checked by a closed validator; unknown
commands and extra properties are ignored.

CSS uses VS Code foreground, background, border, focus, button, editor, and
symbol variables. It declares light/dark color-scheme support, responsive
layouts, keyboard focus styles, semantic table/tree markup, and forced-colors
rules for high-contrast environments.

## Large and binary responses

The presentation adapter deterministically limits decoded text previews to
256 KiB of UTF-16 characters and binary previews to 4 KiB of bytes. It reports
displayed and canonical sizes and clearly marks truncation. Pretty parsing is
not repeated for truncated JSON. The canonical `RuntimeResponse` remains
unchanged and available to non-viewer consumers.

Execution enforces `apiRunner.maxResponseBytes` (default 10 MiB) while
buffering; `0` means unlimited. Oversized downloads fail with
`RESPONSE_TOO_LARGE` before a viewer model is built. Viewer truncation remains
a display concern for responses that fit under that cap.

## Deferred future work

History, cookie details beyond Set-Cookie counts, redirect-chain UI,
download/save/diff, and streaming body presentation remain deferred or belong
to other subsystems. Request History is metadata-only — see
[history.md](./history.md). Collections organization is separate — see
[collections.md](./collections.md). Do not reintroduce unused
store/service scaffolding ahead of those features.

## Future extensions

The presentation and panel seams reserve room for cookie details, redirect
chains, richer binary previews, download, search, save, and diff. Those
features require explicit contracts and security/privacy decisions and are not
implemented here. They should extend the canonical execution result or derive
new presentation projections rather than introducing another response model.

