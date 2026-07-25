# API Hero — First-Time User Audit

**Date:** 2026-07-22  
**Lens:** Install → first successful request (cold start; never used the product).  
**Mode:** Audit + lightweight recommendations. No major features. No broad UI redesign.  
**Sources:** `package.json` (`viewsWelcome`, commands, views, keybindings), Overview / Env / Auth / Request Editor empty copy, Collections create-request path, `docs/user/getting-started.md`, README Quick Start, related UX audits.

Parallel work may touch marketplace README / `package.json` metadata and production hardening — this audit prefers `docs/ux/` write-up and only tiny welcome/empty-state string tweaks.

---

### Confusion points (ordered by severity)

1. **Critical — Welcome / getting-started lead with New Request, but New Request requires a collection**  
   Collections `viewsWelcome` and `docs/user/getting-started.md` put **New Request** first. The command hard-stops with *“Create a collection under Collections/ before adding a request.”* when no destinations exist. A new user who follows the primary CTA immediately fails.  
   **Where:** `package.json` → `viewsWelcome` (`apiRunner.collections`); `register-mutation-commands.ts` (`createRequest`); getting-started “First five minutes”.

2. **Critical — Two conflicting “first five minutes” stories**  
   - **Activity Bar / getting-started:** Collections → New Request → Request Editor → Run.  
   - **README Quick Start:** manually create `hello.api` anywhere → Run (no collection required).  
   Both work, but they teach different mental models (folder-bound collections vs free `.api` files). New users who mix paths wonder why Collections is empty after running a loose file, or why New Request blocked them when README said “just create a file.”

3. **High — No guided walkthrough; Overview is opt-in and hard to discover**  
   No VS Code Walkthrough contribution. Overview only opens via **API Hero: Open Overview** (or welcome links). After install, the Activity Bar shows an empty Collections + History shell with no first-run banner, sample workspace, or “start here” panel. Cold start feels like an empty Postman with no sample collection.

4. **High — Workspace folder is mandatory and under-explained in-product**  
   Create Collection / Import OpenAPI error if no folder is open. Overview shows *“Open a workspace folder to discover collections.”* but Collections welcome does not mention it. Opening a single `.api` file without a folder workspace is a common VS Code habit and fails collection-centric flows silently until an error toast.

5. **High — Collections welcome overloads first-run with config managers**  
   Empty Collections lists New Request, New Collection, Import OpenAPI, **Manage Environments**, **Manage Authentication**, and Overview. Env/Auth are not required for a first successful GET. Six CTAs compete; managers look like prerequisites.

6. **Medium — Env / Auth feel like required setup before Run**  
   Status bar and Request Editor show **Env: None** and **Auth** chips on every new request. Correct technically (none is valid), but Postman-trained users assume they must configure both before Run. Env/Auth managers’ empty states (“No environments yet.” / “No profiles yet.”) lack a one-line “optional for first run” reassurance.

7. **Medium — History empty state points at New Request (same trap)**  
   History welcome offers **New Request** while Collections may still be empty — same dead-end as (1). History also does not explain that only *runs* appear here (not files you created).

8. **Medium — Overview empty layout is redundant and still says “Recent Requests”**  
   Empty Overview duplicates “Recent Requests” and “Recent Activity” empties. Quick action **Recent Requests** still labels what the Activity Bar calls **History** (command polish renamed focus to Open History elsewhere). Tips are good but buried under empty sections + eight quick actions.

9. **Medium — Create Collection was Explorer-like — resolved (prompt-first)**  
   ~~New Collection instantly creates `Collections/New Collection` then opens **Rename**. Cancel keeps the default name (no toast).~~ **Resolved:** New Collection is prompt-first — **Create Collection** opens with Name (required) and Description (optional); validation (empty name, invalid/reserved characters, duplicate name, path collisions) surfaces in the dialog; filesystem and project-store writes happen only after **Create**; **Cancel** leaves no temporary collection and performs no side effects. Folder layout under `Collections/` is explained in the dialog subtitle. (**Create Folder** remains allocate-then-rename; that is intentional and separate.)

10. **Medium — Docs / UI residual friction for first success**  
    - Getting-started still implied Run shortcut needs text-editor focus (Request Editor path is now first-class).  
    - Loose `.api` files may appear under a **Legacy** synthetic collection — jargon without explanation.  
    - Auth uses **profile id** vs label; `@auth` needs the id — easy to mis-attach on first try.  
    - No sample URL in New Request defaults beyond empty fields (placeholder only in Request Editor).

11. **Low — Coming Soon stubs and density**  
    Run File / Login / Logout remain in the manifest (palette-hidden). Fine for IDs; still noise if discovered via docs. Response / History Detail / Run Report panels are excellent but invisible until after first run — expected, not broken.

---

### First-run journey map (brief)

```text
Install extension
    → (optional) open folder workspace   ← often skipped; blocks collection path
    → click API Hero Activity Bar
    → Collections empty welcome
         ├─ [trap] New Request → warning: create collection first
         ├─ New Collection → Create Collection dialog (Name + optional Description; validate) → Create → Collections/<Name>/ (Cancel = no writes)
         ├─ Import OpenAPI → wizard (heavier first path)
         └─ Open Overview → hub (if discovered)
    → New Request (after collection exists) → dialog → Request Editor
    → set Method + URL → Run (toolbar / Ctrl|Cmd+Alt+R)
    → Response Viewer + History entry
    → (optional later) Manage Environments / Manage Authentication
```

**Happy path that should be taught:** Open folder → **New Collection** → **New Request** → URL → **Run**.  
**Alternate path (README):** Open folder → create `hello.api` → Run (file may land in Legacy until moved under `Collections/`).

---

### Lightweight recommendations (only)

| Priority | Change | Why | Scope |
| --- | --- | --- | --- |
| P0 | Reorder Collections welcome: **New Collection** first; clarify “collection, then request”; drop Env/Auth CTAs from welcome (keep Overview) | Fixes primary CTA trap | `viewsWelcome` strings |
| P0 | Fix getting-started “First five minutes” to Collection → Request → Run; note Request Editor Run shortcut | Docs match product | `docs/user/getting-started.md` |
| P0 | Soften createRequest warning: tell user to run **New Collection** first | Converts dead-end into next step | one toast string |
| P1 | Align README Quick Start with collection-first *or* explicitly label “fast path without Collections” | Remove dual narrative | README (coordinate with marketplace agent) |
| P1 | History welcome: remove New Request CTA; point to Focus Collections / Overview | Avoid same trap | `viewsWelcome` |
| P1 | Overview: rename quick action **Recent Requests** → **Open History**; one empty line when no history | Glossary + less noise | Overview copy |
| P2 | Env empty: “No environments yet — optional; Add when you need `{{vars}}`.” Auth: “No profiles yet — optional for public APIs.” | Reduce false prerequisites | manager empty strings |
| P2 | One-line subtitle on create collection: files live under `Collections/` | Git-first discoverability | Create Collection dialog subtitle |
| P3 | Optional later: first-install open Overview once (`globalState` flag) | Discoverability without walkthrough | tiny activation behavior — **not** for this audit’s edits |
| — | **Do not** auto-create sample collection/request on install without explicit product decision | Surprising filesystem writes | see “What NOT to build” |

---

### Optional implemented copy tweaks (if any)

Applied in this pass (safe, string-only / getting-started order):

1. **Collections `viewsWelcome`** — Collection-first wording; New Collection CTA first; Env/Auth CTAs removed; Overview kept.  
2. **History `viewsWelcome`** — Dropped New Request; Focus Collections + Overview only; clearer “after you Run” copy.  
3. **`docs/user/getting-started.md`** — First five minutes: folder → New Collection → New Request → Run; Request Editor shortcut note.  
4. **Create Request warning** — Points at **New Collection** as the next step.  
5. **Overview** — Quick action label **Open History**; slightly clearer empty history / collections lines.  
6. **Env / Auth empty hints** — Optional-for-first-run wording.

**Not changed here:** marketplace README Quick Start (coordinate with marketplace metadata work).

---

### What NOT to build for v1.0

- Full VS Code Walkthrough / multi-step coach marks / product tour overlay  
- Auto-scaffolded sample `Collections/Demo` + `hello.api` on activate (filesystem surprise)  
- Forcing Overview on every window open  
- Merging Env + Auth into the Activity Bar as permanent views  
- Postman-style cloud account / Login as onboarding  
- Redesigning Overview into a wizard or dashboard  
- Changing collection storage layout or making loose `.api` files auto-migrate into `Collections/`  
- New “default workspace template” product surface  

Ship v1.0 with clearer copy and a single taught happy path; defer guided tours and sample scaffolding to a deliberate product decision.

---

## Related

- [Consistency audit](./consistency-audit.md)  
- [v1 release readiness](./v1-release-readiness.md)  
- [Getting started](../user/getting-started.md)
