# Marketplace readiness — 2.8.3

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.8.3** (headless CLI / CI, Copy as cURL, MCP `apihero_run_scenario`; builds on **2.8.2** OpenAPI URL import).

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.8.3` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test` (1129 passed)
- [x] `npm run build` / TypeScript compile (`npm run check` + `npm run compile`)
- [x] `npm run package` produces `release/api-hero-2.8.3.vsix` (~3.81 MB)
- [x] README Marketplace presentation — complete developer reference (requests, collections, variables, auth, assertions, runner, history, scenarios, OpenAPI, MCP, CLI)
- [x] MCP docs ([user/mcp.md](../user/mcp.md)) — nine tools including `apihero_run_scenario`; client-owned config; extension path pin **2.8.3**
- [x] CLI docs ([user/cli.md](../user/cli.md)) — `apihero` commands, exit codes, secrets, CI examples
- [x] No GraphQL / OAuth2 claims beyond shipped scope
- [x] Storage docs correct: history = VS Code `globalStorageUri` / `request-history.json`; scenarios = `.apihero/scenarios/`
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)
- [x] Auth and Scenarios contributions use `apiHero.*` (legacy `apiRunner.*` aliases for compatibility)
- [x] VSIX contains `dist/mcp/server.js`, `dist/cli/main.js`, `bin/api-hero-mcp.js`, `bin/apihero.js`, and `@modelcontextprotocol/sdk` (no `src/`, no `*.map`, no `*.test.js`)

## Assets

See [marketplace-assets.md](./marketplace-assets.md). Listing media may still use prior Cloudinary sets; MCP/CLI are headless capabilities (document in README / mcp.md / cli.md).

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.8.3**
- [v2.8.3-release-notes.md](./v2.8.3-release-notes.md)

## Manual upload

Follow [RELEASE.md](../../RELEASE.md): `npm run package` → portal upload. Do **not** `vsce publish` in this environment.
