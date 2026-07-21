# Native API Request Editor

Custom Text Editor for single-request `.api` files (`viewType`:
`apiRunner.requestEditor`). Form tabs stay in sync with the document buffer;
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
| Body | none / json / text / form / raw / multipart / binary |
| Auth | Profile dropdown → `@auth <id>` (no secrets in webview) |
| Variables | `@variable` rows, `{{name}}` insert, read-only resolution preview |
| Tests | Structured UI → `expect …` lines |
| Settings | `@timeout` only (no invented directives) |
| Preview | Read-only current document text |

## Sync

1. **Form → text:** webview posts `updateModel` (debounced) → host serializes →
   full-document `WorkspaceEdit`. The written document version is recorded so
   the resulting change event is ignored (no echo loop).
2. **Text → form:** `onDidChangeTextDocument` (debounced) → re-parse →
   `state` message refreshes the form.
3. Version checks drop stale form edits when the buffer moved ahead.

## Multi-request files

When `parseApiDocument` yields **N ≠ 1** requests, the editor shows a banner and
does **not** rewrite the file from the form. Users can **Open With Text Editor**.

## Run

The Run button calls `ExecutionOrchestrator.runAtPosition` for the document
(same pipeline as `apiRunner.runRequest`). Custom editors do not rely on
`window.activeTextEditor`.

## Tree Open

`CollectionNavigationService.openRequest` uses `vscode.openWith` +
`apiRunner.requestEditor` when the file has exactly one discovered request;
multi-request files still open in the default text editor.

Command palette: `apiRunner.openRequestEditor`.

## Security

CSP matches the response panel pattern: `default-src 'none'`, nonce-only
`style-src` / `script-src`, no remote connects. Auth secrets never enter the
webview — only profile ids/labels.
