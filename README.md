# API Hero

**Git-first REST/HTTP client for Visual Studio Code**

Author `.api` requests beside your code, organize them in Git-friendly collections, run with assertions, and expose the same collections to AI agents via a standalone MCP server — without leaving your editor workflow.

> Extension ID: **`ankitsemwal.api-hero`** · Version: **2.8.4** · License: [MIT](LICENSE)

[Documentation](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md)

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/hero_iluitq.png" alt="API Hero hero" width="800" />

### Quick answers

| Question | Answer |
| --- | --- |
| **What?** | A VS Code extension for editing and running HTTP requests as plain `.api` files, plus a standalone MCP server for AI clients |
| **Why?** | Keep APIs in Git, review them in PRs, and stay in the editor — no proprietary collection cloud |
| **Different?** | File-first collections, VS Code Secret Storage for credentials, Collection Runner + Scenarios, MCP reuses the same execution pipeline |
| **How to start?** | Install → open a folder workspace → create a `.api` request → Run (`Ctrl+Alt+R` / `Cmd+Alt+R`) |

### Feature overview

- **Native `.api` language** — request line, headers, body, directives, `expect` assertions, CodeLens
- **Git-first Collections** — `Collections/<Name>/` folders you can diff and review
- **Variables & environments** — `{{name}}` with clear precedence; collection variables in `api-hero.variables.json`; sensitive overlays gitignored
- **Authentication** — `none` / `basic` / `bearer` / `apiKey` profiles, Login API sessions, Secret Storage
- **Assertions** — `expect` lines with Expected/Actual in Response Viewer and Run Reports
- **Collection Runner** — run collection / folder / selected requests with failure policies
- **Collection Run Reports** — compact summary and rows, filters, folder grouping, and drill-down Details
- **Copy as cURL** — resolve variables + auth and copy a redacted POSIX cURL command (no HTTP)
- **Request History** — metadata in VS Code global storage (`request-history.json`)
- **Scenarios (advanced)** — multi-step workflows under `.apihero/scenarios/`
- **OpenAPI 3.x import** — local file or **HTTP(S) URL** wizard → Collections + `.api` files
- **AI / MCP** — nine `apihero_*` tools (including `apihero_run_scenario`) over the same runner (client-owned configuration)

---

## Why API Hero

Most API clients pull you into a separate app and opaque storage. API Hero keeps requests as plain files in your repo and UI where you already work.

| | API Hero | Typical SaaS API clients |
| --- | --- | --- |
| Storage | `.api` files + folders in your repo | Proprietary cloud / local DB |
| Diff / PR | Native Git | Export / sync friction |
| Editor | VS Code native + custom editor | Separate app |
| Secrets | VS Code Secret Storage | Vendor vault / plaintext risk |
| AI agents | Standalone MCP over the same runner | Separate agent tooling |

No context switching. No binary collections. Same workflow as the rest of your codebase.

---

## Quick Start

1. **Install** — Marketplace: search **API Hero** or install `ankitsemwal.api-hero`. From a local build:

   ```bash
   npm install
   npm run package
   code --install-extension release/api-hero-2.8.4.vsix
   ```

   Requires VS Code **1.90+**.

2. **Open a folder workspace** — Collections need a folder root (not a single loose file alone).

3. **Create or open a `.api` request** — Activity Bar → **API Hero** → **Collections** → **New Collection** / **New Request**, or create a `.api` file.

4. **Run** — **Ctrl+Alt+R** / **Cmd+Alt+R**, the editor **Run** button, or CodeLens **Run Request**.

5. **Inspect** the **Response Viewer** (status, body, headers, assertions).

6. **Organize** requests under `Collections/<Name>/` for Git-friendly layout and collection runs.

### First request (copy-paste)

```http
### Hello
GET https://httpbin.org/get
Accept: application/json
```

### With variables and assertions (DummyJSON style)

```api
@name Get Products
@description List products with the default page size (30).

GET {{baseUrl}}/products
Accept: application/json

expect status == 200
expect body.products exists
```

Define `baseUrl` in collection variables (`api-hero.variables.json`), an environment, or settings — for DummyJSON typically `https://dummyjson.com`.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/workflow_qsb5jj.gif" alt="API Hero workflow" width="800" />

Open **API Hero: Open Overview** anytime for quick actions.

---

## Request Files (`.api` syntax)

`.api` files are plain text. The language id is `api`.

### Methods

`GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`

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

- **Request line** — method + URL (may use `{{variables}}`)
- **Headers** — one per line until a blank line
- **Body** — anything after the blank line (before `expect` / next separator)
- **Separators** — `###` starts a new request block
- **`expect` lines** — after the request; evaluated when you run with assertions

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
| `@tag` | Tag(s) |
| `@connection` | Connection hint |
| `@id` | Legacy request id (prefer stable names / paths) |

### Variables

Use `{{name}}` where `name` matches `[A-Za-z_][A-Za-z0-9_.-]*`.

### `@extract` grammar

```text
@extract <name> from <source> [scope=…] [optional|required] [when=…]
@sensitive-extract <name> from <source> …
```

- **Sources:** `body.<path>`, `header <Name>`, `status`
- **Scopes:** `run` | `document` | `collection` | `environment` | `workspace`  
  Default scope is `run`. **`scope=global` is not valid** for extract.
- `@sensitive-extract` marks the value sensitive

Example (DummyJSON login — placeholders only, never real secrets):

```api
@name Login
@description Authenticate and extract tokens into collection variables.
@extract token from body.accessToken scope=collection
@extract refreshToken from body.refreshToken scope=collection

POST {{baseUrl}}/auth/login
Accept: application/json
Content-Type: application/json

{
  "username": "{{username}}",
  "password": "{{password}}",
  "expiresInMins": 30
}
expect status == 200
expect body.accessToken exists
expect body.refreshToken exists
```

---

## Request Editor

- Custom editor view type: **`apiHero.requestEditor`** (default for `*.api`)
- Reads and writes the **same `.api` source** as the text editor
- Edit params, headers, body, auth, variables, dependencies, extract, and tests — or switch to text
- **One-shot Bearer** in the editor applies for a single Send and is **never written** to the `.api` file
- Open via **API Hero: Open Request Editor** when the text editor is active

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-collections-editor_idcn2j.png" alt="Collections and Request Editor" width="800" />

→ [Working with Collections](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collections.md)

### Response Viewer

Inspect status, timing, pretty/raw/JSON body, headers, and assertions. Copy or save the body, search within it, and create variables from the response (**Extract Variable…** / **Save as Variable**).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-response_wt1caw.png" alt="Response Viewer" width="800" />

→ [Response Viewer](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/response-viewer.md)

---

## Collections

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
- **Dependencies** — `@depends-on` reorders runs; cycles block execution
- Loose `.api` files outside Collections may appear under **Legacy** until moved

→ [Collections](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collections.md) · [Git workflow](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/git-workflow.md)

---

## Variables / Environments

### Syntax

`{{variableName}}` — names match `[A-Za-z_][A-Za-z0-9_.-]*`.

### Precedence (highest → lowest)

1. **run**
2. **document**
3. **environment**
4. **collection**
5. **workspace**
6. **global**

### Where values live

| Scope | Typical storage |
| --- | --- |
| Collection | `Collections/<Name>/api-hero.variables.json` |
| Sensitive overlay | `.apihero/local/variables.local.json` (gitignored) |
| Environments | **Manage Environments** / `apiHero.environments` + `apiHero.activeEnvironment` |
| Workspace / global | VS Code settings `apiHero.variables.workspace` / `apiHero.variables.global` |

**Auth secrets** use VS Code **Secret Storage** via Manage Authentication — that is distinct from sensitive *variables* (masked in UI as `••••••••`).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-environments_wfx7z1.png" alt="Environment Manager" width="800" />

→ [Environments](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/environments.md) · [Variables](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/variables.md)

---

## Authentication

**Providers only:** `none` · `basic` · `bearer` · `apiKey`

| Capability | Notes |
| --- | --- |
| Profiles | **API Hero: Manage Authentication** |
| Credential sources | `secret` (Secret Storage), `variable`, `literal` + `unsafe: true` |
| Login API / Session | Obtain tokens via your API; access/refresh in Secret Storage |
| One-shot Bearer | Request Editor only; not persisted to `.api` |
| Collection default | **Set Collection Default Authentication** |
| Attach in file | `@auth <profile-id>` (id, not label) |

### Resolution order

1. Ephemeral **one-shot** (that run only)
2. Request **`@auth`**
3. Document **`@auth`** (when distinct from the request binding)
4. **Collection** default authentication
5. **Session** default profile
6. **none**

**OAuth2 Account Login is not available** (palette stubs are hidden). Authentication Login API (session login against *your* API) **is** included — that is separate from Account Login.

→ [Authentication](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/authentication.md)

---

## Assertions

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

## Request Execution

Lifecycle for a single request:

**parse → validate → variables → authentication → build → HTTP → assertions → extraction**

### Failure categories (labels)

| Category | Label |
| --- | --- |
| `precondition` | Validation Failed |
| `transport` | Network Error |
| `assertion` | Assertion Failed |
| `extraction` | Extraction Failed |
| `unread` | Request Unavailable |
| `cancelled` | Cancelled |

**`httpRequestSent`** — `true` when a network attempt ran; `false` when failure happened before send (e.g. validation / unread). Use this to distinguish “never left the client” from HTTP/assertion/extraction failures after a response.

---

## Collection Runner

- **Run Collection** / **Run Folder** / **Run Selected Requests**
- Live progress in the **Execution** Activity Bar view
- **Failure policies** (`apiHero.collectionRunner.failurePolicy`):
  - `ask` (default — prompt each run)
  - `stop-on-first-error`
  - `continue-on-error`
  - `skip-invalid-requests`
- **Outcomes:** `passed` / `failed` / `skipped` / `cancelled`
- **Dependencies** reorder; **cycles block** the run
- **Open Live Report** / **Open Run Report** when finished

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-execution_il1wy7.png" alt="Execution Center" width="800" />

→ [Collection Runner](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collection-runner.md)

---

## Run Reports

After a collection/folder/selection run, inspect:

- Compact summary counts (total / passed / failed / skipped / cancelled)
- Compact per-request rows with **outcome / method / search** filters and **folder grouping**
- Compact **Variables** status in the header (expand for full Variable Trace / unresolved names)
- **Details** drill-down — Response, Headers, Assertions (Expected/Actual), Variables, Execution Details, Dependencies

The Collection Run Debugger holds the **last run in memory** — it is **not** Request History.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-run-report_pxwll2.png" alt="Run Report" width="800" />

---

## Request History

**Storage:** VS Code extension **`globalStorageUri`** file **`request-history.json`** (extension global storage).

- Metadata only — **no response bodies**
- **Not** `.apihero/history/` — that directory is **reserved / deferred** and gitignored; it is **not** active request history
- Cap via `apiHero.history.maxEntries` (default **1000**)
- Actions: re-run, reveal original request, filter, clear, copy summary

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-history_k4zaq3.png" alt="History" width="800" />

→ [History](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/history.md)

---

## Scenarios (advanced)

Scenarios automate **one multi-step API workflow** (branches, shared data). They are **advanced** — distinct from Collection Runner (which runs **many** requests in a collection/folder/selection).

| | Collection Runner | Scenarios |
| --- | --- | --- |
| Focus | Many requests / regression | One workflow with steps |
| Storage | `.api` under Collections | `.apihero/scenarios/*.scenario.json` |

- **Canonical path:** `.apihero/scenarios/*.scenario.json`
- **Legacy:** `.api-hero/scenarios/` migrates automatically into `.apihero/scenarios/` (byte-preserving; never overwrites differing canonical files)
- **Progressive disclosure:** Scenarios Activity Bar view stays hidden until scenarios load or you create one (`apiHero.scenariosVisible`); then it stays visible for that workspace
- **Scenario Editor**, **Run Scenario**, **Scenario Report**, starter templates

→ [Scenarios](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/scenarios.md)

---

## OpenAPI

- **Supported:** OpenAPI **3.0.x** / **3.1.x** JSON or YAML from a **local file** or **HTTP(S) URL**
- **API Hero: Import OpenAPI Specification** — wizard → Collections + `.api` files (same serializer as the Request Editor; URL fetch uses the same importer)
- **Environments:** imported server environments are created and selectable; an **existing active environment is preserved** (not replaced)
- **Size limit:** `apiHero.import.maxFileBytes` (default 5 MiB)

**Not supported:** Swagger 2.0, Postman/Insomnia import, GraphQL, remote `$ref`, OAuth2 as a live auth flow, automatic assertion generation from the spec, authenticated specification URLs.

→ [OpenAPI Import](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/openapi-import.md)

---

## AI Agents / MCP

```text
AI Client
    ↓
API Hero MCP (standalone Node stdio)
    ↓
Collection Runner / Execution Orchestrator
    ↓
Existing HTTP execution pipeline
```

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/v1786432275/api-hero-mcp_hrx7xa.gif" alt="API Hero MCP workflow: Codex lists collections, runs Get Products via apihero_* tools, receives HTTP 200 and assertion diagnostics" width="800" />

*Codex-style MCP walkthrough — list collections (`DummyJSON Complete API Collection`), run `Get Products` through API Hero’s execution engine, inspect the HTTP response, then read structured assertion diagnostics (Expected / Actual) when a check fails.*

- MCP is **not** a second HTTP engine — it reuses discovery, Collection Runner, and Execution Orchestrator
- Runs as an **independent Node stdio process** (not inside the VS Code extension host)
- Headless MCP discovers **filesystem collections** (`Collections/<Name>/` + collection variables) and loads **`.apihero` Project Store** environments / auth profiles when present. VS Code settings globals and VS Code Secret Storage are not available in headless hosts — supply secrets via process environment (`APIHERO_SECRET_*` or exact Secret Storage keys)
- **Installing the VS Code extension does not register MCP** with Codex, Cursor, Claude, or any other client
- Target clients: **Codex**, **Cursor**, **Claude / Claude Code**, and other MCP-compatible tools
- Configuration is **client-owned** — API Hero does not modify client config files

→ Full guide: [docs/user/mcp.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/mcp.md)

---

## MCP Server

| Entry | Notes |
| --- | --- |
| Bin | `api-hero-mcp` → `bin/api-hero-mcp.js` → `dist/mcp/server.js` |
| Direct | `node ./dist/mcp/server.js` |
| Script | `npm run mcp` (compile + run) |

**Workspace resolve priority** (first wins):

1. `--workspace "<path>"` / `--workspace=<path>`
2. `APIHERO_WORKSPACE`
3. Process `cwd`

Fail-fast if `--workspace` is present **without** a value. An empty or non-collection path still **starts** the server; tools return `EMPTY_WORKSPACE` when no `Collections/<Name>/` trees are found. Prefer pointing `--workspace` at a workspace root that contains collections. Requires **Node.js 18+**.

```bash
# After npm run compile (repo) or from an installed extension path:
node ./dist/mcp/server.js --workspace "/absolute/path/to/your-api-workspace"
# Bin wrapper (after local npm link / install of this package — not a public npm registry package):
# node ./bin/api-hero-mcp.js --workspace "/absolute/path/to/your-api-workspace"
```

---

## MCP Tools

All tools return a JSON envelope `{ ok: true, data }` or `{ ok: false, error }`, redacted for secrets.

| Tool | Purpose | Inputs | Notes |
| --- | --- | --- | --- |
| `apihero_list_collections` | List collections | *(none)* | `EMPTY_WORKSPACE` if no `Collections/<Name>/` |
| `apihero_get_collection` | Collection detail, folders, variable metadata, auth metadata | **required** `collection` | Sensitive values masked |
| `apihero_list_requests` | List requests | **required** `collection`; **optional** `folder` | |
| `apihero_get_request` | Request details + auth metadata + variable refs | **optional** `collection`, `request`, `requestId` | Resolve by collection+name or `requestId` |
| `apihero_run_request` | Run one request | **optional** `collection`, `request`, `requestId` | Full redacted response presentation |
| `apihero_run_collection` | Run a collection | **required** `collection`; **optional** `failurePolicy` | Slim per-request rows; use get_request_result for full bodies |
| `apihero_run_scenario` | Run a Scenario | **optional** `scenario`, `inputs` | Same `ScenarioEngine` path as UI Run Scenario |
| `apihero_get_run` | Run summary by id | **required** `runId` | |
| `apihero_get_request_result` | One request result from a run | **required** `runId`, `request` | Full secret-redacted response |

`failurePolicy` for `apihero_run_collection`: `stop-on-first-error` | `continue-on-error` | `skip-invalid-requests` (tool default: continue-on-error). Prefer collection **display names** (case-insensitive).

---

## MCP Configuration

API Hero does **not** write client configs. **"API Hero: Configure MCP for Codex" is not implemented.**

### Generic (`mcpServers` JSON)

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": [
        "/absolute/path/to/api-hero/dist/mcp/server.js",
        "--workspace",
        "/absolute/path/to/your-api-workspace"
      ]
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

Installing the extension ≠ MCP registered. Add:

```toml
[mcp_servers.api-hero]
command = "node"
args = [
  "C:/Users/<you>/.vscode/extensions/ankitsemwal.api-hero-2.8.4/dist/mcp/server.js",
  "--workspace",
  "D:/path/to/your-api-workspace"
]
```

Replace `<you>` and paths. macOS/Linux: `~/.vscode/extensions/ankitsemwal.api-hero-<version>/dist/mcp/server.js`. Restart/reload Codex after edits.

### Cursor

Project `.cursor/mcp.json` or Cursor MCP settings — same `command` / `args` / `--workspace` pattern.

### Claude Desktop / Claude Code

`claude_desktop_config.json` or `claude mcp add` with the same Node command, `dist/mcp/server.js`, and `--workspace`.

---

## MCP Example Workflow

1. `apihero_list_collections` — discover workspace
2. `apihero_get_collection` — inspect folders / variables / auth metadata
3. `apihero_list_requests` — find targets
4. `apihero_get_request` — inspect one request
5. `apihero_run_request`, `apihero_run_collection`, or `apihero_run_scenario`
6. `apihero_get_run` — summary / status
7. `apihero_get_request_result` — full redacted response; inspect failure diagnostics

Sample collection: copy `examples/collections/DummyJSON Complete API Collection` into a workspace `Collections/` folder and point `--workspace` at that workspace root.

---

## MCP Security / Redaction

Before tool JSON is returned, API Hero redacts:

- Passwords and password-like fields
- JWTs / compact token strings
- `accessToken` / `refreshToken` (and similar) in JSON bodies
- `Bearer` / `Basic` credentials in text and headers
- Sensitive JSON keys (token, secret, apiKey, authorization, …)
- Token-like assertion Expected/Actual values
- Sensitive headers (masked presentation)

Masked values appear as **`••••••••`**.

Headless MCP uses a **process-env SecretStore** (exact Secret Storage keys or `APIHERO_SECRET_*`) — not VS Code Secret Storage. Prefer **variables** or injected process-env secrets for agent workspaces. **Never** put real secrets in README examples or committed `api-hero.variables.json`.

---

## Workspace Layout

Project-store layout under **`.apihero/`** (canonical paths created by Initialize Project Store). Day-to-day **environments** and **workspace/global variables** also still use VS Code settings (`apiHero.environments`, `apiHero.variables.*`) — dual-read with the project store until settings are fully deprecated.

```text
Collections/<Name>/          # requests, folders, api-hero.variables.json, markers
.apihero/
  config.json
  workspace.json
  environments/
  auth/profiles.json         # metadata; secrets in Secret Storage
  scenarios/*.scenario.json
  local/                     # gitignored — variables.local.json, etc.
  cache/                     # gitignored
  history/                   # reserved/deferred — NOT active request history
```

| Concern | Location |
| --- | --- |
| Requests / collections | `Collections/` (commit) |
| Project config / scenarios | `.apihero/` (commit non-secret parts) |
| Environments / workspace vars (UI) | Settings + project store (dual-read) |
| Local secrets / overlays | `.apihero/local/` (do **not** commit) |
| Auth credentials | VS Code **Secret Storage** |
| Request History | Extension **globalStorageUri** / `request-history.json` |

---

## Git Workflow

**Commit:** `.api` files, collection folders, non-secret collection variables, scenarios, appropriate `.apihero` config.

**Do not commit:** secrets, `.apihero/local/`, credentials, or anything that belongs in Secret Storage.

→ [Git workflow](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/git-workflow.md)

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Won't run | Folder workspace open? `.api` focused? Run shortcut / CodeLens? |
| Lexer / syntax errors | Request line, blank line before body, `###` separators, `expect` placement |
| Unresolved variables | Precedence + spelling; collection `api-hero.variables.json` / active environment |
| Auth failures | Profile id vs label; Secret Storage populated; one-shot vs `@auth` vs collection default |
| Assertion failures | Expected/Actual in Response Viewer; operator/subject spelling |
| Collection failures | Failure policy; dependencies/cycles; Execution + Run Report Details |
| Scenarios not visible | Create a scenario or load existing `.apihero/scenarios/` (progressive disclosure) |
| MCP tools unavailable | Client config present? Server path exists? Node 18+? |
| Codex/Cursor can't see API Hero | **Extension installed ≠ MCP registered** — add client MCP entry yourself |
| MCP won't start | `--workspace` missing value (fail-fast); `dist/mcp/server.js` missing → `npm run compile` |
| Workspace not discovered | Path must be workspace **root** containing `Collections/<Name>/` (`EMPTY_WORKSPACE`) |

→ [Troubleshooting](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/troubleshooting.md) · [MCP guide](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/mcp.md)

---

## FAQ

**What is the extension ID?**  
`ankitsemwal.api-hero`. Commands use the `apiHero.*` prefix.

**Why Collections, Execution, and History in the Activity Bar?**  
Those three are the default views. **Scenarios** appears after a successful scenario load or when you create a scenario, then stays visible for that workspace.

**Is GraphQL supported?**  
No. API Hero targets REST/HTTP `.api` requests.

**Is OAuth2 supported?**  
Not yet. Use `basic`, `bearer`, or `apiKey`. OAuth2 Account Login is not available.

**Does History store response bodies?**  
No. Entries are sanitized metadata for browse, filter, and re-run.

**Where is history stored?**  
VS Code extension `globalStorageUri` as `request-history.json` — not `.apihero/history/`.

**Can I run an entire `.api` file at once?**  
**Run File** is a stub. Use Collection Runner for multi-request runs, or run one request at a time.

**Does installing the extension configure Codex/Cursor/Claude MCP?**  
No. MCP registration is client-owned. Configure each client yourself.

**Is “Configure MCP for Codex” available?**  
No — not implemented.

**Where are settings documented?**  
[Configuration](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/reference/configuration.md) · [Commands](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/reference/commands.md) · [FAQ](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/faq.md)

---

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Run Request | `Ctrl+Alt+R` / `Cmd+Alt+R` (`.api` editor focused) |

More actions: Command Palette (`API Hero: …`) and view title / context menus. Rename/delete in Collections use `F2` / `Delete` when the tree is focused.

---

## Settings

Open **API Hero: Open Settings** or filter Settings with `@ext:ankitsemwal.api-hero`.

Notable keys:

- `apiHero.requestTimeout` · `apiHero.maxResponseBytes`
- `apiHero.history.maxEntries`
- `apiHero.environments` · `apiHero.activeEnvironment`
- `apiHero.authentication.profiles`
- `apiHero.collectionRunner.failurePolicy`
- `apiHero.import.maxFileBytes`
- `apiHero.languageFeatures.hover` / `outline` / `diagnostics`
- `apiHero.variables.global` / `apiHero.variables.workspace`
- `apiHero.logLevel`

→ [Configuration reference](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/reference/configuration.md)

---

## Documentation

| Topic | Link |
| --- | --- |
| Docs home | [docs/README.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) |
| Getting started | [getting-started.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/getting-started.md) |
| MCP for AI agents | [mcp.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/mcp.md) |
| Product overview | [product/README.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/product/README.md) |
| Marketplace assets | [marketplace-assets.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/marketplace-assets.md) |
| Release notes 2.8.4 | [v2.8.4-release-notes.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/v2.8.4-release-notes.md) |

Listing media (hero, screenshots, banner, social preview, workflow GIF) is hosted on **Cloudinary** so the VSIX stays small. Extension icons still ship in-package.

Also used for listing / social: [banner](https://res.cloudinary.com/iaojzqjd/image/upload/banner_psgrx2.png), [social preview](https://res.cloudinary.com/iaojzqjd/image/upload/social-preview_jspifx.png).

---

## Development / Contributing

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
- Stable contribution IDs must not change casually — [stable-identifiers.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/stable-identifiers.md)

---

## Architecture

Concise layers:

| Layer | Role |
| --- | --- |
| Parser | `.api` → request model |
| Request model / builder | Variables, auth attach, HTTP build |
| Project store | `.apihero` workspace layout |
| Collections | Discovery, tree, import/export |
| Runner | Collection / folder / selection runs |
| Orchestrator | Single-request lifecycle |
| Transport | Node HTTP |
| Scenarios | Multi-step workflows |
| MCP | Stdio tools over runner / orchestrator |

```text
.api source → Parser → Request builder → Variables → Auth → Executor → Response / Assertions / History
                                      ↘ Collections / Scenarios / Runner / Execution / OpenAPI / Overview
AI client → MCP stdio → same Runner / Orchestrator (no parallel HTTP client)
```

→ [Architecture](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/architecture/README.md)

---

## License

[MIT](LICENSE)

## Support

[SUPPORT.md](SUPPORT.md) · [GitHub Issues](https://github.com/AnkitSemwal007/API-Hero/issues)
