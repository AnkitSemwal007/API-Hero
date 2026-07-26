# Marketplace readiness — 2.1.2

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.1.2** (patch: array-root JSON path fix for Create Variable / Copy Value).

## Metadata

| Field | Expected |
| --- | --- |
| `displayName` | API Hero |
| `name` / publisher / ID | `api-hero` / `ankitsemwal` / `ankitsemwal.api-hero` |
| `version` | `2.1.2` |
| `description` / keywords / categories | Match shipped REST/HTTP scope (no GraphQL/OAuth claims) |
| `icon` | `images/icon.png` (128×128) |
| `galleryBanner` | `#0f766e` dark |
| License / repo / bugs / homepage | MIT + GitHub links set |

## Functional claims (listing must match)

- Request Editor default for `.api` (including **Extract** tab with Collection/Workspace scopes)
- Collections + History Activity Bar
- Env Manager, Auth Manager, Overview, OpenAPI wizard
- Assertions, **extraction** (`@extract` / `@sensitive-extract`), **Create Variable From Response**, **collection chaining** (`@depends-on`), collection/workspace variables, collection runner + report, history detail
- Stubs called out or omitted: Run File, Login, Logout
- No OAuth2, cookie jar, Code Actions, or GraphQL examples

## Quality gates

- [x] `npm run check` / `npm run lint` / `npm test` pass (684 unit tests)
- [x] `npm run package:fast` produces `release/api-hero-2.1.2.vsix`
- [x] Stable IDs unchanged ([stable-identifiers.md](./stable-identifiers.md))
- [ ] Manual smoke: create request → run → response → history
- [ ] Manual smoke: extract rule → run → extraction report → variable reuse
- [ ] Manual smoke: Create Variable From Response (context menu → scope → rule in `.api` + value available)
- [ ] Manual smoke: collection chaining (`@depends-on` / extract token → dependent request; cycle blocks; collection-scope extract persists)
- [ ] Manual smoke: manage env/auth, filter collections, OpenAPI import

## Assets

See [marketplace-assets.md](./marketplace-assets.md), [banner placeholder](../marketplace/banner-placeholder.md), and the full presentation audit [marketplace-readiness-review.md](../marketplace/marketplace-readiness-review.md).

## Brand vs IDs

User-facing **API Hero**; machine IDs remain `apiRunner.*`.
