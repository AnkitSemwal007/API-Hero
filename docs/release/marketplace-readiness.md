# Marketplace readiness — 2.6.0

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.6.0** (Scenarios progressive disclosure, project-store scenario paths, Reset Workspace, Run Report failure diagnostics; builds on **2.5.0** Authentication Premium UX + Scenario Experience).

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.6.0` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test` (1015 pass / 0 fail)
- [x] `npm run build` / TypeScript compile
- [x] `npm run package` produces `release/api-hero-2.6.0.vsix` (~0.83 MB / 851.47 KB packed)
- [x] README Marketplace presentation + Cloudinary listing URLs
- [x] Progressive disclosure and Reset Workspace documented
- [x] No GraphQL / OAuth2 claims beyond shipped scope (Login API ≠ OAuth account login)
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)
- [x] Auth and Scenarios contributions use `apiHero.*` (legacy `apiRunner.*` aliases for compatibility)
- [x] `apiHero.explorer` gated with `when: apiHero.scenariosVisible`
- [x] VSIX contains `scenario-view-visibility.js` and `register-reset-workspace.js`

## Assets

See [marketplace-assets.md](./marketplace-assets.md) (listing media still the **2.3.4** Cloudinary set; Auth Manager / Scenario Editor screenshots recommended follow-up). `images/marketplace/**` remains `.vscodeignore`d / `.gitignore`d. Extension chrome icons under `images/` still ship.

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.6.0**
- [v2.6.0-release-notes.md](./v2.6.0-release-notes.md)
- Prior: [CHANGELOG 2.5.0](../../CHANGELOG.md) · [v2.5.0-release-notes.md](./v2.5.0-release-notes.md)

## Operator runbook

[`RELEASE.md`](../../RELEASE.md) — version bump → lint/test/build → `npm run package` → manual portal upload.
