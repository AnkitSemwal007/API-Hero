# Source-code integration (VS Code)

API Hero can show **CodeLens**, **hover**, and **Go to definition** between application source files and `.api` requests — only when the mapping is explicit.

This is a VS Code editor feature. It is not available in the CLI or Desktop.

## Supported mappings

CodeLens appears only when API Hero can uniquely identify one request. Guessing from call names such as `api.getUser(id)` is **not** supported.

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

If the name is duplicated, the file has several requests, or the target was renamed/deleted, **no CodeLens** is shown.

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

On a mapped source location:

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

Command Palette **Open API Definition** / **Run Request** from a TypeScript file resolves only when the cursor is on the annotated code line (the same line CodeLens attaches to). Nearby lines are not guessed.

## Limitations

- No repository-wide scan on activation; mappings use Collections discovery plus open `.api` documents
- No fuzzy matching of HTTP calls, OpenAPI operationIds, or symbol names
- No CLI / MCP CodeLens
- `@source` is not validated against disk until you open the related source

## Related

- [Creating requests](./creating-requests.md)
- [Response viewer](./response-viewer.md#generate-typescript)
- [Commands](../reference/commands.md)
