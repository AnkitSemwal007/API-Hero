# Marketplace readiness — 2.3.6

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.3.6** (Activity Bar view registration fix; builds on 2.3.5 contribution namespace migration).

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.3.6` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build` / TypeScript compile
- [x] `npm run package` produces `release/api-hero-2.3.6.vsix`
- [x] README Marketplace presentation + Cloudinary listing URLs
- [x] No GraphQL / OAuth claims beyond shipped scope
- [x] Namespace migration compatibility aliases documented in [stable-identifiers.md](./stable-identifiers.md)

## Assets

See [marketplace-assets.md](./marketplace-assets.md) (listing media unchanged from **2.3.4** Cloudinary set). `images/marketplace/**` remains `.vscodeignore`d / `.gitignore`d. Extension chrome icons under `images/` still ship.

## Brand vs IDs

Display name **API Hero**; canonical contribution IDs are now **`apiHero.*`** — [stable-identifiers.md](./stable-identifiers.md). Legacy `apiRunner.*` aliases remain for the compatibility window.

## Release notes

- [CHANGELOG.md](../../CHANGELOG.md) — **2.3.6**
- Prior: [v2.3.5-release-notes.md](./v2.3.5-release-notes.md)

## Operator runbook

[`RELEASE.md`](../../RELEASE.md) — version bump → lint/test/build → `npm run package` → manual portal upload.
