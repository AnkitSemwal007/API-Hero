# Marketplace readiness (working notes)

Engineering Manager expansion notes for the **0.5.0** Marketplace release sprint. Product architecture is approved; this file tracks packaging, SEO, and polish — not new runtime features.

## Metadata / SEO applied

| Field | Choice |
| --- | --- |
| `displayName` | API Hero |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| Extension ID | `ankitsemwal.api-hero` |
| `version` | `0.5.0` |
| `description` | Concise REST/HTTP client pitch (`.api`, collections, variables, auth, assertions, history, OpenAPI) — no keyword stuffing |
| `categories` | `Testing`, `Programming Languages`, `Other` (Testing first for discoverability) |
| `keywords` | api hero, rest/http client, api testing, openapi, collections, http requests, assertions — no “alternative” keyword stuffing |
| `repository` | `https://github.com/AnkitSemwal007/API-Hero.git` |
| `homepage` | `https://github.com/AnkitSemwal007/API-Hero` |
| `bugs` | `https://github.com/AnkitSemwal007/API-Hero/issues` |
| `license` | MIT |
| `galleryBanner` | Dark teal `#0f766e` (avoids purple cliché) |
| `icon` | `images/icon.png` (128×128 PNG from light brand mark) |
| `activationEvents` | Implicit via `contributes` (no explicit list added) |

## Brand vs stable IDs

User-facing strings → **API Hero**. Machine IDs unchanged — see [stable-identifiers.md](./stable-identifiers.md).

## UX polish shipped

- Stub commands `apiRunner.runFile` / `login` / `logout`: titles marked `(Coming Soon)`; information message on invoke
- `viewsWelcome` for Collections and History with refresh / import / focus command links
- Diagnostic source labels: API Hero, API Hero Variables, API Hero Assertions

## Activation performance

`activate()` remains eager to preserve DI registration order. **Do not** lazy-load core orchestrator wiring without an architecture pass.

Safe deferred-load **candidates** for a later micro-sprint (document only for now):

1. Response viewer HTML factory / panel content until first successful response
2. OpenAPI import pipeline modules until `apiRunner.importOpenApi`
3. Collection-runner progress UI helpers until first collection run

Any lazy import must keep command registration and view providers available at activation.

## Packaging

- Script: `npm run package` → `vsce package` (includes production deps such as `yaml`)
- DevDependency: `@vscode/vsce`
- `.vscodeignore` excludes `docs/**`, `scripts/**`, `coverage/**`, `src/**`, `package-lock.json`, etc.
- Do **not** blanket-ignore `node_modules/**` — that strips runtime deps from the VSIX
- Ships: `dist/**/*.js` (non-test), `node_modules/yaml/**`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `SUPPORT.md`, `syntaxes/`, `snippets/`, `images/` (SVGs + Marketplace `icon.png`), `language-configuration.json`
- Local VSIX (validated): ~410 KB with `yaml`; ~215 KB without deps (broken for OpenAPI)

## Publish checklist (manual)

- [x] Provide 128×128 PNG and set `package.json` `icon` (`images/icon.png`)
- [ ] Replace screenshot / banner placeholders (capture real UI; store under `docs/marketplace/` or ship under `images/` if linked from README)
- [ ] `npm run check`; `npm run lint`; `npm test`
- [ ] `npm run package` and smoke-install VSIX (verify OpenAPI import resolves `yaml`)
- [ ] Publisher account `ankitsemwal` verified on Marketplace
- [ ] Personal Access Token with Marketplace publish scope
- [ ] `vsce publish` (out of scope for this sprint — do not publish from automation here)

## Out of scope (confirmed)

- GraphQL, AI, WebSocket, CLI
- Breaking ID changes
- Inventing new Marketplace icon art from scratch (use existing brand PNGs)
- Architecture rewrites
