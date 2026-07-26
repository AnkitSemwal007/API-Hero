# API Hero

**Git-first REST/HTTP client for Visual Studio Code** — author human-readable `.api` requests beside your code, run them with assertions, organize collections as folders, manage environments and auth, import OpenAPI, and inspect responses professionally.

> Extension ID: **`ankitsemwal.api-hero`** · Version: **2.1.2** · License: [MIT](LICENSE)

[Documentation](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/README.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

---

## Why API Hero

| Principle | What you get |
| --- | --- |
| **UI-first** | Request Editor, Response Viewer, Env/Auth managers, Overview, History Detail, Run Report |
| **Git-first** | Collections live as folders and `.api` files you can diff and review |
| **Canonical source** | `.api` files are the source of truth — edit in the form or as text |
| **Native VS Code** | Activity Bar views, Secret Storage, Problems panel, CodeLens, settings |
| **Safe by default** | Secrets stay out of git; presentation URLs and viewers mask sensitive values |

API Hero is for developers who want Postman-like speed **without** leaving the editor or fighting opaque binary collections.

---

## Install

**Marketplace:** search **API Hero** or install extension ID `ankitsemwal.api-hero`.

**From VSIX (local build):**

```bash
npm install
npm run package
code --install-extension release/api-hero-2.1.2.vsix
```

Requires VS Code **1.90+**.

---

## Quick start (under five minutes)

Open a **folder** workspace in VS Code (required for Collections). Then:

### 1. New Collection

Open the **API Hero** Activity Bar → **Collections** → **New Collection** (or **API Hero: New Collection**). Fill the **Create Collection** dialog (**Name** required, **Description** optional). The collection is created under `Collections/<name>/` only after you confirm **Create** — Cancel writes nothing.

### 2. New Request

Choose **New Request**, set a name/method/URL in the dialog, then edit in the **Request Editor** (default for `*.api`).

### 3. Set URL and Run

Set or confirm the URL, then:

- Click **Run** in the Request Editor toolbar, or  
- Press **Ctrl+Alt+R** / **Cmd+Alt+R**, or  
- Use CodeLens **Run Request**

Inspect the **Response Viewer**. Successful runs appear under **History**.

Environments and authentication are optional for a first public GET. Try **API Hero: Open Overview** anytime for a home screen with quick actions.

### Alternate: loose `.api` file (advanced)

You can also create a `.api` file anywhere in the workspace and run it the same way:

```http
### Hello
GET https://httpbin.org/get
Accept: application/json
```

Loose files may appear under a **Legacy** entry in Collections until you move them under `Collections/`. Prefer **New Collection** → **New Request** for the standard Git-friendly layout.

---

## Feature highlights

- **`.api` language** — highlighting, snippets, hover, outline, diagnostics, CodeLens
- **Request Editor** — default custom editor for `.api` (params, headers, body, auth, variables, tests, preview)
- **Response Viewer** — status card, pretty/raw/JSON, headers, assertions, **extraction report**; **copy**, **save**, **search**; **Create Variable From Response** (context menu → scope → confirmation sheet)
- **Extraction** — `@extract` / `@sensitive-extract`, Extraction Engine, Run/document/environment/collection/**workspace** variable scopes, Request Editor **Extract** tab
- **Collections** — Activity Bar explorer, folders, CRUD, filter, drag-and-drop, import/export folder trees
- **Collection Runner** — run collection / folder / selection / tests with failure policy + **Run Report**; **collection chaining** (`@depends-on`, produces/consumes) reorders and runs dependent requests with a shared run store
- **History** — persisted runs, facet filters, **detail panel**, re-run, reveal original request
- **Environments** — Environment Manager panel + status bar chip; precedence with run/document/environment/collection/workspace/global variables
- **Authentication** — none / basic / bearer / API key profiles; Secret Storage; Auth Manager + preview
- **Assertions** — `expect` lines with Problems diagnostics
- **OpenAPI Import** — OpenAPI 3.x multi-step wizard → `.api` + collection structure
- **Overview** — command-opened home for recent runs, collections, and quick actions

**Not in this release:** Run File (all requests in one editor), Login/Logout OAuth, cookie jar, GraphQL/gRPC/WebSocket.

---

## Screenshots & GIFs

_Screenshots and GIFs are not bundled in the VSIX yet._ Recommended captures from a real 2.1.2 build:

1. Request Editor + Response Viewer side by side (run affordance visible)
2. Collections Activity Bar (filter / run optional)
3. History view + detail panel
4. Environment Manager or Auth Manager
5. OpenAPI Import wizard or Collection Run Report
6. Optional short GIF: create → run → history

Asset guidance: [docs/marketplace/banner-placeholder.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/marketplace/banner-placeholder.md) · [marketplace-assets.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/marketplace-assets.md) · [marketplace-readiness-review.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/marketplace/marketplace-readiness-review.md)

---

## Collections

Collections are workspace folders (typically under `Collections/`) plus optional markers. Create folders and requests from the tree, filter, run a collection or selection, and export/import collection directories for Git workflows.

→ [Working with Collections](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collections.md) · [Git workflow](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/git-workflow.md)

## History

History stores metadata-safe summaries (masked presentation URLs). Open an entry for detail, re-run, reveal the original request, or copy a summary.

→ [History](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/history.md)

## Environments & variables

Manage named environments in the **Environment Manager**. Variable precedence: **run → document → environment → collection → workspace → global**. Mark sensitive variables so UI and presentation stay redacted.

→ [Environments](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/environments.md) · [Variables](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/variables.md)

## Authentication

Create profiles (none, basic, bearer, API key) in **Manage Authentication**. Secrets use VS Code **Secret Storage**. Attach with `@auth profileName` or **Select Authentication**.

→ [Authentication](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/authentication.md)

## Assertions

Add `expect` lines after a request. Run with assertions via CodeLens or **Run Request with Assertions**. Failures appear in the Response Viewer and **Problems**.

→ [Assertions](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/assertions.md)

## Response Viewer

Professional inspection: status, timing, pretty/raw body, headers, assertion summary. Copy body or headers, save body to disk, search within the body.

→ [Response Viewer](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/response-viewer.md)

## Collection Runner

Run many requests sequentially with progress UI. Configure `apiRunner.collectionRunner.failurePolicy` (`ask`, `stop-on-first-error`, `continue-on-error`, `skip-invalid-requests`). Review the **Run Report** panel when a run finishes.

→ [Collection Runner](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/collection-runner.md)

## OpenAPI Import

**API Hero: Import OpenAPI Specification** opens a wizard: pick a spec, preview, write `.api` files and collection structure. Generation uses the same serializer as the Request Editor.

→ [OpenAPI Import](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/openapi-import.md)

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Run Request | `Ctrl+Alt+R` / `Cmd+Alt+R` (`.api` editor focused) |

More actions are available from the Command Palette (`API Hero: …`) and view title menus.

## Configuration

Open **API Hero: Open Settings** or filter Settings with `@ext:ankitsemwal.api-hero`.

Notable keys: `apiRunner.requestTimeout`, `maxResponseBytes`, `history.maxEntries`, `environments`, `activeEnvironment`, `authentication.profiles`, `collectionRunner.failurePolicy`, `languageFeatures.*`.

→ [Configuration reference](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/reference/configuration.md)

## Comparison (short)

| | API Hero | Typical SaaS API clients |
| --- | --- | --- |
| Storage | `.api` + folders in your repo | Proprietary cloud/local DB |
| Diff / PR | Native Git | Export/sync friction |
| Editor | VS Code native + custom editor | Separate app |
| Secrets | VS Code Secret Storage | Vendor vault / plaintext risk |

## Architecture overview

```text
.api source → Parser → Request builder → Variables → Auth → Executor → Response / Assertions / History
                                      ↘ Collections tree / Runner / OpenAPI / Overview (VS Code adapters)
```

→ [Architecture](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/architecture/README.md) · [Development](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/development/README.md)

## Roadmap

Near term: Marketplace screenshots/GIFs, sample collections, Walkthrough contribution, Run File, richer auth (OAuth) when ready. See [roadmap](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/product/roadmap.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [development docs](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/development/README.md). Stable contribution IDs must not change casually — [stable-identifiers.md](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/release/stable-identifiers.md).

## License

[MIT](LICENSE)

## Support

[SUPPORT.md](SUPPORT.md) · [GitHub Issues](https://github.com/AnkitSemwal007/API-Hero/issues)
