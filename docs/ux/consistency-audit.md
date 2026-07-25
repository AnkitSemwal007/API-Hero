# API Hero — Product-Wide UX Consistency Audit

**Date:** 2026-07-22  
**Scope:** Product UX consistency only (no code-quality / architecture purity review).  
**Mode:** Audit + incremental recommendations. No redesign. No implementation in this pass.

**RC1:** Criticals below are **Resolved**; see [v1-release-readiness.md](./v1-release-readiness.md) / [v1-production-hardening-audit.md](./v1-production-hardening-audit.md). Remaining open work is High/Medium/Low only.

Parallel work may already cover: InputBox→inline CRUD, Environment Manager IA, Collections Explorer UX, Variable IntelliSense, Variable scope discoverability, workspace export design. Findings that clearly match those efforts are tagged **Already in progress (likely)**.

---

## Methodology

Inspected:

- `package.json` contributes: commands, menus (`commandPalette`, `editor/title`, `editor/context`, `view/title`, `view/item/context`), views, `viewsWelcome`, keybindings, custom editors
- Webview HTML/CSS/JS builders: Request Editor, Environment Manager, Auth Manager, Overview, Response Viewer, History Detail, Collection Run Report, OpenAPI Import Wizard, New Request / CRUD Prompt / Destination Picker dialogs
- Tree providers & registration: Collections, History
- Command handlers using `showInputBox` / `showQuickPick` / `showWarningMessage` / `showOpenDialog` / `showSaveDialog`
- Status bar presenters (environment, request execution, collection run)
- Language UX: CodeLens, completion/hover variable scope labels
- User docs terminology (`docs/user/*`) vs on-screen copy

---

## Consistency principles (target patterns)

Lightweight targets — align surfaces to these; do not invent a new product IA.

1. **UI-first for named product flows; native VS Code only for OS/file system and secrets**
   - Prefer API Hero webview dialogs/panels for create/rename/move/filter when a pattern already exists.
   - Keep native dialogs for: folder/file pickers, Secret Storage password prompts, destructive confirmations (modal `showWarningMessage` is fine and already dominant).

2. **One primary surface per job**
   - Collections tree = browse/CRUD requests.
   - Managers (Env / Auth) = edit configuration.
   - QuickPick = fast *select active* (environment / session auth), with a trailing “Manage…” escape hatch.
   - Overview = orientation + shortcuts, not a second CRUD home.

3. **Shared chrome vocabulary**
   - Buttons: `primary` (commit/run), `secondary` (add row / secondary commit), `ghost` (navigate/manage), `chip` (compact session shortcuts), `danger` (destructive).
   - Empty states: short bold lead + one clause guidance + optional CTA.
   - Search/filter: inline search field when the list is already on screen; command-driven filter only when the list is a TreeView without a webview chrome.

4. **Stable terminology glossary**

   | Concept | Preferred user-facing term |
   | --- | --- |
   | `.api` file request identity | **Request** |
   | `@variable` / `@sensitive-variable` in file | **Request variables** (product glossary; internal `scope: 'document'` unchanged) |
   | Named env set | **Environment** |
   | Non-env shared vars | **Workspace variables** / **Global variables** (under **Scopes**) |
   | Auth config entity | **Auth profile** |
   | Open manager | **Manage Authentication** / **Manage Environments** |
   | Session override | **Session default authentication** |
   | History view | **History** (not “Recent Requests” except as Overview section title for the last N entries) |

5. **Destructive actions always confirm** (modal), including History tree delete — same as Collections and History Detail.

6. **Default editor path is first-class**
   - Anything advertised for “editing a request” must work in the Request Editor (Run affordance, shortcuts, reveal), not only the text editor.

---

## Critical UX Issues

> All four Critical items are **Resolved** (RC1). Historical context kept below for traceability.

### 1. Run / Reveal affordances favor Text Editor while Request Editor is the default — **Resolved**

- **Where (historical):** Custom editor is `priority: default` for `*.api`; keybinding `apiRunner.runRequest` required `editorLangId == api && editorTextFocus`; CodeLens only on text documents; `Reveal Active Request` used `activeTextEditor`.
- **Resolution:** Active Request Editor document tracker; Run keybinding/`when` includes `activeCustomEditorId == 'apiRunner.requestEditor'`; webview Ctrl/Cmd+Alt+R; Reveal uses the same tracker (first-request fallback). CodeLens remains text-only; toolbar Run is first-class.

### 2. History delete confirmation is split by entry point — **Resolved**

- **Where (historical):** History tree / command `apiRunner.deleteHistoryEntry` deleted immediately; History Detail used modal `showWarningMessage`; Clear History always confirmed.
- **Resolution:** Tree/palette delete uses the same modal confirm as Detail (`Delete this history entry?` / `Delete`). Clear History remains bulk confirm.

### 3. Auth naming and “session vs request” auth are hard to reconcile — **Resolved**

- **Where (historical):** Command **Manage Authentication** vs panel titled **Auth Profiles Manager** / H1 **Auth Profiles**; OpenAPI CTA **Manage Auth Profiles**.
- **Resolution:** Panel title **Manage Authentication**, H1 **Authentication**, OpenAPI hint/CTA aligned to **Manage Authentication**. Command IDs unchanged. Remaining nuance: Request Editor “Session default” vs request-local Auth tab labels (deferred; not Critical).

### 4. Variable scope labels disagree across IntelliSense, Manager, and Request Editor — **Resolved**

- **Where (historical):** Completion used **Request**, Request Editor empty state said **document variables**, some docs said **Document**; Environment Manager **Scopes** = Workspace / Global only.
- **Resolution:** Product glossary for document-scoped `@variable` / `@sensitive-variable` is **Request** (`VARIABLE_SCOPE_UI.document.sourceLabel`). Shared `VARIABLE_SCOPE_UI` + `VARIABLE_PRECEDENCE_LEGEND` align Env Manager, Request Editor, and IntelliSense/hover. Env Manager **Scopes** stay workspace/global only; Request variables on the Request Editor Variables tab. Internal `scope: 'document'` unchanged.

---

## High

### 5. Search / filter UX is three different products

- **Where:** Collections → `showInputBox` (“Filter Collections”); History → multi-step QuickPick (status → method → text); Env / Auth managers → inline `<input type="search">`; Response body → inline search.
- **Resolution (v1 polish):** Icons/titles aligned (`$(filter)`, **Filter Collections** / **Filter History**); InputBox copy aligned (title/prompt/placeHolder). History keeps status → method → text facets (not redesigned into Collections’ model). Manager/response inline search unchanged.

### 6. Collections view title is an IA dumping ground

- **Where (historical):** `view/title` mixed create, import, config managers, settings, history, and Overview.
- **Resolution (v1 polish):** Navigation group keeps New Request / New Collection / Filter / Refresh. Overflow keeps New Folder / Import Collection / Import OpenAPI / Reveal Active Request. Manage Environments, Manage Authentication, Settings, Open History, and Overview removed from Collections `view/title` (commands remain via palette/Overview).

### 7. “Recent Requests” is a History alias that reads like a third view

- **Where:** Command title **Recent Requests**; Overview section + quick action; Collections toolbar; implementation focuses History view.
- **Why inconsistent:** Users look for a “Recent Requests” view that does not exist; Activity Bar only has Collections + History.
- **Recommendation:** Rename command/toolbar entry to **Focus History** (or **Open History**); keep Overview section heading **Recent Requests** for the last-N list only.

### 8. Switch Environment vs Select Authentication asymmetry

- **Where:** Env QuickPick includes **Manage Environments…**; Auth QuickPick does not include Manage; Request Editor Env/Auth chips both open select QuickPicks, while Auth tab also has Manage + Session default.
- **Why inconsistent:** Parallel session-switch jobs; only Env offers escape hatch to the manager from the picker.
- **Recommendation:** Add **Manage Authentication…** item to the auth QuickPick (mirror Env). Keep chips as “switch session” shortcuts; ensure Auth tab remains the place for request-local profile.

### 9. CRUD success feedback is uneven

- **Where (historical):** Import/export used `showInformationMessage`; other mutations were silent.
  - **Resolution (v1 polish):** One pattern — `window.setStatusBarMessage('API Hero: …', 3000)` for successful CRUD (collections mutations, environments save/active, authentication save). Errors/confirms stay modal. Create Collection **Cancel** performs no side effects (no filesystem write, no project-store write, no temporary collection, no tree refresh) and no success toast.

### 10. Partial migration: inline CRUD dialogs vs remaining native prompts

- **Where:** Patterns differ by action — do not treat create collection and create folder as one flow:
  - **Create Collection** — prompt-first `openCrudPromptDialog` (name + optional description); validation before the collection is kept; Cancel = no side effects (see §9).
  - **Create Folder** — allocate-then-rename / Explorer-like (allocate on disk, then rename dialog; Cancel keeps the default-named folder); distinct from Create Collection.
  - Collection/folder/request **rename** uses `openCrudPromptDialog` after the item exists.
  - New Request / Move use dedicated webviews; Collections **filter** still `showInputBox`; auth secrets still password `InputBox` (correct); OpenAPI file/folder picks still native (correct); export/import collection still `showOpenDialog`.
- **Already in progress (likely):** InputBox→inline CRUD; workspace export design.
- **Recommendation:** Finish filter alignment (High #5). Do not move secret entry or OS folder picks into webviews. For export/import, keep native folder pickers unless the workspace-export project replaces them with a designed flow — then use that flow everywhere export appears.

---

## Medium

### 11. Empty-state voice and CTAs differ by surface

- **Where:** Collections welcome (multi-CTA including Manage Env/Auth/Overview); History welcome; Overview empty copy; Request Editor compact empty rows; Env “No environments yet” / “No matching environments”; Auth profile list.
- **Why inconsistent:** Welcome views are onboarding hubs; in-editor empties are terse; Overview mixes both. Collections welcome overloads first-run with config managers.
- **Recommendation:** Collections welcome: keep create/import CTAs only; link managers from Overview. Align empty lead style: **Bold fact** — one guidance clause.

### 12. Request Editor Auth / Env entry points are redundant and differently labeled

- **Where:** Toolbar chips **Env** / **Auth**; Auth tab Manage + Session default; Variables tab Manage Environments.
- **Why inconsistent:** Three ways to touch auth/env with different labels (chip title “Switch Environment” vs “Manage Environments”).
- **Recommendation:** Keep chips = switch session; keep tab buttons = manage / request binding. Align chip `title`/`aria-label` with command titles exactly (`Switch Environment`, `Select Authentication Profile`).

### 13. Status bar presents three competing left-aligned stories

- **Where:** Execution status (prio 100), collection run (99), environment (98). Env always visible; others ephemeral.
- **Why inconsistent:** During a collection run, multiple “API Hero: …” items compete; Env click opens Switch, but execution items are non-clickable.
- **Recommendation:** Keep Env persistent. Ensure only one run presenter is visible at a time (request vs collection). Optional: clicking success status focuses Response / Run Report panel.

### 14. Confirmation copy for deletes is file-centric vs name-centric

- **Where:** Delete request: `Delete request file "Foo.api"?`; delete collection/folder: human label; history detail: generic “this history entry”.
- **Why inconsistent:** Request delete emphasizes filesystem; others emphasize product names.
- **Recommendation:** Prefer display name: `Delete request "Foo"?` with filename in detail if needed.

### 15. Overview quick actions vs Activity Bar dual home

- **Where:** Overview duplicates New Request, collections focus, managers, settings, Recent Requests.
- **Why inconsistent:** Fine as a hub, but combined with Collections toolbar overload (#6) it feels like two competing shells.
- **Recommendation:** After thinning Collections title (#6), keep Overview as the onboarding hub; ensure button labels match command titles 1:1.

### 16. OpenAPI wizard vs managers terminology

- **Where (historical):** Wizard summary **Manage Auth Profiles**; elsewhere **Manage Authentication**.
- **Resolution (v1 polish):** Wizard CTA and hint use **Manage Authentication** (aligned with #3).

### 17. Language / IntelliSense vs form editor variable UX

- **Where:** Text editor: completion + hover + diagnostics; Request Editor: `data-var-complete` fields, Insert column on Variables tab, resolution preview — not the same presentation as VS Code suggest widget.
- **Already in progress (likely):** Variable IntelliSense.
- **Recommendation:** Keep webview completion lighter, but reuse the same scope labels/icons/order as `VariableCompletionService` so switching Open Text ↔ Request Editor does not relabel scopes.

---

## Low

### 18. Message prefix and modality mix

- **Where:** Many errors/toasts use `API Hero:` prefix; History select-hints and some runner messages do not; copy-success uses `setStatusBarMessage` instead of a toast.
- **Recommendation:** Prefix user-visible extension toasts with `API Hero:`; keep status-bar flash for clipboard copy (good pattern) everywhere copy succeeds.

### 19. Filter icon mismatch

- **Where:** Collections filter icon `$(search)`; History `$(filter)`.
- **Recommendation:** Both `$(filter)` (or both search) — prefer filter to match command titles.

### 20. “Open Text” control label vs tooltip

- **Where:** Button text **Open Text**; `title` **Open With Text Editor**.
- **Recommendation:** Button **Open Text Editor** to match VS Code “Open With…” mental model.

### 21. Coming Soon commands still contributed

- **Where:** Run File / Login / Logout hidden from palette (`when: false`) but still in manifest; stubs show info toast if invoked.
- **Recommendation:** Acceptable for stable IDs; ensure no UI button still points at them (spot-check menus — currently palette-hidden only).

### 22. Tab label casing is mechanical

- **Where:** Request Editor tabs capitalize id (`Params`, `Auth`) — fine; Response uses `Body` / `Headers (N)` — fine. Minor: Auth tab vs chip “Auth” vs “Authentication profile”.
- **Recommendation:** No change required beyond glossary alignment on the Auth tab label if desired (`Auth` tab → keep; field label → **Auth profile**).

---

## Suggested priority order

1. ~~**Critical #1–#4**~~ — **Resolved** (Run/Reveal tracker+keybinding; History delete modal; Manage Authentication; Request scope labels).
2. **High #7 + #8** — Recent Requests rename; Auth QuickPick Manage… item (may already be fixed — verify against release readiness).
3. **High #5 + #19** — Unify Collections/History filter interaction + icons (partially resolved in v1 polish).
4. **High #6 + #15** — Thin Collections `view/title`; leave Overview as hub (partially resolved).
5. **High #9** — CRUD success feedback rule (resolved in v1 polish).
6. **High #10 / parallel tracks** — Finish inline CRUD leftovers; Env Manager scope hints; export design when ready.
7. **Medium #11–#14, #16–#17** — Empty states, chips, status bar, delete copy, IntelliSense label sync.
8. **Low** — Prefix/icon/Open Text polish.

---

## Already in progress (likely) — crosswalk

| Parallel effort | Audit findings |
| --- | --- |
| InputBox→inline CRUD | Mostly landed for collection/folder/request name prompts + New Request + Move; filter InputBox and OS pickers remain (#5, #10). |
| Environment Manager IA | Scopes section present; glossary linked to **Request** vars (#4 resolved). |
| Collections Explorer UX | Toolbar overload + filter InputBox (#5, #6) — partially resolved in v1 polish. |
| Variable IntelliSense | Scope label **Request** (#4 resolved; #17 presentation parity still open). |
| Variable scope discoverability | #4 resolved; Env Manager hints help. |
| Workspace export design | Collection export still native folder picker (#10) — replace only when design lands. |

---

## Overall

API Hero already has a coherent UI-first spine (Request Editor, managers, Overview, webview dialogs, shared webview CSS). **Critical** gaps (Run/Reveal for Request Editor, History delete confirm, Auth naming, Request variable glossary) are **Resolved**. Remaining consistency work is mostly High/Medium: **Recent Requests** naming, Auth QuickPick Manage… parity, filter dialects leftovers, empty-state / chip polish. Fixes should stay incremental string/menu/handler alignments — not a redesign.
