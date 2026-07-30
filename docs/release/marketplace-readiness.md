# Marketplace readiness — 2.5.0

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.5.0** (Authentication Premium UX + Scenario Experience; builds on **2.4.0** Scenarios Phase 1).

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.5.0` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test` (934 pass / 0 fail)
- [x] `npm run build` / TypeScript compile
- [x] `npm run package` produces `release/api-hero-2.5.0.vsix` (~5.14 MB)
- [x] README Marketplace presentation + Cloudinary listing URLs
- [x] Authentication and Scenarios called out as flagship capabilities
- [x] No GraphQL / OAuth2 claims beyond shipped scope (Login API ≠ OAuth account login)
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)
- [x] Auth and Scenarios contributions use `apiHero.*` (legacy `apiRunner.*` aliases for compatibility)

## Assets

See [marketplace-assets.md](./marketplace-assets.md) (listing media still the **2.3.4** Cloudinary set; Auth Manager / Scenario Editor screenshots recommended follow-up). `images/marketplace/**` remains `.vscodeignore`d / `.gitignore`d. Extension chrome icons under `images/` still ship.

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.5.0**
- [v2.5.0-release-notes.md](./v2.5.0-release-notes.md)
- Prior: [CHANGELOG 2.4.0](../../CHANGELOG.md)

## Operator runbook

[`RELEASE.md`](../../RELEASE.md) — version bump → lint/test/build → `npm run package` → manual portal upload.
