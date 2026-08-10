# API Hero

**Git-first REST/HTTP client for Visual Studio Code**

Author `.api` requests beside your code, run them with assertions, and keep collections in Git — without leaving the editor.

> Extension ID: **`ankitsemwal.api-hero`** · Version: **2.8.0** · License: [MIT](LICENSE)

[Documentation](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md)

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/hero_iluitq.png" alt="API Hero hero" width="800" />

**Why developers use API Hero**

- **Stay in VS Code** — Request Editor, Response Viewer, Collections, Scenarios, Execution, and History live in the editor
- **MCP for AI agents** — discover and run collections from Cursor, Claude Code, Codex, and other MCP clients ([docs](docs/user/mcp.md))
- **Authentication that stays secret** — profiles, Login API sessions, one-shot Bearer, and collection defaults — secrets in VS Code Secret Storage
- **Scenarios for real workflows** — multi-step orchestration with templates, request binding, live step status, and Scenario Reports
- **Git-native collections** — folders and human-readable `.api` files you can diff and review in PRs
- **Run with confidence** — assertions, environments, Live Run Report for collection runs, and health-aware auth
- **Import and grow** — OpenAPI 3.x import into the same `.api` + collection layout

---

## Why API Hero

Most API clients pull you into a separate app and opaque storage. API Hero keeps requests as plain files in your repo and UI where you already work.

| | API Hero | Typical SaaS API clients |
| --- | --- | --- |
| Storage | `.api` files + folders in your repo | Proprietary cloud / local DB |
| Diff / PR | Native Git | Export / sync friction |
| Editor | VS Code native + custom editor | Separate app |
| Secrets | VS Code Secret Storage | Vendor vault / plaintext risk |

No context switching. No binary collections. Same workflow as the rest of your codebase.

---

## Install

**Marketplace:** search **API Hero** or install extension ID `ankitsemwal.api-hero`.

**From VSIX (local build):**

```bash
npm install
npm run package
code --install-extension release/api-hero-2.6.0.vsix
```

Requires VS Code **1.90+**.

---

## Get started (under five minutes)

Open a **folder** workspace in VS Code (required for Collections).

1. **New Collection** — Activity Bar → **API Hero** → **Collections** → **New Collection** (name required). Creates `Collections/<name>/` only after you confirm.
2. **New Request** — set name / method / URL, then edit in the **Request Editor** (default for `*.api`).
3. **Run** — click **Run**, press **Ctrl+Alt+R** / **Cmd+Alt+R**, or use CodeLens **Run Request**.

Inspect the **Response Viewer**. Successful runs appear under **History**. Collection runs show live progress under **Execution**. Multi-step flows live under **Scenarios**.

Environments and auth are optional for a first public GET. Open **API Hero: Open Overview** anytime for quick actions.

<details>
<summary>Alternate: loose <code>.api</code> file</summary>

```http
### Hello
GET https://httpbin.org/get
Accept: application/json
```

Loose files may appear under **Legacy** in Collections until you move them under `Collections/`. Prefer **New Collection** → **New Request** for the standard Git-friendly layout.

</details>

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/workflow_qsb5jj.gif" alt="API Hero workflow" width="800" />

---

## Requesting APIs

### Request Editor

The default custom editor for `.api` files. Edit params, headers, body, auth, variables, **Dependencies**, Extract, and tests — or switch to text when you want the source. Method and URL stay in the toolbar and disable outside form mode.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-collections-editor_idcn2j.png" alt="Collections and Request Editor" width="800" />

→ [Working with Collections](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collections.md)

### Response Viewer

Inspect status, timing, pretty/raw/JSON body, headers, and assertions. Copy or save the body, search within it, and create variables from the response (**Extract Variable…** / **Save as Variable**).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-response_wt1caw.png" alt="Response Viewer" width="800" />

→ [Response Viewer](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/response-viewer.md)

---

## Organizing APIs

### Collections

Collections are workspace folders (typically under `Collections/`) plus optional markers. Create folders and requests from the tree, filter, run a collection or selection, and export/import directories for Git workflows.

→ [Collections](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collections.md) · [Git workflow](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/git-workflow.md)

### History

History stores metadata-safe summaries of past **runs** (masked presentation URLs) — not request files, and response bodies are not stored. Open an entry for detail, re-run, or reveal the original request.

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-history_k4zaq3.png" alt="History" width="800" />

→ [History](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/history.md)

### Scenarios *(flagship)*

Automate one API workflow with branches and shared data — distinct from Collection Runner (many requests). Definitions live under `.apihero/scenarios/*.scenario.json`.

- **Starter templates** when you create a scenario (login + token reuse, health-check branch, CRUD, …)
- **Scenario Editor** with step palette, request binding, and guided properties
- **Run** with optional variable overrides, live step status, and a **Scenario Run Report**
- **Last-run status** in the Scenarios Activity Bar tree

→ [Scenarios](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/scenarios.md)

---

## Configuration

### Environments & variables

Manage named environments in the **Environment Manager**. Precedence: **run → document → environment → collection → workspace → global**. Mark sensitive variables so UI and presentation stay redacted. Collection variables live in `api-hero.variables.json` (or via **Extract Variable** with collection scope).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-environments_wfx7z1.png" alt="Environment Manager" width="800" />

→ [Environments](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/environments.md) · [Variables](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/variables.md)

### Authentication *(flagship)*

Secure, profile-based auth without putting secrets in `.api` files.

- **Manage Authentication** — templates, inline secrets (masked after save), **Test**, and **Run Login**
- **Login API / Session** — obtain tokens via your API; store access/refresh in **Secret Storage**; see health and identity
- **One-shot Bearer** in the Request Editor for a single Send; optional **Save as Authentication**
- **Collection default** and session default; attach with `@auth <profile-id>` (id, not label)
- **Response → Use as Authentication** when tokens are detected (confirm before overwrite)

→ [Authentication](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/authentication.md)

---

## Automation

### Assertions

Add `expect` lines after a request. Run with assertions via CodeLens or **Run Request with Assertions**. Failures appear in the Response Viewer and **Problems**.

→ [Assertions](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/assertions.md)

### Collection Runner & Execution

Run many requests sequentially with progress in the **Execution** Activity Bar view. Configure `apiHero.collectionRunner.failurePolicy` (`ask`, `stop-on-first-error`, `continue-on-error`, `skip-invalid-requests`). When a run finishes, review the **Run Report** and expand per-request **Details** (Collection Run Debugger — last run, in-memory, not History).

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-execution_il1wy7.png" alt="Execution Center" width="800" />

<img src="https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-run-report_pxwll2.png" alt="Run Report" width="800" />

→ [Collection Runner](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collection-runner.md)

### Dependencies

Manual `@depends-on` picker plus Auto / Unknown / Ambiguous projections from the same graph the Collection Runner uses. Pin Auto → Manual when you want the choice written to the `.api` file; Auto never writes on its own.

→ [Collection chaining / dependencies](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collection-runner.md)

---

## Productivity

### OpenAPI Import

**API Hero: Import OpenAPI Specification** opens a wizard: pick a spec, preview, write `.api` files and collection structure. Generation uses the same serializer as the Request Editor.

→ [OpenAPI Import](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/openapi-import.md)

### Overview & language features

**Overview** is a command-opened home for recent runs, collections, and quick actions. The `.api` language adds highlighting, snippets, hover, outline, diagnostics, and CodeLens.

**Not in this release:** Run File (all requests in one editor), OAuth2 / OIDC account Login/Logout, cookie jar, GraphQL/gRPC/WebSocket, Variable Manager UI, persistent Collection Run Report storage, Scenarios Phase 2+ (advanced step types beyond the Scenario Experience in **2.5.0** / **2.6.0**). Authentication Login API (session login against *your* API) **is** included — that is separate from palette-hidden Account Login stubs.

---

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Run Request | `Ctrl+Alt+R` / `Cmd+Alt+R` (`.api` editor focused) |

More actions are available from the Command Palette (`API Hero: …`) and view title menus.

## Settings

Open **API Hero: Open Settings** or filter Settings with `@ext:ankitsemwal.api-hero`.

Notable keys: `apiHero.requestTimeout`, `maxResponseBytes`, `history.maxEntries`, `environments`, `activeEnvironment`, `authentication.profiles`, `collectionRunner.failurePolicy`, `languageFeatures.*`.

→ [Configuration reference](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/reference/configuration.md)

---

## Documentation

| Topic | Link |
| --- | --- |
| Docs home | [docs/README.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) |
| Getting started | [getting-started.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/getting-started.md) |
| Product overview | [product/README.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/product/README.md) |
| Marketplace assets | [marketplace-assets.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/marketplace-assets.md) |

Listing media (hero, screenshots, banner, social preview, workflow GIF) is hosted on **Cloudinary** so the VSIX stays small. Extension icons still ship in-package.

Also used for listing / social: [banner](https://res.cloudinary.com/iaojzqjd/image/upload/banner_psgrx2.png), [social preview](https://res.cloudinary.com/iaojzqjd/image/upload/social-preview_jspifx.png).

---

## Architecture

```text
.api source → Parser → Request builder → Variables → Auth → Executor → Response / Assertions / History
                                      ↘ Collections / Scenarios / Runner / Execution / OpenAPI / Overview (VS Code adapters)
```

→ [Architecture](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/architecture/README.md) · [Development](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/development/README.md)

---

## Roadmap

Near term: Marketplace screenshots for Auth Manager / Scenario Editor, Scenarios Phase 2+ polish, sample collections, Walkthrough contribution, Run File, OAuth2 when ready.

→ [Roadmap](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/product/roadmap.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [development docs](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/development/README.md). Stable contribution IDs must not change casually — [stable-identifiers.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/stable-identifiers.md).

## License

[MIT](LICENSE)

## Support

[SUPPORT.md](SUPPORT.md) · [GitHub Issues](https://github.com/AnkitSemwal007/API-Hero/issues)
