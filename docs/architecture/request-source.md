# Request source serialization

Pure `.api` text generation and single-request projection for New Request and
the [Custom Text Editor](./request-editor.md). Lives in `src/request-source/` —
**no** `vscode`. Does not change the parser.

## API

| Export | Role |
| --- | --- |
| `RequestSourceDocument` | In-memory request model (name, method, url, headers, query, body, auth, timeout, expect, variables) |
| `serializeRequestDocument(model)` | Model → `.api` source string |
| `serializePlaceholderRequest(name)` | Minimal `GET https://httpbin.org/get` placeholder |
| `parseSourceToRequestDocument(text)` | Source → single / multi / empty projection |
| `documentToRequestSource(ast, text)` | Parsed AST → same projection |

Query parameters are encoded into the URL (`?a=1&b=2`) so runtime
`parseParameters(queryPart(url))` sees them. Layout is the single canonical
emitter for `.api` text (`@name`, `@description`, `@auth`, `@timeout`, METHOD
line, headers, body, `expect` lines).

## Integration

- `CollectionMutationService.createRequest(..., content?)` writes optional
  content; `createRequestFromModel` serializes then writes.
- `apiRunner.createRequest` opens the New Request webview dialog
  (`src/collections/vscode/new-request-dialog.ts`), preselecting collection /
  folder from tree context.
- Request Editor Custom Text Editor uses parse ↔ serialize for bidirectional
  sync — see [request-editor.md](./request-editor.md).
- OpenAPI import maps each operation to `RequestSourceDocument` and emits via
  `serializeRequestDocument` (scrubbing/diagnostics stay in openapi-import) —
  see [openapi-import.md](./openapi-import.md).
