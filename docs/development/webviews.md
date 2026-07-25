# Webviews

Shared helpers live under `src/ui/webview/`:

| Export | Role |
| --- | --- |
| `createWebviewNonce` | Per-render nonce |
| `buildNonceOnlyCsp` | Strict CSP (inline script/style only with nonce) |
| `escapeHtml` / `escapeAttribute` | XSS-safe embedding |
| `isWebviewMessageRecord` | Closed message shape checks |
| `WEBVIEW_SHARED_CSS` / `methodBadgeClass` | Shared look-and-feel |

## CSP and security

- Default deny; allow only nonce-backed inline script and style.
- No remote resources, frames, forms, or command URIs in CSP.
- Escape every dynamic string before HTML insertion.
- Never post secrets to the webview; use masks (for example Request Editor `SENSITIVE_VARIABLE_MASK`).

## Message protocols

Each panel defines typed inbound/outbound messages and a `parse*Message` validator that ignores unknown shapes. Examples:

- Response viewer: `ready`, `copyBody`, `saveBody`, `copyHeaders`, …
- Request Editor: `ready`, `updateModel`, `run`, `ack`, `resubmit`, …
- Environment / Auth managers: load/save/error round-trips with dirty-state handling

Host code must treat webview messages as untrusted input.

## Request Editor sync model

`.api` text remains canonical. The custom editor:

1. Parses text → `RequestSourceDocument` for form mode.
2. On form edits, serializes back to text and applies to the document.
3. Uses `documentVersion` with `ack` / `resubmit` to avoid clobbering concurrent edits.
4. Multi-request files may show multi/empty modes instead of a single form.
5. Sensitive variables display as masks; on save, unchanged masks preserve prior values.

See `src/request-editor/vscode/request-editor-messages.ts` and [architecture/request-editor.md](../architecture/request-editor.md).

## Related

- [Development README](./README.md)
- [Architecture](../architecture/README.md)
