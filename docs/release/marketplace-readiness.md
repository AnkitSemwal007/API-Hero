# Marketplace readiness — 2.3.3

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.3.3** (Execution Center, Collection Runner / Run Report polish, dependency workflow, terminology / discoverability, Marketplace assets).

## Metadata

| Field | Expected |
| --- | --- |
| `displayName` | API Hero |
| `name` / publisher / ID | `api-hero` / `ankitsemwal` / `ankitsemwal.api-hero` |
| `version` | `2.3.3` |
| `description` / keywords / categories | Match shipped REST/HTTP scope (no GraphQL/OAuth claims) |
| `icon` | `images/icon.png` (128×128) |
| `galleryBanner` | `#0f766e` dark |
| License / repo / bugs / homepage | MIT + GitHub links set |

## Functional claims (listing must match)

- Request Editor default for `.api` (including **Dependencies**, **Extract** tab with Collection/Workspace scopes)
- Collections + **Execution** + History Activity Bar
- Env Manager, Auth Manager, Overview, OpenAPI wizard
- Assertions, **extraction** (`@extract` / `@sensitive-extract`), **Create Variable From Response**, **collection chaining** (`@depends-on`), Collection Runner + **Run Report** / **Collection Run Debugger** (last-run in-memory Details)
- Stubs called out or omitted: Run File, Login, Logout
- No OAuth2, cookie jar, Code Actions, GraphQL, or Variable Manager UI

## Quality gates

- [x] `npm run check` / `npm run lint` / `npm test` pass
- [x] `npm run package` produces `release/api-hero-2.3.3.vsix`
- [x] Stable IDs unchanged ([stable-identifiers.md](./stable-identifiers.md))
- [ ] Manual smoke: create collection → new request → run → History metadata detail
- [ ] Manual smoke: collection run → Execution view + Run Report Details (Debugger)
- [ ] Manual smoke: multi/empty Request Editor → Method/URL disabled; Dependencies focus retained
- [ ] Manual smoke: rename environment → selection + secrets intact
- [ ] Manual smoke: extract rule → run → extraction report → variable reuse
- [ ] Manual smoke: manage env/auth, filter collections, OpenAPI import

## Assets

See [marketplace-assets.md](./marketplace-assets.md), [banner placeholder](../marketplace/banner-placeholder.md), and the full presentation audit [marketplace-readiness-review.md](../marketplace/marketplace-readiness-review.md).

README embeds PNGs under `images/marketplace/` (must ship in the VSIX — not `.vscodeignore`d).

## Brand vs IDs

User-facing **API Hero**; machine IDs remain `apiRunner.*`.
