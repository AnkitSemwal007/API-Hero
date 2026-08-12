# Marketplace readiness — 2.8.4

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.8.4** (OpenAPI environment safety, Collection Run Report / Variable Trace UX, Scenario menu cleanup; builds on **2.8.3** Copy as cURL + MCP `apihero_run_scenario` and **2.8.2** OpenAPI URL import).

**Note:** Headless CLI / CI (`apihero`) implementation is retained in-repo for development. It is **not** advertised or distributed as a shipped public product capability in **2.8.4**.

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.8.4` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test` (1140 passed)
- [x] `npm run build` / TypeScript compile (`npm run check` + `npm run compile`)
- [x] `npm run package` produces `release/api-hero-2.8.4.vsix` (~3.82 MB)
- [x] README Marketplace presentation — developer reference (requests, collections, variables, auth, assertions, runner, history, scenarios, OpenAPI, MCP); no public CLI distribution claims
- [x] MCP docs ([user/mcp.md](../user/mcp.md)) — nine tools including `apihero_run_scenario`; client-owned config; extension path pin **2.8.4**
- [x] OpenAPI / Collection Runner user docs match **2.8.4** env safety and compact Run Report UX
- [x] No GraphQL / OAuth2 claims beyond shipped scope
- [x] Storage docs correct: history = VS Code `globalStorageUri` / `request-history.json`; scenarios = `.apihero/scenarios/`
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)
- [x] Auth and Scenarios contributions use `apiHero.*` (legacy `apiRunner.*` aliases for compatibility)
- [x] VSIX contains `dist/mcp/server.js`, `bin/api-hero-mcp.js`, and `@modelcontextprotocol/sdk` (no `src/`, no `*.map`, no `*.test.js`)

## Assets

See [marketplace-assets.md](./marketplace-assets.md). Listing media may still use prior Cloudinary sets; MCP is a headless capability (document in README / mcp.md). Do not list public CLI distribution in Marketplace narrative.

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.8.4**
- [v2.8.4-release-notes.md](./v2.8.4-release-notes.md)

## Manual upload

Follow [RELEASE.md](../../RELEASE.md): `npm run package` → portal upload. Do **not** `vsce publish` in this environment.
