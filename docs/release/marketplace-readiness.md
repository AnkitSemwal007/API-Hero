# Marketplace readiness — 0.2.0

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **0.2.0** (Phase 1 complete).

## Metadata

| Field | Expected |
| --- | --- |
| `displayName` | API Hero |
| `name` / publisher / ID | `api-hero` / `ankitsemwal` / `ankitsemwal.api-hero` |
| `version` | `0.2.0` |
| `description` / keywords / categories | Match shipped REST/HTTP scope (no GraphQL/OAuth claims) |
| `icon` | `images/icon.png` (128×128) |
| `galleryBanner` | `#0f766e` dark |
| License / repo / bugs / homepage | MIT + GitHub links set |

## Functional claims (listing must match)

- Request Editor default for `.api` (including **Extract** tab)
- Collections + History Activity Bar
- Env Manager, Auth Manager, Overview, OpenAPI wizard
- Assertions, **extraction** (`@extract` / `@sensitive-extract`), collection runner + report, history detail
- Stubs called out or omitted: Run File, Login, Logout; collection chaining deferred to Phase 2
- No OAuth2, cookie jar, Code Actions, or GraphQL examples

## Quality gates

- [ ] `npm run check` / `npm run lint` / `npm test` pass
- [ ] `npm run package` produces a VSIX
- [ ] Manual smoke: create request → run → response → history
- [ ] Manual smoke: extract rule → run → extraction report → variable reuse
- [ ] Manual smoke: manage env/auth, filter collections, OpenAPI import
- [ ] Stable IDs unchanged ([stable-identifiers.md](./stable-identifiers.md))

## Assets

See [marketplace-assets.md](./marketplace-assets.md), [banner placeholder](../marketplace/banner-placeholder.md), and the full presentation audit [marketplace-readiness-review.md](../marketplace/marketplace-readiness-review.md).

## Brand vs IDs

User-facing **API Hero**; machine IDs remain `apiRunner.*`.
