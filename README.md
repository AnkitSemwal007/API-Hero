# API Hero

**Git-first API development for VS Code**

Author `.api` requests beside your code, organize them in Git-friendly collections, run with assertions, and reuse the same workflows from MCP or the `apihero` CLI.

> Extension ID: **`ankitsemwal.api-hero`** · Version: **2.11.0** · License: [MIT](LICENSE)

[Website](https://apihero.in/) · [Marketplace](https://marketplace.visualstudio.com/items?itemName=ankitsemwal.api-hero) · [npm CLI](https://www.npmjs.com/package/@ankitsemwal007/api-hero) · [Documentation](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md)

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/hero_iluitq.png" alt="API Hero hero" width="800" />

Install from the Marketplace, open a folder workspace, create a `.api` request, and run it with `Ctrl+Alt+R` / `Cmd+Alt+R`.

**2.11.0** includes HTTP / REST, GraphQL-over-HTTP, bounded WebSocket sessions, Collections, Scenarios, Variables, Environments, Assertions, Extraction, OpenAPI / Postman / Insomnia / cURL import, TypeScript generation, MCP, and the `apihero` CLI.

---

## Why API Hero

Most API clients pull you into a separate app and opaque storage. API Hero keeps requests as plain files in your repo and UI where you already work.

| | API Hero | Typical SaaS API clients |
| --- | --- | --- |
| Storage | `.api` files + folders in your repo | Proprietary cloud / local DB |
| Diff / PR | Native Git | Export / sync friction |
| Editor | VS Code native + custom Request Editor | Separate app |
| Secrets | VS Code Secret Storage | Vendor vault / plaintext risk |
| AI / CI | MCP and `apihero` CLI over the same runner | Separate agent / CI tooling |

No context switching. No binary collections. Same workflow as the rest of your codebase.

---

## API Requests as Code

`.api` files are the source of truth. The language id is `api`. The **Request Editor** reads and writes the same grammar — or switch to plain text anytime.

```api
@name Get Products
@description List products with the default page size (30).

GET {{baseUrl}}/products
Accept: application/json

expect status == 200
expect body.products exists
```

Define `baseUrl` in collection variables, an environment, or settings.

### Structure

```http
### Optional separator (multiple requests in one file)
@name My Request
@description Optional description

METHOD https://example.com/path
Header-Name: value

optional body after a blank line

expect status == 200
```

- **Methods:** `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`
- **Request line** — method + URL (may use `{{variables}}`)
- **Headers** — one per line until a blank line
- **Body** — anything after the blank line (before `expect` / next separator)
- **`expect` lines** — evaluated when you run with assertions

### Directives

| Directive | Purpose |
| --- | --- |
| `@name` | Display name |
| `@description` | Description |
| `@auth` | Auth profile id (`@auth <profile-id>`) |
| `@timeout` | Per-request timeout (ms) |
| `@variable` | Document-scoped variable |
| `@sensitive-variable` | Document-scoped sensitive variable |
| `@extract` | Extract from response into a variable |
| `@sensitive-extract` | Extract and mark sensitive |
| `@depends-on` | Dependency on another request (collection chaining) |
| `@protocol graphql` | GraphQL query or mutation over HTTP |
| `@protocol websocket` | Bounded WebSocket connect / send / receive / close |
| `@tag` | Tag(s) |
| `@connection` | Connection hint |
| `@id` | Legacy request id (prefer stable names / paths) |

### Request Editor

Custom editor view type: **`apiHero.requestEditor`** (default for `*.api`).

| Area | What you can do |
| --- | --- |
| Method / URL | Edit method and URL (including `{{variables}}`) |
| Params | Query parameters |
| Headers | Request headers |
| Body | JSON / form / raw body |
| Variables | Document / request variables; `{{` autocomplete |
| Auth | Profile binding, collection default, **one-shot Bearer** (Send only — never written to `.api`) |
| Extract | `@extract` / `@sensitive-extract` rules |
| Tests | `expect` assertions |
| Dependencies | `@depends-on` picker (human-readable refs) |
| Run | Send / Run with assertions; response panel |

Open via **API Hero: Open Request Editor** when the text editor is active.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-collections-editor_idcn2j.png" alt="Collections and Request Editor" width="800" />

→ [Creating requests](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/creating-requests.md) · [GraphQL](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/graphql.md) · [WebSocket](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/websocket.md)

WebSocket Phase 1 is a **bounded** connect → optional text send → first text frame receive → close session. It is not a persistent WebSocket client.

---

## Collections & Workflows

Layout:

```text
Collections/<Name>/
  optional folders/
  *.api
  api-hero.variables.json      # collection variables
  api-hero.collection.json     # optional marker (OpenAPI import creates it)
```

- **Discovery** — folders under `Collections/` appear in the Collections tree
- **Run** — Run Collection, Run Folder, or Run Selected Requests
- **Import / Export** — **API Hero: Import Collection** / **Export Collection**
- Loose `.api` files outside Collections may appear under **Legacy** until moved

**Collection Runner** executes many requests in a collection, folder, or selection. Live progress appears in the **Execution** view.

- **Failure policies** (`apiHero.collectionRunner.failurePolicy`): `ask` (default), `stop-on-first-error`, `continue-on-error`, `skip-invalid-requests`
- **Run Options** — optional retries for eligible transport failures and skip DELETE for the run
- **Outcomes:** `passed` / `failed` / `skipped` / `cancelled`
- **Open Live Report** / **Open Run Report** when finished

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-execution_il1wy7.png" alt="Execution Center" width="800" />

### Scenarios

A **Scenario** automates **one** multi-step API workflow (steps, connections, shared data). That is distinct from Collection Runner, which runs **many** requests in a collection, folder, or selection.

| | Collection Runner | Scenarios |
| --- | --- | --- |
| Focus | Many requests / regression | One workflow with steps |
| Storage | `.api` under Collections | `.apihero/scenarios/*.scenario.json` |

- **Scenario Editor**, **Run Scenario**, and a **Scenario Report** when the run finishes
- Scenario variables and step outputs flow through the same execution pipeline as collections
- The Scenarios Activity Bar view stays hidden until scenarios load or you create one

CLI scenario `--inputs` is **not** supported. MCP `apihero_run_scenario` can pass optional `inputs` for that run — see [MCP](#mcp).

→ [Collections](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collections.md) · [Collection Runner](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collection-runner.md) · [Scenarios](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/scenarios.md)

---

## Variables & Environments

Use `{{name}}` where `name` matches `[A-Za-z_][A-Za-z0-9_.-]*`.

### Scopes and precedence (highest → lowest)

1. **run**
2. **document** (Request in the UI — `@variable` in the `.api` file)
3. **environment** (the **active** named environment)
4. **collection** (`Collections/<Name>/api-hero.variables.json`)
5. **workspace**
6. **global**

Environments are workspace-level named variable sets — they are **not** bound to a collection. Collection variables apply only to requests in that collection.

OS `process.env` is **not** mapped automatically to `{{variable}}`.

### Where values live

| Scope | Typical storage |
| --- | --- |
| Collection | `Collections/<Name>/api-hero.variables.json` |
| Sensitive overlay | `.apihero/local/variables.local.json` (gitignored) |
| Environments | **Manage Environments** / `apiHero.environments` + `apiHero.activeEnvironment` |
| Workspace / global | VS Code settings `apiHero.variables.workspace` / `apiHero.variables.global` |

**Auth secrets** use VS Code **Secret Storage** via Manage Authentication — that is distinct from sensitive *variables* (masked in UI as `••••••••`).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-environments_wfx7z1.png" alt="Environment Manager" width="800" />

### Authentication

**Providers only:** `none` · `basic` · `bearer` · `apiKey`

Profiles live in **API Hero: Manage Authentication**. Attach with `@auth <profile-id>`, a collection default, or a one-shot Bearer in the Request Editor (not persisted to `.api`).

**OAuth2 Account Login is not available.** Authentication Login API (session login against *your* API) **is** included — that is separate from Account Login.

→ [Variables](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/variables.md) · [Environments](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/environments.md) · [Authentication](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/authentication.md)

---

## Dependencies & Extraction

Chain requests so producers run before consumers. Collection Runner analyzes `@depends-on` and implicit produces/consumes (from `@extract` + `{{var}}` usage), then reorders the frozen membership plan.

| Capability | Behavior |
| --- | --- |
| `@depends-on` | Explicit edge to another request by human-readable ref (`Login` or `Authentication/Login`) |
| `@extract` | Pull values from status / headers / body into variables for later requests |
| Ordering | Topological order before execution |
| Multi-hop | Login → Current User → further dependents in one collection run |
| Skip on failure | Upstream fail/skip → dependents skipped with a clear reason |
| Cycle detection | Circular graphs **block the run** before any request executes |

**Collection Runner honors dependencies.** A single **Run Request** from the editor does **not** auto-run upstream producers — ensure required variables already exist in a persisted scope (e.g. `scope=collection` from an earlier run) or run via Collection Runner.

**Scenarios are separate** from `@depends-on`. Scenarios use `requestRef` + connections under `.apihero/scenarios/`.

### `@extract` grammar

```text
@extract <name> from <source> [scope=…] [optional|required] [when=…]
@sensitive-extract <name> from <source> …
```

- **Sources:** `body.<path>`, `header <Name>`, `status`
- **Scopes:** `run` | `document` | `collection` | `environment` | `workspace`
  Default scope is `run`. **`scope=global` is not valid** for extract.

Example (placeholders only — never real secrets):

```api
@name Login
@extract token from body.accessToken scope=collection

POST {{baseUrl}}/auth/login
Accept: application/json
Content-Type: application/json

{
  "username": "{{username}}",
  "password": "{{password}}"
}
expect status == 200
```

```api
@name Current User
@depends-on Authentication/Login
@extract userId from body.id scope=run

GET {{baseUrl}}/auth/me
Authorization: Bearer {{token}}

expect status == 200
```

Sample collection: `examples/collections/DummyJSON Complete API Collection`.

→ [Collection Runner](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collection-runner.md)

---

## Testing & Assertions

Add `expect` lines after a request. Run with assertions via CodeLens or **Run Request with Assertions**.

### Operators

`==` `!=` `>` `>=` `<` `<=` `in` `contains` `exists` `isEmpty` `isNull`  
(aliases such as `eq`, `equals`, `gt`, `exist`, `empty`, `null` are accepted by the parser)

### Subjects

`status` · `header <Name>` · `body` / `body.<path>` · `contentType` · `responseTime` · `responseSize`

### Outcomes

`passed` | `failed` | `skipped` | `malformed`

Expected/Actual appear in the **Response Viewer** and **Run Report Details**. In a collection run, assertion failure → request **failed** with category **assertion**.

→ [Assertions](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/assertions.md)

---

## Import Existing APIs

Bring existing definitions into Git-first `.api` collections. Preview before write. Secrets are masked. Scripts are never executed.

| Source | Support |
| --- | --- |
| **OpenAPI** | **3.0.x** and **3.1.x**, JSON or YAML, from a **local file** or **HTTP(S) URL** |
| **Postman** | Collection **v2 / v2.1** JSON (local file) |
| **Insomnia** | Resource-based export **v3 / v4** JSON (local file) |
| **cURL** | Single command → one `.api` file; parsed **in-process** (no shell execution) |

- **API Hero: Import OpenAPI Specification** — wizard → Collections + `.api` files
- **API Hero: Import Postman Collection** — preserves folders, methods, URLs, `{{variables}}`, headers/query/body, and bearer/basic/apiKey auth; scripts are warnings only
- **API Hero: Import Insomnia Export** — preserves nested folders, methods, URLs, environments, and bearer/basic/apiKey auth; Insomnia-only resource types are not migrated
- **API Hero: Import cURL** — paste, editor selection, or text file → masked preview → save one `.api` file (round trip with **Copy as cURL**). `@file` bodies are not read from disk
- Imported environments are created and selectable; an **existing active environment is preserved**
- Size limit: `apiHero.import.maxFileBytes` (default 5 MiB) for OpenAPI/Postman/Insomnia; cURL paste capped at 256 KiB

**Not supported:** Swagger 2.0, Insomnia Document / YAML v5, HAR, GraphQL **import** (Postman/Insomnia stub only), remote `$ref`, OAuth2 as a live auth flow, authenticated specification URLs, Postman/Insomnia script execution, gRPC / WebSocket request resources from Insomnia.

→ [OpenAPI Import](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/openapi-import.md)

---

## Debugging & Reports

### Response Viewer

Inspect status, timing, pretty/raw/JSON body, headers, and assertions. Copy or save the body, search within it, and create variables from the response (**Extract Variable…** / **Save as Variable**).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-response_wt1caw.png" alt="Response Viewer" width="800" />

### Failure Diagnostics

When a request fails, API Hero can show **Possible causes** next to recorded facts (status, URL, timing, transport error). Guidance covers common HTTP statuses and network/timeout failures. It is structured context to help you investigate — not a guaranteed root-cause diagnosis. Secrets stay redacted.

The same explanations appear in Run Report **Details** and in MCP diagnostic fields.

### Request/Response Diff

Compare results **within the current run/session**:

- **Compare with Previous Run** — Previous vs Current for the same request in this session (status, headers, JSON paths, text lines) over already-redacted presentations
- **Compare Runs** — from Collection Run Manager / Report Details when a prior recent collection-run presentation exists for that request

This is **not** persistent History body comparison. History stores metadata only.

### Run Reports & Variable Trace

After a collection/folder/selection run:

- Compact summary counts (total / passed / failed / skipped / cancelled)
- Per-request rows with outcome / method / search filters
- **Variable Trace** — produced and consumed names (expand for unresolved names)
- **Details** — Response, Headers, Assertions (Expected/Actual), Variables, Execution Details, Dependencies, and **Possible causes** when applicable

The Collection Run Debugger holds the **last run in memory** — it is **not** Request History.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-run-report_pxwll2.png" alt="Run Report" width="800" />

### Request History

**Storage:** VS Code extension **`globalStorageUri`** file **`request-history.json`**.

- Metadata only — **no response bodies**
- Cap via `apiHero.history.maxEntries` (default **1000**)
- Actions: re-run, reveal original request, filter, clear, copy summary

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-history_k4zaq3.png" alt="History" width="800" />

→ [Response Viewer](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/response-viewer.md) · [History](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/history.md)

---

## TypeScript Generation

Generate TypeScript **types/interfaces** from a successful JSON response body (Response Viewer or **API Hero: Generate TypeScript**).

- Inference from **this one observed body** — not a complete API schema
- **Copy** to the clipboard or **Create .ts**
- Type names come from JSON keys only (never from sensitive string values)

This is type generation, not arbitrary application code generation.

---

## MCP

API Hero includes a **Model Context Protocol** server so AI clients can inspect and run the same API workflows you keep in Git.

```text
AI Client
    ↓
API Hero MCP (standalone Node stdio)
    ↓
Collection Runner / Execution Orchestrator
    ↓
Existing execution pipeline
```

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/v1786432275/api-hero-mcp_hrx7xa.gif" alt="API Hero MCP workflow" width="800" />

- MCP is **not** a second HTTP client — it reuses discovery, Collection Runner, ScenarioEngine, and Execution Orchestrator
- Runs as an **independent Node stdio process** (not inside the VS Code extension host)
- Tools for listing collections/requests, running a request or collection, running a scenario (optional MCP `inputs`), and reading redacted run results
- Headless hosts load filesystem collections and `.apihero` Project Store environments / auth profiles. VS Code settings globals and VS Code Secret Storage are not available — supply secrets via process environment (`APIHERO_SECRET_*` or exact Secret Storage keys)
- **Installing the VS Code extension does not register MCP** with Codex, Cursor, Claude, or any other client. Configuration is **client-owned**.

Bin: `api-hero-mcp` (also `node ./dist/mcp/server.js`). Workspace priority: `--workspace` → `APIHERO_WORKSPACE` → `cwd`. Requires **Node.js 18+**.

After installing `@ankitsemwal007/api-hero` from npm, clients can spawn `api-hero-mcp`. From a repo checkout, compile first (`npm run compile`).

→ Full guide: [docs/user/mcp.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/mcp.md)

---

## CLI

The **`apihero`** CLI is public and shipped on npm. It runs the same Orchestrator / Collection Runner / ScenarioEngine as the extension and MCP — without VS Code.

npm package: **`@ankitsemwal007/api-hero`** (binary: `apihero`).
Marketplace extension id remains **`ankitsemwal.api-hero`**. Installing the VS Code extension does **not** put `apihero` on PATH.

```bash
npm install -g @ankitsemwal007/api-hero
apihero --help
apihero run request Login --workspace . --environment local
apihero run collection Demo --workspace . --json
apihero run scenario checkout --workspace . --quiet
```

Use `--json` in CI for a redacted machine-readable envelope on stdout.

**Not included:** `--var`, OS `process.env` → `{{variable}}`, scenario `--inputs`, parent-directory workspace discovery, Docker, watch mode, or parallel execution.

→ [CLI guide](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/cli.md) · [npm package](https://www.npmjs.com/package/@ankitsemwal007/api-hero)

---

## Installation

### VS Code

Install **API Hero** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ankitsemwal.api-hero) (`ankitsemwal.api-hero`). Requires VS Code **1.90+**.

1. Open a **folder workspace** (Collections need a folder root).
2. Activity Bar → **API Hero** → **Collections** → **New Collection** / **New Request**, or create a `.api` file.
3. **Run** — **Ctrl+Alt+R** / **Cmd+Alt+R**, the editor **Run** button, or CodeLens **Run Request**.
4. Inspect the **Response Viewer**.

From a local build:

```bash
npm install
npm run package
code --install-extension release/api-hero-2.11.0.vsix
```

Open **API Hero: Open Overview** anytime for quick actions.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/workflow_qsb5jj.gif" alt="API Hero workflow" width="800" />

### CLI

```bash
npm install -g @ankitsemwal007/api-hero
apihero --version
apihero --help
```

Requires **Node.js 18+**. See [CLI](#cli).

---

## Documentation

| Topic | Link |
| --- | --- |
| Website | [apihero.in](https://apihero.in/) |
| Docs home | [docs/README.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) |
| Getting started | [getting-started.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/getting-started.md) |
| GraphQL | [graphql.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/graphql.md) |
| WebSocket | [websocket.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/websocket.md) |
| CLI | [cli.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/cli.md) |
| MCP for AI agents | [mcp.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/mcp.md) |
| Configuration | [configuration.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/reference/configuration.md) |
| Release notes 2.11.0 | [v2.11.0-release-notes.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/v2.11.0-release-notes.md) |
| Release notes 2.10.1 | [v2.10.1-release-notes.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/v2.10.1-release-notes.md) |

Listing media (hero, screenshots, banner, social preview, workflow GIF) is hosted on **Cloudinary** so the VSIX stays small. Extension icons still ship in-package.

Also used for listing / social: [banner](https://res.cloudinary.com/iaojzqjd/image/upload/banner_psgrx2.png), [social preview](https://res.cloudinary.com/iaojzqjd/image/upload/social-preview_jspifx.png).

### Development

```bash
npm install
npm run check
npm run lint
npm test
npm run compile
npm run package
```

- `npm run mcp` — compile and start the MCP server on stdio
- See [CONTRIBUTING.md](CONTRIBUTING.md) and [development docs](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/development/README.md)

---

## License

[MIT](LICENSE)

## Support

[SUPPORT.md](SUPPORT.md) · [GitHub Issues](https://github.com/AnkitSemwal007/API-Hero/issues)
