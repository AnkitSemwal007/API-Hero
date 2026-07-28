# Marketplace assets — 2.3.3

Guidance for listing media for **API Hero 2.3.3**. Full-resolution artwork under `docs/marketplace/` is typically `.vscodeignore`d; ship icons and README screenshots from `images/` (including `images/marketplace/`).

## Icon

| Requirement | Status |
| --- | --- |
| `package.json` `icon` | `images/icon.png` (128×128 PNG) |
| Activity Bar / language glyphs | `images/api-light.svg`, `images/api-dark.svg` |

## Screenshots / GIFs (README + listing)

Capture real UI (not mockups). Target paths for VSIX/GitHub README embeds:

| Path | Subject |
| --- | --- |
| `images/marketplace/hero.png` | Product hero / first impression |
| `images/marketplace/screenshot-collections-editor.png` | Collections + Request Editor (Dependencies / Extract) |
| `images/marketplace/screenshot-response.png` | Response Viewer (Create Variable From Response, copy/save/search) |
| `images/marketplace/screenshot-execution.png` | Execution Center (live collection run) |
| `images/marketplace/screenshot-run-report.png` | Run Report with Collection Run Debugger **Details** expanded |
| `images/marketplace/screenshot-history.png` | History + detail (metadata-only messaging) |
| `images/marketplace/screenshot-environments.png` | Environment Manager (or Auth Manager) |
| `images/marketplace/banner.png` | Wide banner / promo |
| `images/marketplace/social-preview.png` | Social / Open Graph preview |
| `images/marketplace/workflow.gif` | Short create → run → history loop |
| `images/marketplace/workflow-hero.png` | Static workflow hero (optional companion) |

Prefer teal/slate product chrome consistent with gallery banner `#0f766e`. Avoid purple gradient clichés.

> **Note:** `images/marketplace/screenshot-*.png` and `workflow.gif` are presentation-quality product visuals for listing polish. Replacing them with live Extension Development Host captures before a major marketing push is optional follow-up, not a blocker for **2.3.3** publish.

## Banner

See [banner-placeholder.md](../marketplace/banner-placeholder.md). Recommended ~1280×640 product or branded wide image for GitHub/social; Marketplace README images that must ship in the VSIX belong under `images/marketplace/`. Brand banner/social use `docs/marketplace/marketing-api-hero.png` copied to `images/marketplace/banner.png` and `social-preview.png`.

## Checklist

- [x] Screenshots reflect **2.3.3** features (Execution view, Dependencies, Run Report Debugger, Env Manager)
- [x] No GraphQL / OAuth screenshots implying support
- [x] Icon and banner contrast well in Marketplace dark/light cards
- [x] Root README relative paths resolve on GitHub and inside the VSIX
- [x] `images/` (including `images/marketplace/`) is not listed in `.vscodeignore`

## Related

- [Marketplace readiness review](../marketplace/marketplace-readiness-review.md)
- [Marketplace readiness](./marketplace-readiness.md)
- [Product README](../product/README.md)
- [Release notes — 2.3.3](./v2.3.3-release-notes.md)
