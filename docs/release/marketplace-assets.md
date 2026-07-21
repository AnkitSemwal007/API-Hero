# Marketplace assets

Guidance for listing media. Full-resolution brand artwork lives under `docs/marketplace/` (excluded from VSIX). Do not invent new PNG artwork from scratch for publish — resize or crop designer-provided sources.

## Icon (ready)

| Requirement | Status |
| --- | --- |
| Marketplace `package.json` `icon` | **Set** — `images/icon.png` (128×128 PNG) |
| Required size | **128×128 PNG** (square) |
| Source artwork | `docs/marketplace/api-hero-icon-light.png`, `docs/marketplace/api-hero-icon-dark.png` (full-res) |
| Designer 128 variants (docs only) | `docs/marketplace/icon-128-light.png`, `docs/marketplace/icon-128-dark.png` |
| Activity Bar / language icons | `images/api-light.svg`, `images/api-dark.svg` — **16×16 document glyphs** (unchanged) |

### Validation notes

- VS Code Marketplace expects a square **128×128 PNG** referenced from `package.json` `"icon"`.
- Marketplace ships a **single** gallery icon: `images/icon.png` (derived from the light brand mark via center-crop + high-quality downscale). Dark/light 128 variants stay under `docs/marketplace/` so they do not bloat the VSIX.
- Activity Bar still uses the document glyph SVGs pending a true monochrome 16×16 SVG of the hero mark. Do **not** force a muddy PNG downscale for Activity Bar size.
- Keep the publish icon under `images/` so it ships in the VSIX (do not place it only under ignored `docs/`).

## Banner / hero image

- Full-res marketing banner: `docs/marketplace/marketing-api-hero.png` (dark banner).
- README notes that in-listing screenshots may still be pending; capture guidance for GitHub lives under `docs/marketplace/`.
- Recommended Marketplace / GitHub social preview: ~1280×640 wide PNG/JPG showing the product UI (editor + Activity Bar). Current draft banner `docs/marketplace/marketing-api-hero.png` is **1254×552** (dark theme only).
- Marketplace README is served from the VSIX: prefer root-relative images under `images/` for in-package README media, or keep deep asset docs on GitHub only (`docs/**` is `.vscodeignore`d).

## Screenshots (recommended set)

Capture at least:

1. `.api` editor with code lens / Run Request
2. Collections tree with a run in progress or completed
3. Response viewer panel
4. History view with searchable entries
5. Settings / auth profile UX (optional)

Suggested filenames (placeholders under `docs/marketplace/`):

- `screenshot-editor.png`
- `screenshot-collections.png`
- `screenshot-response.png`
- `screenshot-history.png`

## GIFs

Optional short GIFs (≤ ~5–8s) for Run Request and OpenAPI import. Prefer muted UI chrome; avoid flashing secrets.

## Logo usage

- Product name in UI chrome: **API Hero**
- Extension ID in technical docs: `ankitsemwal.api-hero`
- Do not redesign the Activity Bar glyph without keeping light/dark SVG pair in sync
- Hero PNG mark is for Marketplace / marketing; Activity Bar remains the document SVG until a clean monochrome SVG exists

## Social preview

GitHub repository social image: Settings → Social preview, or `docs/marketplace/social-preview.png` for designer handoff.
