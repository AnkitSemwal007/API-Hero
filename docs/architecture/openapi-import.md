# OpenAPI import architecture

## Scope

Import-only pipeline for **OpenAPI 3.0.x and 3.1.x** specifications into API
Runner artifacts:

- `.api` request files under a workspace folder
- named environments (`baseUrl`, optional `host` / `port`, server variables)
- authentication profile metadata (secrets as placeholders only)

The importer **never executes** imported HTTP content. Specifications are
treated as untrusted. Export, Swagger 2.0, Postman, Insomnia, and GraphQL are
out of scope.

Command: `apiRunner.importOpenApi`  
Title: **API Runner: Import OpenAPI Specification**

## Pipeline

```text
File → Loader → Parser → Validator → $ref Resolver → Generators
  → Domain artifacts → Workspace Writer → Settings patch → Collections refresh
```

| Stage | Module | Responsibility |
| --- | --- | --- |
| Load | `loader.ts` | Size cap, JSON vs YAML detection, parse root |
| Parse | `openapi/parse.ts` | Map root → focused document model |
| Validate | `openapi/validate.ts` | Version 3.0/3.1, required `info`, diagnostics |
| Resolve | `openapi/resolve.ts` | Local `#/` `$ref`, cache, depth/cycle caps |
| Generate | `generators/*` | `.api` text, env vars, auth profiles |
| Write | `workspace-writer.ts` | Path-safe file writes under target root |
| Orchestrate | `pipeline.ts` | Stages, `ImportSummary`, cancellation |
| UI | `vscode/register-openapi-import.ts` | Dialog, progress, settings, refresh |

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
future Swagger / Postman / Insomnia providers. Only
`OpenApiImportProvider` (`id: 'openapi'`) is registered today.

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

Files are written under the **selected workspace folder**:

```text
imported/<api-slug>/<folder>/<method>-<operation>.api
```

Collections continue to map **1 workspace folder → 1 Collection**; the import
directory is ordinary folder/request tree content discovered from `.api` files.

### Folders

1. Prefer the **first operation tag** (sanitized path segment).
2. Else use the **first path segment** (e.g. `/users/{id}` → `users`).
3. Else `_root`.

### Requests

**One `.api` file per operation** (not one file per tag). Generated content
includes:

- `#` comments for `operationId`, summary, deprecated, externalDocs, response
  status metadata (description / content types only — **no** response
  validation)
- `@name`, optional `@description`, optional `@auth <profileId>`
- `METHOD {{baseUrl}}/path/{{pathParam}}` with query parameters on the URL
- Headers / cookie stubs as realistic lines. Literal examples are **never**
  emitted for `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`,
  or header/param names matching `*api-key*`, `*token*`, `*secret*`, or
  `*password*` — placeholders such as `{{token}}` are used instead. Body
  examples scrub Bearer/Basic blobs and sensitive object keys cheaply.
- Body: prefer media `example` / `examples`; else schema-derived JSON; stubs
  for XML, multipart, urlencoded, and text

### Environments

- First `servers[]` entry → primary environment `imported-<api-slug>`,
  **activated** via `apiRunner.activeEnvironment`.
- Up to four additional servers → separate environments.
- Server `{variables}` become environment variables; URL templates use
  `{{var}}` inside `baseUrl`.
- When no servers exist, a placeholder `https://api.example.com` is created
  with an info diagnostic.

### Authentication

| OpenAPI scheme | API Runner profile |
| --- | --- |
| `http` bearer | `bearer` + `{ kind: 'secret' }` token |
| `http` basic | `basic` + secret username/password |
| `http` other / missing scheme | `none` + warning |
| `apiKey` header/query | `apiKey` + secret value |
| `apiKey` cookie | approximated as header `apiKey` + warning |
| `oauth2` / `openIdConnect` / `mutualTLS` | `providerId: 'none'` profile + diagnostic notes (no non-schema keys; no login flow) |

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
- Configurable size cap: `apiRunner.import.maxFileBytes` (default 5 MiB,
  hard max 50 MiB). The VS Code adapter `stat`s the file and rejects oversized
  specs **before** `readFile`; the loader re-checks decoded UTF-8 byte length.
- `$ref` depth / cycle protection.
- Generated relative paths sanitized; `..` and absolute segments rejected so
  writes cannot escape the import target root.
- Diagnostics pass through `maskImportSecretText` before UI display.
- Sensitive header/parameter examples and credential-like body blobs are
  replaced with placeholders (never written as literals into `.api` files).

## Limitations (intentionally deferred)

- Swagger 2.0, export, Postman / Insomnia / GraphQL import
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
