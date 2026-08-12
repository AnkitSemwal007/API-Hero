# Marketplace readiness — 2.9.0

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.9.0** (Postman Import, Insomnia Import, cURL→`.api`, Variable Autocomplete polish, Failure Diagnostics Possible causes, Request/Response Diff, TypeScript generation, VSIX esbuild bundling; builds on **2.8.4** Collection Execution Controls / OpenAPI env safety).

**Note:** Headless CLI / CI (`apihero`) implementation is retained in-repo for development. It is **not** advertised or distributed as a shipped public product capability in **2.9.0**.

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.9.0` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build` / TypeScript compile (`npm run check` + `npm run compile`)
- [x] `npm run package` produces `release/api-hero-2.9.0.vsix` (~659 KB / ~21 files with esbuild bundling)
- [x] README Marketplace presentation — developer reference (requests, collections, variables, auth, assertions, runner, history, scenarios, OpenAPI/Postman/Insomnia/cURL import, MCP); no public CLI distribution claims
- [x] MCP docs ([user/mcp.md](../user/mcp.md)) — nine tools including `apihero_run_scenario`; client-owned config; extension path pin **2.9.0**
- [x] Import / Collection Runner / Response docs match **2.9.0** Postman/Insomnia/cURL import, Failure Diagnostics Possible causes, Diff, and TypeScript generation
- [x] Security — Response UI / assertions / MCP / cURL share sensitive header names; import previews mask secrets; Diff/codegen use redacted presentations
- [x] No GraphQL / gRPC / OAuth2 / Cookie jar claims beyond shipped scope
- [x] Storage docs correct: history = VS Code `globalStorageUri` / `request-history.json`; scenarios = `.apihero/scenarios/`
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)
- [x] Auth and Scenarios contributions use `apiHero.*` (legacy `apiRunner.*` aliases for compatibility)
- [x] VSIX contains bundled `dist/extension.js`, `dist/mcp/server.js`, `dist/cli/main.js`, and `bin/api-hero-mcp.js` (runtime deps inlined; no `node_modules`, no `src/`, no `*.map`, no `*.test.js`)

## Assets

See [marketplace-assets.md](./marketplace-assets.md). Listing media may still use prior Cloudinary sets; MCP is a headless capability (document in README / mcp.md). Do not list public CLI distribution in Marketplace narrative.

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.9.0**
- [v2.9.0-release-notes.md](./v2.9.0-release-notes.md)

## Manual upload

Follow [RELEASE.md](../../RELEASE.md): `npm run package` → portal upload. Do **not** `vsce publish` in this environment.
