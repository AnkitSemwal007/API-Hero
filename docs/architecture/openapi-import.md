# OpenAPI import architecture

## Scope

Import-only pipeline for **OpenAPI 3.0.x and 3.1.x** specifications into API
Hero artifacts:

- `.api` request files under a workspace folder
- named environments (`baseUrl`, optional `host` / `port`, server variables)
- authentication profile metadata (secrets as placeholders only)

The importer **never executes** imported HTTP content. Specifications are
treated as untrusted. Export, Swagger 2.0, and GraphQL-as-a-format are out of
scope for OpenAPI. **Postman Collection v2 / v2.1** and **Insomnia export v3 / v4**
import are supported via separate providers on the shared pipeline (local JSON
file only; scripts emit diagnostics and are never executed).

Command: `apiHero.importOpenApi`  
Title: **API Hero: Import OpenAPI Specification**

Postman command: `apiHero.importPostman`  
Title: **API Hero: Import Postman Collection**

Insomnia command: `apiHero.importInsomnia`  
Title: **API Hero: Import Insomnia Export**

## Pipeline

```text
Local file | URL → (URL: HttpTransport GET) → Loader → Parser → Validator
  → $ref Resolver → Generators → Domain artifacts → Workspace Writer
  → Settings patch → Collections refresh
```

| Stage | Module | Responsibility |
| --- | --- | --- |
| Fetch (URL) | `fetch-spec-url.ts` | Validate http(s) URL, GET via `HttpTransport`, UTF-8 text + fileName hint |
| Load | `loader.ts` | Size cap, JSON vs YAML detection, parse root |
| Parse | `openapi/parse.ts` | Map root → focused document model |
| Validate | `openapi/validate.ts` | Version 3.0/3.1, required `info`, diagnostics |
| Resolve | `openapi/resolve.ts` | Local `#/` `$ref`, cache, depth/cycle caps |
| Generate | `generators/*` | `.api` text, env vars, auth profiles |
| Write | `workspace-writer.ts` | Path-safe file writes under target root |
| Orchestrate | `pipeline.ts` | Stages, `ImportSummary`, cancellation |
| UI | `vscode/import-wizard-host.ts`, `import-register-shared.ts`, format wizards | Shared wizard host + register helpers; OpenAPI HTML keeps URL source; Postman/Insomnia use parameterized collection HTML |

URL import reuses `runImportPipeline({ sourceText })` — there is **no** second
OpenAPI parser. The wizard host injects `NodeHttpTransport` (or a test fake);
raw `fetch()` is not used.

Generated `.api` text uses the shared **request-source** model (same serialization
path as the Request Editor) so imported files round-trip cleanly in the form UI.

Domain code under `src/openapi-import` does **not** import `vscode`.

## Dependencies

- **JSON:** `JSON.parse` (no extra dependency).
- **YAML:** runtime dependency [`yaml`](https://www.npmjs.com/package/yaml)
  (YAML 1.2). Chosen as a small, maintained parser without an OpenAPI SDK.
- **OpenAPI model:** focused custom types + resolver — not a full OpenAPI SDK.
  Correctness for local `$ref`, nesting, and cycles matters more here than
  complete schema validation of every optional field.

## Provider extension model

`SpecificationImportProvider` + `SpecificationImportProviderRegistry` allow
future Swagger providers. Today:

- `OpenApiImportProvider` (`id: 'openapi'`) — OpenAPI 3.0/3.1
- `PostmanImportProvider` (`id: 'postman'`) — Collection v2/v2.1 (local file)
- `InsomniaImportProvider` (`id: 'insomnia'`) — export v3/v4 resource JSON (local file)

VS Code registration and wizard hosts share `import-register-shared.ts` and
`import-wizard-host.ts` (workspace allowlist, preview/write/progress). Format
copy and OpenAPI URL source remain format-specific.

## Success policy

Any diagnostic with severity `error` causes `ImportSummary.success === false`.
In that case the pipeline:

- does **not** write `.api` files;
- does **not** return a settings patch (environments / auth profiles);
- the VS Code adapter does **not** refresh Collections.

Warnings and info diagnostics alone still allow a successful write and settings
apply. Prefer fixing `$ref` / validation errors in the spec before re-importing.

## Mapping rules

### Output location

Files are written under the **selected workspace folder** as a native
collection:

```text
Collections/<api-slug>/<folder>/<method>-<operation>.api
Collections/<api-slug>/api-hero.collection.json
```

The directory name is a sanitized slug of the API title. The marker uses the
OpenAPI `info.title` as the collection display name. Re-importing the same slug
overwrites files in that collection folder.

`collectionsImportOutputDirectory(apiSlug)` in
`src/openapi-import/output-paths.ts` is the shared path helper used by the
OpenAPI provider.

### Folders

1. Prefer the **first operation tag** (sanitized path segment).
2. Else use the **first path segment** (e.g. `/users/{id}` → `users`).
3. Else `_root`.

### Requests

**One `.api` file per operation** (not one file per tag). Each operation is
mapped to a `RequestSourceDocument` and emitted via shared
`serializeRequestDocument` (see [request-source.md](./request-source.md)).
Generated content includes:

- `#` comments for `operationId`, summary, deprecated, externalDocs, response
  status metadata (description / content types only — **no** response
  validation), and cookie stubs
- `@name`, optional `@description`, optional `@auth <profileId>`
- `METHOD {{baseUrl}}/path/{{pathParam}}` with query parameters on the URL
- Headers as realistic lines. Literal examples are **never**
  emitted for `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`,
  or header/param names matching `*api-key*`, `*token*`, `*secret*`, or
  `*password*` — placeholders such as `{{token}}` are used instead. Body
  examples scrub Bearer/Basic blobs and sensitive object keys cheaply.
- Body: prefer media `example` / `examples`; else schema-derived JSON; stubs
  for XML, multipart, urlencoded, and text

### Environments

- First `servers[]` entry → primary environment `imported-<api-slug>`
  (preferred primary via `activate: true`).
- The settings patch sets `apiHero.activeEnvironment` to that primary **only
  when the workspace has no active environment**; an existing active
  environment is preserved. Imported environments are always appended.
- Up to four additional servers → separate environments.
- Server `{variables}` become environment variables; URL templates use
  `{{var}}` inside `baseUrl`.
- When no servers exist, a placeholder `https://api.example.com` is created
  with an info diagnostic.

### Authentication

| OpenAPI scheme | API Hero profile |
| --- | --- |
| `http` bearer | `bearer` + `{ kind: 'secret' }` token |
| `http` basic | `basic` + secret username/password |
| `http` other / missing scheme | `none` + warning |
| `apiKey` header/query | `apiKey` + secret value |
| `apiKey` cookie | approximated as header `apiKey` + warning |
| `oauth2` / `openIdConnect` / `mutualTLS` | `providerId: 'none'` profile + diagnostic notes (no non-schema keys; no login flow) |

Document- and operation-level `security` requirements that name a scheme
**missing** from `components.securitySchemes` produce a warning
(`undefined-security-scheme`) and do **not** invent an auth profile. Import
continues. Valid schemes still import normally.

Secret values from the specification are **never** written into `.api` files or
plaintext settings. The summary lists SecretStorage hints for the user.

## `$ref` resolution

- Local JSON Pointers only (`#/components/...`).
- External file/URL refs → warning diagnostic (no network fetch).
- Cache of resolved targets.
- Cycle detection via chase stack; circular schemas emit `null` samples +
  warning.
- Depth capped by `ImportLimits.maxRefDepth` (default 64).

## Security

- Never execute imported content.
- Configurable size cap: `apiHero.import.maxFileBytes` (default 5 MiB,
  hard max 50 MiB). The VS Code adapter `stat`s local files and rejects
  oversized specs **before** `readFile`; URL fetch applies the same limit via
  `HttpTransportContext.maxResponseBytes`; the loader re-checks decoded UTF-8
  byte length.
- URL fetch: http(s) only; no embedded credentials; no Authorization/Cookie
  headers; TLS certificate verification on; redirects followed by
  `NodeHttpTransport` (non-http(s) redirect targets rejected). Localhost /
  private / link-local hosts are intentionally allowed (local extension
  workflows). Cloud-style SSRF private-range blocking is **not** implemented —
  it would break legitimate local Swagger servers and diverge from Request
  Engine policy.
- `$ref` depth / cycle protection. Remote `$ref` URLs are **not** fetched.
- Generated relative paths sanitized; `..` and absolute segments rejected so
  writes cannot escape the import target root.
- Diagnostics pass through `maskImportSecretText` before UI display.
- Sensitive header/parameter examples and credential-like body blobs are
  replaced with placeholders (never written as literals into `.api` files).

## Postman GraphQL

Postman Collection `body.mode === "graphql"` maps to native `@protocol graphql`
via `compileGraphqlEditorEnvelope` (query, variables as object or JSON string,
optional operationName). Detection is from `body.mode` only, never from URL.
Missing or empty query is `postman-unsupported-graphql` and is not imported as
GraphQL. Invalid variables are omitted (`postman-unsupported-graphql-variables`)
while the request remains GraphQL. Insomnia GraphQL bodies remain stubs.

## Limitations (intentionally deferred)

- Swagger 2.0, export, GraphQL-as-a-format import
- Insomnia Document / YAML v5, HAR, and non–resource-based Insomnia shapes
- Authenticated OpenAPI URL fetch (401/403 or URLs with embedded credentials)
- Response schema / assertion generation
- OAuth2 / OpenID login flows (schemes appear as `none` profiles; details stay in import notes/summary)
- Remote `$ref` fetching
- Full OpenAPI semantic validation beyond version/required fields and refs
- Transactional rollback if a mid-write I/O error or cancel leaves partial `.api` files
  (`success: false` skips settings patch and Collections refresh)
- Re-import upsert/replace by API slug (settings and folders currently append with unique ids)
- Cap on generated operation/file count (size/`$ref`/schema depth are capped; dense specs can still fan out)
- Remote/virtual FS via `workspace.fs` (adapter currently uses `node:fs` under a validated workspace path)

## Testing

Core pipeline tests live in `src/openapi-import/openapi-import.test.ts`
(`node:test`, no extension host): JSON/YAML fixtures, validation, `$ref` /
circular, auth/env/request generation, malformed specs, path traversal,
cancellation, and a large-ish smoke import.

URL fetch tests live in `src/openapi-import/fetch-spec-url.test.ts` (FakeTransport
+ optional local `NodeHttpTransport` smoke) and cover protocol/credential
rejection, HTTP errors, Content-Type fileName hints, and pipeline equivalence
with direct `runImportPipeline({ sourceText })`.

Postman tests: `src/openapi-import/postman/postman-provider.test.ts`.  
Insomnia tests: `src/openapi-import/insomnia/insomnia-provider.test.ts`.
