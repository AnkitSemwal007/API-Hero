# API Hero

**REST/HTTP client for Visual Studio Code** — author `.api` requests beside your code, run them with assertions, organize collections, manage environments and auth, import OpenAPI, and review history.

> Marketplace extension ID: `ankitsemwal.api-hero`

## Features

- **`.api` language** — syntax highlighting, snippets, hovers, outline, diagnostics, and code lenses
- **Request execution** — run a single request (or with assertions) with progress and a response viewer
- **Variables & environments** — global, workspace, environment, and document variables with sensitive-value masking
- **Authentication** — none, basic, bearer, and API key profiles; secrets via VS Code Secret Storage
- **Assertions** — `expect` lines with Problems diagnostics and pass/fail summaries
- **Collections** — Activity Bar explorer for workspace `.api` files; run collection, folder, or selection
- **History** — persisted request history with search, re-run, and reveal original request
- **OpenAPI import** — generate `.api` requests and collection structure from OpenAPI 3.x specs

## Screenshots

_Screenshots and banner art are not included in this release package yet._ Capture editor, Collections, Response viewer, and History for the Marketplace listing. On GitHub, asset guidance lives under `docs/marketplace/` and `docs/release/marketplace-assets.md`.

## Installation

### From VSIX (local / CI)

```bash
npm install
npm run package
code --install-extension api-hero-0.6.2.vsix
```

### From Marketplace

_After publish:_ search for **API Hero** or install `ankitsemwal.api-hero`.

## Quick Start

1. Open a folder in VS Code.
2. Create `hello.api` (see below).
3. Place the cursor on the request and run **API Hero: Run Request** (`Ctrl+Alt+R` / `Cmd+Alt+R`).
4. Inspect the response panel and optional History entry.

## Creating your first request

```http
### Hello
GET https://httpbin.org/get
Accept: application/json
```

Save as a `.api` file. Separators use `###`. Directives, headers, bodies, variables, and `expect` lines follow the documented grammar.

## Running requests

| Action | Command |
| --- | --- |
| Run request under cursor | **API Hero: Run Request** |
| Run with assertions | **API Hero: Run Request with Assertions** |
| Run a collection / folder / selection | Collections view context menu |

Status bar and progress notifications show run state. Failures surface clear error messages.

## Variables

Configure under **Settings → API Hero**:

- `apiRunner.variables.global`
- `apiRunner.variables.workspace`
- `apiRunner.environments` + `apiRunner.activeEnvironment`

Use `{{name}}` in URLs, headers, and bodies. Mark sensitive values so UI and diagnostics mask them. Switch environments with **API Hero: Switch Environment**.

## Authentication

Define profiles in `apiRunner.authentication.profiles`. Prefer `kind: "secret"` sources (Secret Storage) over literals. Select a profile with **API Hero: Select Authentication Profile**.

## Assertions

Add expectation lines in the request block, for example:

```http
### Status OK
GET https://httpbin.org/status/200

expect status == 200
expect responseTime < 5000
```

Run with **API Hero: Run Request with Assertions**. Failures appear in Problems under source **API Hero Assertions**.

## Collections

The **Collections** Activity Bar view lists `.api` files under each workspace folder. Refresh, reveal the active request, or run collection / folder / selected requests from the tree.

## History

The **History** view stores recent runs (bounded by `apiRunner.history.maxEntries`). Open, re-run, search, delete, or clear history from the view toolbar and item menus.

## OpenAPI Import

**API Hero: Import OpenAPI Specification** loads an OpenAPI 3.x JSON/YAML file (size limited by `apiRunner.import.maxFileBytes`), generates `.api` requests, and refreshes collections. Secrets become placeholders — configure Secret Storage afterward.

## Commands

All command IDs remain `apiRunner.*` (stable). Titles use the **API Hero:** prefix.

Notable commands: Run Request, Run Request with Assertions, Switch Environment, Select Authentication Profile, Refresh Collections, Reveal Active Request, Run Collection / Folder / Selected Requests, History open/re-run/search/clear, Import OpenAPI Specification.

Stubbed (coming soon — still registered for ID stability): Run File, Login, Logout.

## Keyboard shortcuts

| Shortcut | Command |
| --- | --- |
| `Ctrl+Alt+R` / `Cmd+Alt+R` | Run Request (in `.api` editors) |

## FAQ

**What is the extension ID?**  
`ankitsemwal.api-hero` (publisher `ankitsemwal`, package `api-hero`). Command IDs and settings still use the `apiRunner.*` namespace for compatibility.

**Is GraphQL / WebSocket / AI supported?**  
Not in this release. See Roadmap.

**Where is the Marketplace icon?**  
Shipped as `images/icon.png` (128×128) via `package.json` `"icon"`. Language file icons use the 16×16 light/dark SVGs under `images/`; the Activity Bar container currently uses `images/api-dark.svg` only.

## Roadmap

- Run File (all requests in editor)
- Login / Logout UX polish for auth workflows
- Marketplace screenshots and banner capture
- Optional deferred activation of heavy UI modules

Out of scope for current architecture: GraphQL, AI assist, WebSocket live sessions, standalone CLI.

## Contributing

Issues and feature requests: [GitHub Issues](https://github.com/AnkitSemwal007/API-Hero/issues). See [SUPPORT.md](SUPPORT.md). Internal command IDs (`apiRunner.*`), configuration keys, language id `api`, and grammar `source.api-runner` remain stable for compatibility.

## License

MIT — see [LICENSE](LICENSE).
