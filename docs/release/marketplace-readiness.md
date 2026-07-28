# Marketplace readiness — 2.3.4

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.3.4** (Marketplace README redesign, Cloudinary listing media, packaging lean-up, documentation pins). Extension runtime is unchanged from **2.3.3**.

## Identity

| Field | Value |
| --- | --- |
| `name` | `api-hero` |
| `publisher` | `ankitsemwal` |
| `version` | `2.3.4` |
| Extension ID | `ankitsemwal.api-hero` |
| License | MIT |

## Quality gates

- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build` / TypeScript compile
- [x] `npm run package` produces `release/api-hero-2.3.4.vsix`
- [x] README optimized for Marketplace + GitHub scanning
- [x] Cloudinary listing URLs return HTTP 200
- [x] No GraphQL / OAuth claims beyond shipped scope

## Assets

See [marketplace-assets.md](./marketplace-assets.md), [banner placeholder](../marketplace/banner-placeholder.md), and the full presentation audit [marketplace-readiness-review.md](../marketplace/marketplace-readiness-review.md).

README embeds listing screenshots via **Cloudinary HTTPS URLs** (see [marketplace-assets.md](./marketplace-assets.md)). `images/marketplace/**` is `.vscodeignore`d and `.gitignore`d so those bytes are not in the VSIX or the repo. Extension chrome icons under `images/` still ship.

## Brand vs IDs

Display name **API Hero**; contribution IDs stay stable — [stable-identifiers.md](./stable-identifiers.md).

## Release notes

- [v2.3.4-release-notes.md](./v2.3.4-release-notes.md)
- Prior feature release: [v2.3.3-release-notes.md](./v2.3.3-release-notes.md)

## Operator runbook

[`RELEASE.md`](../../RELEASE.md) — version bump → lint/test/build → `npm run package` → manual portal upload.
