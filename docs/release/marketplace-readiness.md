# Marketplace readiness — 2.7.0

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.7.0** (MCP server for AI agents; builds on **2.6.0** workspace hygiene / Scenarios UX).

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.7.0` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test` (1040 pass / 0 fail)
- [x] `npm run build` / TypeScript compile
- [x] `npm run package` produces `release/api-hero-2.7.0.vsix` (~3.78 MB / 3968189 bytes packed)
- [x] README Marketplace presentation + MCP for AI agents callout
- [x] MCP docs ([user/mcp.md](../user/mcp.md))
- [x] No GraphQL / OAuth2 claims beyond shipped scope
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)
- [x] Auth and Scenarios contributions use `apiHero.*` (legacy `apiRunner.*` aliases for compatibility)
- [x] VSIX contains `dist/mcp/server.js`, `bin/api-hero-mcp.js`, and `@modelcontextprotocol/sdk`

## Assets

See [marketplace-assets.md](./marketplace-assets.md). Listing media may still use prior Cloudinary sets; MCP is a headless/stdio capability (document in README / mcp.md).

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.7.0**
- [v2.7.0-release-notes.md](./v2.7.0-release-notes.md)

## Marketplace publish (deferred)

Do **not** publish until the VSIX is verified and the publisher explicitly runs `vsce publish` / Marketplace upload.
