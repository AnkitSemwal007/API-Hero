# Marketplace banner & listing media

Listing media for **API Hero 2.5.0** is hosted on **Cloudinary** (see [marketplace-assets.md](../release/marketplace-assets.md)). README uses absolute CDN URLs so the VSIX does not need to ship large screenshots.

## Gallery banner color

`package.json` `galleryBanner`:

- Color: `#0f766e`
- Theme: `dark`

## CDN links (verified)

- Banner: https://res.cloudinary.com/iaojzqjd/image/upload/banner_psgrx2.png
- Social: https://res.cloudinary.com/iaojzqjd/image/upload/social-preview_jspifx.png
- Hero: https://res.cloudinary.com/iaojzqjd/image/upload/hero_iluitq.png

Optional docs-only path (often not in VSIX): `docs/marketplace/marketing-api-hero.png`.

## Screenshot map

| Role | CDN URL |
| --- | --- |
| Collections + Request Editor | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-collections-editor_idcn2j.png |
| Response Viewer | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-response_wt1caw.png |
| Execution Center | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-execution_il1wy7.png |
| Run Report | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-run-report_pxwll2.png |
| History | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-history_k4zaq3.png |
| Environments | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-environments_wfx7z1.png |
| Workflow GIF | https://res.cloudinary.com/iaojzqjd/image/upload/workflow_qsb5jj.gif |

`images/marketplace/**` is excluded from the VSIX (`.vscodeignore`) and ignored in Git (`.gitignore`). Keep extension icons (`images/icon.png`, `images/api-*.svg`, `images/execution-*.svg`) in-package.

## Related

- [Marketplace readiness review](./marketplace-readiness-review.md)
- [Marketplace assets](../release/marketplace-assets.md)
- [Marketplace readiness](../release/marketplace-readiness.md)
