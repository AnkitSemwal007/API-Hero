# Marketplace assets — 2.9.0

Guidance for listing media for **API Hero 2.9.0**.

**Strategy:** README screenshots, banner, social preview, and workflow GIFs are hosted on **Cloudinary** (absolute HTTPS URLs). That keeps the VSIX small. Only in-extension chrome icons ship inside the package (`images/icon.png`, `images/api-*.svg`, `images/execution-*.svg`).

`images/marketplace/**` is listed in `.vscodeignore` and `.gitignore`. Do not commit listing media into the repo; upload to Cloudinary and reference CDN URLs.

Local MCP GIF source can be regenerated with `python scripts/generate-mcp-gif.py` (PIL; Windows Segoe/Consolas fonts by default), then re-uploaded to Cloudinary as `api-hero-mcp_hrx7xa`.

## Icon (ships in VSIX)

| Requirement | Status |
| --- | --- |
| `package.json` `icon` | `images/icon.png` (128×128 PNG) |
| Activity Bar / language glyphs | `images/api-light.svg`, `images/api-dark.svg` |
| Execution view glyphs | `images/execution-light.svg`, `images/execution-dark.svg` |

## Screenshots / GIFs (Cloudinary CDN)

Prefer teal/slate product chrome consistent with gallery banner `#0f766e`. Avoid purple gradient clichés.

Cloud: `iaojzqjd` · Folder: `api-hero` · Base: `https://res.cloudinary.com/iaojzqjd/image/upload/`

**12/12** delivery URLs verified (public IDs; no folder prefix required in the delivery path):

| Role | Cloudinary public ID | CDN URL |
| --- | --- | --- |
| Hero | `hero_iluitq` | https://res.cloudinary.com/iaojzqjd/image/upload/hero_iluitq.png |
| Banner | `banner_psgrx2` | https://res.cloudinary.com/iaojzqjd/image/upload/banner_psgrx2.png |
| Social preview | `social-preview_jspifx` | https://res.cloudinary.com/iaojzqjd/image/upload/social-preview_jspifx.png |
| Response Viewer | `screenshot-response_wt1caw` | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-response_wt1caw.png |
| History | `screenshot-history_k4zaq3` | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-history_k4zaq3.png |
| Execution Center | `screenshot-execution_il1wy7` | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-execution_il1wy7.png |
| Environments | `screenshot-environments_wfx7z1` | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-environments_wfx7z1.png |
| Run Report | `screenshot-run-report_pxwll2` | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-run-report_pxwll2.png |
| Collections + Editor | `screenshot-collections-editor_idcn2j` | https://res.cloudinary.com/iaojzqjd/image/upload/screenshot-collections-editor_idcn2j.png |
| Workflow GIF | `workflow_qsb5jj` | https://res.cloudinary.com/iaojzqjd/image/upload/workflow_qsb5jj.gif |
| Workflow hero | `workflow-hero_jfl821` | https://res.cloudinary.com/iaojzqjd/image/upload/workflow-hero_jfl821.png |
| MCP workflow GIF | `api-hero-mcp_hrx7xa` | https://res.cloudinary.com/iaojzqjd/image/upload/v1786432275/api-hero-mcp_hrx7xa.gif |

**Name corrections (easy to misread in the UI font):**

- `screenshot-response_**wt**1caw` (not `wf`)
- `screenshot-execution_**il**1wy7` (not `i1`)
- `workflow-hero_jf**l**821` (letter **l**, not **i**)

Root `README.md` embeds these CDN URLs beside the sections they describe (hero first; screenshots not stacked in one gallery). Use the same links for Marketplace portal media / GitHub social cards.

**Follow-up:** capture and host **Auth Manager** and **Scenario Editor** screenshots when ready. Existing screenshots remain valid for Collections, Response, History, Execution, Environments, Run Report, and MCP. Prefer a refreshed Run Report shot when compact summary/filters ship in listing media.

## Banner

See [banner-placeholder.md](../marketplace/banner-placeholder.md). Gallery banner color remains `#0f766e` in `package.json`. Wide promo / social art: Cloudinary `banner_psgrx2` / `social-preview_jspifx` above.

## Checklist

- [x] Screenshots reflect **2.3.3+** product UI (Execution view, Dependencies, Run Report Debugger, Env Manager)
- [ ] Auth Manager screenshot (recommended for listing; text coverage in README)
- [ ] Scenarios / Scenario Editor screenshot (recommended for listing; text coverage in README)
- [ ] Optional: refreshed Collection Run Report screenshot (compact summary / filters)
- [x] No GraphQL / OAuth screenshots implying support
- [x] Icon and banner contrast well in Marketplace dark/light cards
- [x] README listing media uses Cloudinary HTTPS URLs (VSIX stays lean)
- [x] `images/marketplace/**` excluded via `.vscodeignore` and `.gitignore`
- [x] Cloudinary `api-hero` folder hosts listing media (**12/12** delivery URLs verified, including MCP GIF)

## Related

- [Marketplace readiness review](../marketplace/marketplace-readiness-review.md)
- [Marketplace readiness](./marketplace-readiness.md)
- [Product README](../product/README.md)
- [Release notes — 2.9.0](./v2.9.0-release-notes.md)
- [Changelog — 2.9.0](../../CHANGELOG.md)
