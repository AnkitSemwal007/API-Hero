# Marketplace readiness review — API Hero 0.6.7

Review date: **2026-07-22** (metadata baseline); version pins refreshed for **0.6.7**. Perspective: publishing **`ankitsemwal.api-hero`** to the VS Code Marketplace **today**.

Scope of this review: **discoverability and presentation only** (metadata, README, CHANGELOG presentation, docs gaps, asset guidance). No functional claims beyond what ships in 0.6.7.

Related checklists: [marketplace-readiness.md](../release/marketplace-readiness.md) · [marketplace-assets.md](../release/marketplace-assets.md) · [banner-placeholder.md](./banner-placeholder.md)

---

## Executive verdict

**Almost publishable for a first Marketplace listing**, with honest feature copy and solid packaging metadata. The main blockers for a *polished* listing are **missing screenshots/GIFs** and **no Walkthrough contribution**. Functional smoke and packaging gates remain under [marketplace-readiness.md](../release/marketplace-readiness.md).

---

## Audit checklist

| Item | Status | Notes |
| --- | --- | --- |
| Extension display name | ✅ | `API Hero` |
| Description | ✅ (tightened) | Front-loaded REST/HTTP value; no GraphQL/OAuth claims |
| Categories | ✅ (tightened) | `Testing`, `Programming Languages` (dropped vague `Other`) |
| Keywords | ✅ (expanded) | REST/HTTP/OpenAPI/collection/git discoverability terms |
| Icon | ✅ | `images/icon.png` 128×128 |
| Gallery banner | ✅ | `#0f766e` / `dark` |
| Walkthrough | ❌ gap | Do **not** invent without honest media; see recommendations |
| Commands / titles | ✅ | Glossary consistent (Manage Authentication, etc.); Coming Soon stubs labeled |
| Activation events | ✅ | Omitted intentionally — VS Code ≥1.74 infers from `contributes` (`engines` ^1.90.0) |
| Configuration presentation | ✅ (polished) | Titles/descriptions clearer; keys unchanged |
| Menus / context titles | ✅ | Titles clear; no behavior changes |
| README | ✅ (improved) | Marketplace structure + GitHub absolute doc links (docs excluded from VSIX) |
| CHANGELOG | ✅ | Keep a Changelog; `[Unreleased]` + dated `0.6.7` |
| LICENSE | ✅ | MIT present; `package.json` `license` + README link |
| Screenshots | ❌ gap | Recommend captures; do not ship fake images |
| GIF recommendations | 📋 documented | Short run loop optional |

---

## Marketplace improvements

### Done / ready

- Extension ID, publisher, version, homepage, repository, bugs, license wired in `package.json`
- Activity Bar title **API Hero**; views **Collections** / **History** with useful `viewsWelcome`
- Stub commands (`Run File`, `Login`, `Logout`) titled **(Coming Soon)** and hidden from Command Palette (`when: false`)
- Gallery icon and teal banner color align with product chrome guidance

### Still needed before a strong listing

1. **Capture and ship screenshots** under `images/` (see below) and embed in root README
2. **Optional Walkthrough** (`contributes.walkthroughs`) only after 3–5 honest markdown steps + media exist
3. Complete quality gates in [marketplace-readiness.md](../release/marketplace-readiness.md) (`check` / `lint` / `test` / `package` + manual smoke)

### Screenshot / GIF recommendations (do not invent files)

| Asset | Capture |
| --- | --- |
| `images/screenshot-request-editor.png` | Request Editor on a `.api` file with Run visible |
| `images/screenshot-response.png` | Response Viewer with copy/save/search chrome |
| `images/screenshot-collections.png` | Collections tree (filter or run optional) |
| `images/screenshot-history.png` | History + History Detail |
| `images/screenshot-env-or-auth.png` | Environment Manager **or** Auth Manager |
| `images/screenshot-openapi-or-report.png` | OpenAPI wizard **or** Collection Run Report |
| `images/gif-run-request.gif` (optional) | Create/open → Run → Response → History (~10–15s) |

Constraints: real 0.6.7 UI only; no GraphQL/OAuth screens implying support; prefer teal/slate chrome matching `#0f766e`.

### Walkthrough guidance (documented gap)

Defer `contributes.walkthroughs` until media exists. A minimal honest walkthrough would be:

1. Create a `.api` request  
2. Run with Ctrl/Cmd+Alt+R  
3. Open Collections / History  
4. Manage Environments or Authentication  
5. Optional: Import OpenAPI  

Each step needs a short description and a real screenshot (or SVG) path under `images/`.

---

## README improvements

### Applied

- Clear hero value prop + extension ID / version / license line
- Dedicated **Install** then **Quick start**
- Feature highlights with an explicit **Not in this release** list
- Correct collection-runner enum values (`stop-on-first-error`, etc.)
- Doc deep-links use **GitHub absolute URLs** because `.vscodeignore` excludes `docs/**` from the VSIX (Marketplace README must not rely on broken relative `docs/` paths)
- Root files that ship in the VSIX (`CHANGELOG`, `LICENSE`, `SUPPORT`, …) stay relative

### Remaining

- Embed screenshots once captured
- Optionally add a one-line “What’s new in 0.6.x” that points at CHANGELOG (without duplicating release notes)

---

## Metadata improvements

### Applied in `package.json`

| Field | Change |
| --- | --- |
| `description` | Shorter, search-friendly; drops redundant “API Hero —” prefix |
| `categories` | Removed `Other` |
| `keywords` | Added `api client`, `openapi 3`, `collection runner`, `http file`, `.api`, `git` |
| Configuration `description`s | Clearer timeout/env/auth/language wording; **no key or default changes** |

### Unchanged (intentionally)

- Command IDs, view IDs, configuration keys
- `displayName`, publisher, icon path, galleryBanner color
- No `activationEvents` array (implicit activation is correct for this engine range)

---

## Documentation gaps

| Gap | Severity | Action |
| --- | --- | --- |
| No Marketplace screenshots/GIFs in repo/VSIX | High (polish) | Capture per asset table |
| No Walkthrough contribution | Medium | Add only with real media |
| `docs/**` excluded from VSIX | Medium (links) | Mitigated via GitHub absolute README links; consider shipping a thin `docs/marketplace` subset later if needed |
| Examples pack / curated sample collection | Low | Roadmap item; `examples/` exists but is not called out heavily in listing |
| Publisher Marketplace profile / Q&A | Ops | Outside repo |

User/architecture docs under `docs/user` and `docs/reference` are generally aligned for 0.6.7; keep failure-policy and Coming Soon language consistent.

---

## Files changed vs documented-only

### Changed (this presentation pass)

- `package.json` — marketplace metadata + configuration description polish
- `README.md` — Marketplace structure, accurate enums, absolute doc links
- `CHANGELOG.md` — `[Unreleased]` presentation section
- `docs/marketplace/marketplace-readiness-review.md` — this review

### Documented-only gaps (no fake assets)

- Walkthrough contribution
- Screenshot / GIF image files
- Banner marketing wide image (`docs/marketplace/marketing-api-hero.png`)

---

## Verification notes

- `package.json` must remain valid JSON with intact `contributes` (commands, menus, views, configuration)
- Presentation-only: no command enablement, menu `when`, or runtime logic changes
- Confirm icon still resolves at `images/icon.png` (128×128)
