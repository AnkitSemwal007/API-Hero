# Source-code integration (VS Code)

API Hero can **Quick Run** a detectable `fetch("https://...")` call, and can show **CodeLens**, **hover**, and **Go to definition** between application source files and `.api` requests when the mapping is explicit.

This is a VS Code editor feature. It is not available in the CLI or Desktop.

## Quick Run vs persistent mapping

These two use cases coexist. Quick Run never replaces `@api-hero`.

```text
source API call
↓
Run Request
↓
detect request
↓
reuse existing API request OR synthesize temporary request
↓
ExecutionOrchestrator
```

| | **Quick Run** | **Persistent mapping** |
| --- | --- | --- |
| Annotation | `@api-hero` is **not** required | `@api-hero` **is** required |
| How you run | Right-click a JS/TS `fetch("https://...")` → API Hero → Run Request, or Command Palette with the cursor on that call | CodeLens **Run Request**, Command Palette, or context menu on the annotated line |
| What runs | The unique matching `.api` file (reused as-is), a QuickPick choice when several match, or a **temporary** synthesized request | The uniquely mapped `.api` request |
| CodeLens / Open API Definition / Generate TypeScript | Not offered from a bare URL | Only when the annotation uniquely identifies one request |
| Saved to Collections | Temporary runs are **not** saved | Uses the existing `.api` file |

Matching for Quick Run is **exact method + concrete `http://` / `https://` URL** after a small normalize (lowercase host, strip default ports, strip a trailing slash except `/`, keep the query string). There is no fuzzy matching and **no variable expansion** — a catalog URL such as `{{baseUrl}}/products` never matches `https://api.example.com/products`. GraphQL and WebSocket catalog entries are skipped.

If several `.api` files share that method and URL, API Hero shows a QuickPick of name + path. Cancel (Escape) runs a temporary request from the `fetch` snapshot. Unique catalog reuse always runs the **persisted** `.api` text (auth, variables, body, and metadata are not overwritten from source).

Temporary Quick Runs are not opened as untitled `.api` editors. History rerun of a Quick Run may not reopen the original source file.

Identifier URLs (`fetch(url)`), interpolated templates (`` fetch(`https://example.com/${id}`) ``), and non-literal bodies (`JSON.stringify(data)`) are not extracted. Method is still taken when it is a string literal.

API Hero does **not** invent CodeLens or a stable mapping from a bare URL. For a durable identity, add `@api-hero`.

## Persistent mapping

CodeLens appears only when API Hero can uniquely identify one request. Guessing from call names such as `api.getUser(id)` or from a bare `fetch("https://...")` URL is **not** supported.

### Source → `.api`

In TypeScript or JavaScript, add an `@api-hero` comment immediately above the code:

```ts
// @api-hero name: Get User
const response = await api.getUser(id)
```

```ts
// @api-hero request: Collections/Users/Get-User.api
const response = await api.getUser(id)
```

```ts
/**
 * @api-hero name: Get User
 * @api-hero request: Collections/Users/Get-User.api
 */
export interface GetUser {}
```

| Annotation | Resolves when |
| --- | --- |
| `name: …` or a bare name | Exactly one workspace request has that `@name` |
| `request: path.api` | The path matches one `.api` file (and that file has one request, or a `name:` annotation disambiguates) |
| `id: …` | Exactly one request has that discovery or legacy `@id` |

If the name is duplicated, the file has several requests, or the target was renamed/deleted, **no CodeLens** is shown. Invalid, deleted, or ambiguous annotations never silently pick a request.

Generated TypeScript files may include the same `@api-hero` tags in the header when types are generated from a mapped request.

### `.api` → source

On a request, set:

```api
@name Get User
@source src/services/user.ts
GET {{baseUrl}}/users/1
```

Optional 1-based line: `@source src/services/user.ts:42`. Paths are workspace-relative. Parent segments (`..`) are rejected.

The Request Editor preserves `@source` on save. **API Hero: Open Related Source** is available from the Command Palette, editor context menu, and CodeLens on the `.api` request when `@source` is present. If the file is missing, API Hero reports that no source reference exists — it does not guess another file.

## CodeLens actions

On a mapped source location (`@api-hero` only):

| Action | Command |
| --- | --- |
| Run Request | `apiHero.runRequest` — existing Execution Orchestrator |
| Open API Definition | `apiHero.openApiDefinition` |
| Generate TypeScript | `apiHero.generateTypeScript` — runs the mapped request if needed, then the existing JSON type generator |

On a `.api` request with `@source`:

| Action | Command |
| --- | --- |
| Open Related Source | `apiHero.openRelatedSource` |

## Hover

Mapped source lines and `.api` request methods show protocol-agnostic metadata: method, URL (query string omitted), name, protocol (HTTP / GraphQL / WebSocket), and `@source` when present. Headers, tokens, and secrets are not included.

## TypeScript generation

Reuse **Generate TypeScript** from a successful JSON response (`src/codegen/typescript-from-json.ts`). From VS Code you can:

- **Copy** to the clipboard
- **Preview** in an untitled editor (not saved)
- **Insert into editor** when a TypeScript file is active (confirms before inserting over existing type names)
- **Create .ts** with an overwrite confirmation if the file exists

API Hero never silently overwrites user source.

Command Palette **Open API Definition** / **Generate TypeScript** from a TypeScript file resolve only when the cursor is on the annotated code line (the same line CodeLens attaches to). Nearby lines are not guessed.

**Run Request** from source also works without `@api-hero` when the cursor is on a detectable `fetch("https://...")` call (Quick Run). Persistent mapping still requires the annotation.

## Limitations

- No repository-wide scan on activation; mappings use Collections discovery plus open `.api` documents
- No fuzzy matching of HTTP calls, OpenAPI operationIds, or symbol names
- No automatic CodeLens or stable identity from URLs
- No CLI / MCP CodeLens
- `@source` is not validated against disk until you open the related source

## Related

- [Creating requests](./creating-requests.md)
- [Response viewer](./response-viewer.md#generate-typescript)
- [Commands](../reference/commands.md)
