# Marketplace assets — 2.0.1

Guidance for listing media for **API Hero 2.0.1**. Full-resolution artwork under `docs/marketplace/` is typically `.vscodeignore`d; ship icons from `images/`.

## Icon

| Requirement | Status |
| --- | --- |
| `package.json` `icon` | `images/icon.png` (128×128 PNG) |
| Activity Bar / language glyphs | `images/api-light.svg`, `images/api-dark.svg` |

## Screenshots / GIFs (needed for polish)

Capture real UI (not mockups):

1. Request Editor on a `.api` file (run affordance + Extract tab visible)
2. Collections tree (filter / run optional)
3. Response viewer with copy/save/search and extraction report
4. History view + detail panel
5. Environment Manager or Auth Manager
6. Optional: OpenAPI wizard or Collection Run Report

Prefer teal/slate product chrome consistent with gallery banner `#0f766e`. Avoid purple gradient clichés.

## Banner

See [banner-placeholder.md](../marketplace/banner-placeholder.md). Recommended ~1280×640 product or branded wide image for GitHub/social; Marketplace README images that must ship in the VSIX belong under `images/`.

## Checklist

- [ ] Screenshots reflect 2.0.1 features only
- [ ] No GraphQL / OAuth screenshots implying support
- [ ] Icon and banner contrast well in Marketplace dark/light cards
- [ ] Root README links use paths that resolve on GitHub and/or inside the VSIX as intended

## Related

- [Marketplace readiness review](../marketplace/marketplace-readiness-review.md)
- [Marketplace readiness](./marketplace-readiness.md)
- [Product README](../product/README.md)
