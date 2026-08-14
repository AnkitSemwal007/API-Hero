# Native API Request Editor

Custom Text Editor for single-request `.api` files (`viewType`:
`apiHero.requestEditor`). Form tabs stay in sync with the document buffer;
the parser and `.api` syntax are unchanged.

## Layout

```text
TextDocument (.api)
  ↔ parseSourceToRequestDocument / serializeRequestDocument
  ↔ RequestEditorProvider (CustomTextEditor)
  ↔ webview tabs (Request … Preview)
```

Core projection/serialization lives in `src/request-source/` (no `vscode`).
VS Code adapters live in `src/request-editor/vscode/`.

## Tabs

| Tab | Behavior |
| --- | --- |
| Request | Name, description, method, URL |
| Params | Query table ↔ URL query (`parseParameters` / serializer) |
| Headers | Key / Value / Enabled (disabled → `# Name: value`) |
| Body | REST: none / json / text / form / raw / multipart / binary. GraphQL (`@protocol graphql`): Query / Variables / Operation name — a projection of the JSON envelope `{ query, variables, operationName }`, not a second body format. |
| Auth | Centralized Authentication UI: No Auth, Bearer Token, Basic Auth, API Key; one-shot Bearer; Saved → `@auth <id>` (no secrets in webview) |
| Variables | `@variable` rows, `{{name}}` insert, read-only resolution preview, IntelliSense |
| Tests | Structured UI → `expect …` lines; assertion value field supports `{{vars}}` |
| Settings | `@timeout` only (no invented directives) |
| Preview | Read-only current document text |

Variable IntelliSense is available in URL, headers, params, body, GraphQL Query
and Variables, variables, and test value fields. Typing `{{` opens suggestions from the host catalog
(`variableCompletions`); selecting a name inserts `{{name}}` without
duplicating braces. Sensitive values never appear in the popup or inline
resolved preview.

## Sync

1. **Form → text:** webview posts `updateModel` (debounced 300ms). The host
   applies immediately (no second debounce), serializing concurrent applies and
   keeping only the latest pending model. After a successful `WorkspaceEdit`
   (or when content is unchanged), the host posts `ack` with the new
   `documentVersion` and redacted `sourceText` — the webview updates version /
   Preview only and does **not** rewrite form inputs. Form-originated document
   versions are ignored so change events do not echo into a full state refresh.
2. **Text → form:** `onDidChangeTextDocument` (debounced) for external edits →
   re-parse → full `state` message refreshes the form (`applyState`). Full state
   is also sent on `ready` / init and when parse mode is not single-request.
3. **Version mismatch:** if `updateModel.documentVersion` does not match the
   buffer, the host posts `resubmit` with the current version. The webview
   updates `documentVersion`, clears its debounce timer, and immediately posts
   `updateModel` with `currentModel()` (no debounce).
4. **`applyState` safeguards:** clears any pending form→host debounce; skips
   overwriting the focused field; only updates fields/tables when values differ.
   When focus is inside a table or list, the **entire** table/list is skipped
   (not just the focused cell/row) — accepted limitation for now. Form fields
   that were focus-skipped flush to the host on `blur` via `scheduleUpdate`.

## Multi-request files

When `parseApiDocument` yields **N ≠ 1** requests, the editor shows a banner and
does **not** rewrite the file from the form. Users can **Open With Text Editor**.

## Run

The Run button calls `ExecutionOrchestrator.runAtSourceLocation` for the document
(same pipeline as `apiHero.runRequest`). Custom editors do not rely on
`window.activeTextEditor`.

The toolbar protocol selector writes `@protocol` (`http` omits it; `graphql` /
`websocket` persist; unknown values are kept so save cannot coerce them to HTTP).
GraphQL Query/Variables compile to the existing JSON body; Run still uses
`ExecutionOrchestrator` (no second GraphQL executor). Editor envelope helpers in
the webview are a clone of `src/request-source/graphql-envelope.ts` (lenient
authoring). Runtime canonicalization stays in `prepareGraphqlHttpRequest`.
WebSocket chrome (Connection status, Messages recap, **Run Session**) is
presentation-only. One Run action still executes the bounded session through
`ExecutionOrchestrator`. The in-editor session recap consumes
`presentExecutionResult` / `PresentedWebsocketSession`, never `RuntimeResponse`.

## Tree Open

`CollectionNavigationService.openRequest` uses `vscode.openWith` +
`apiHero.requestEditor` when the file has exactly one discovered request;
multi-request files still open in the default text editor.

Command palette: `apiHero.openRequestEditor`.

## Security

CSP matches the response panel pattern: `default-src 'none'`, nonce-only
`style-src` / `script-src`, no remote connects. Auth secrets never enter the
webview — only profile ids/labels.
