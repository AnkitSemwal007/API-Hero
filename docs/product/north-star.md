# API Hero — North Star (v1.0)

**Version:** 1.2 (Final Polish)  
**Role:** The complete intended experience from install to daily use at **v1.0**.  
**Not a backlog:** For sequencing see [`roadmap.md`](./roadmap.md). For feeling see [`product-experience.md`](./product-experience.md).

v1.0 means a developer can live in API Hero visually for everyday HTTP work without redesigning the product again.

---

## One-paragraph North Star

You install API Hero, open your repo, and use **Collections** and **History** in the Activity Bar. You create folders and requests with the mouse, edit them in the **Request Editor**, pick an environment and auth profile from the toolbar or managers (panels — not more sidebar views), press Run, and read a rich **Response** panel. Everything you save is a normal `.api` file under `Collections/`. Teammates review it in Git. You almost never touch Settings JSON or the raw DSL — but both remain one command away.

---

## Ideal journey

### 1. First launch

```text
Marketplace install
  → Open folder
  → Click API Hero Activity Bar icon
  → Collections welcome (empty)
  → Optional: Walkthrough “Create your first request”
  → Create Collection “Demo”
  → New Request (webview) → opens Request Editor
  → Run (toolbar) → Response panel shows httpbin/GET
  → History shows the entry
```

**Feels:** Fast, native, zero friction ([`product-experience.md`](./product-experience.md)).  
**Screens:** S01, S02, S06, S09, S10, S32 ([`screen-list.md`](./screen-list.md)).  
**Does not:** Open text editor by default; push Login stubs; add Dashboard as a permanent view.

---

### 2. Creating collections

- Toolbar **Create Collection** → name → `Collections/<Name>/` appears.  
- Optional marker file manages order.  
- Import Collection / Import Hub for existing work.  
- Legacy `.api` files still appear, clearly labeled, with a path to migrate later.

**IA:** Only Collections + History in the sidebar ([`information-architecture.md`](./information-architecture.md)).

---

### 3. Managing requests

- **New Folder** / **New Request** from tree.  
- Drag to reorder or move.  
- Rename, duplicate, delete with confirm when destructive.  
- Single-request files open in Request Editor tabs: Request, Params, Headers, Body, Auth, Variables, Tests, Settings, Preview.  
- Multi-request files open in text (or banner → Open With Text); power users keep DSL.  
- Edits dirty the `.api` buffer; SCM shows the diff.

**Components:** RequestCard, KeyValueTable, AssertionBuilder ([`component-library.md`](./component-library.md)).

---

### 4. Running APIs

- Run from: Request Editor toolbar, editor title, CodeLens, keybinding, tree context.  
- Same orchestrator every time.  
- Progress appears immediately (<100 ms chrome).  
- Collection / folder / selection runs ask for failure policy only when set to “ask”; otherwise use setting default.  
- Run File works for multi-request documents.

**Constraints:** [`technical-constraints.md`](./technical-constraints.md).  
**Perf:** [`performance-goals.md`](./performance-goals.md).

---

### 5. Viewing responses

- Response panel beside editor: status hero, stats, Pretty/Raw, headers, assertions.  
- Copy body/headers, save body, search in body.  
- Cookies section only if jar exists; otherwise omitted (no fake UI).  
- Large payloads degrade gracefully.

**Screens:** S09. **Components:** StatusBadge, JSONViewer, ResponseTabs.

---

### 6. Managing environments

- **API Hero: Manage Environments** opens a **panel** (not Activity Bar).  
- Create `local` / `staging` / `prod` with variables; mark sensitive.  
- Set Active persists `apiRunner.activeEnvironment`.  
- Status bar chip + Request Editor picker reflect active env.  
- Restart restores the same active env.  
- Settings JSON remains a fallback, not the primary path.

**Screens:** S25, S13. **Flows:** [`user-flows.md`](./user-flows.md) § Manage environments.

---

### 7. Managing authentication

- **API Hero: Manage Auth Profiles** opens a **panel**.  
- Create bearer/basic/apiKey profiles; set secrets via password prompt → SecretStorage.  
- Request Auth tab selects profile id only.  
- Missing secret → clear CTA / Code Action — never paste into `.api`.  
- OAuth may land post-1.0 if not ready; v1.0 must not fake Login.

**Screens:** S27, S28, S14. **Gaps closed:** G05 ([`gap-analysis.md`](./gap-analysis.md)).

---

### 8. History

- History tree groups by time.  
- Open → **History Detail panel** (not a modal).  
- Re-run, reveal original, delete, search.  
- Metadata only — no body vault by default.

**Screens:** S03, S30.

---

### 9. Importing APIs

- Welcome / command → **Import Hub** panel (or focused flow).  
- OpenAPI 3.x works; Postman import available at v1.0 if Phase 5 completed — otherwise clearly “OpenAPI” only in Marketplace copy.  
- Results land under `Collections/<slug>/` as reviewable files.  
- Secret placeholders + deep link into Auth manager.

**Screens:** S18, S29.

---

## Persona day-in-the-life (v1.0)

### Backend engineer

```text
Morning: open service repo → Collections → staging env chip → run smoke folder
Fix: edit Headers/Body in Request Editor → Run → copy JSON into ticket
Afternoon: OpenAPI import for new service → PR the Collections/ tree
```

### Full-stack developer

```text
Build UI against staging → switch env to local → Auth profile for bearer
Inspect Response Pretty → tweak expect lines in Tests tab → commit .api
```

### QA / API tester

```text
Run Collection Tests → Collection Run Report → fail filter → open failing request
Assert status + body path → re-run → green → merge
```

---

## Daily driver loop (after onboarding)

```text
Focus Collections
  → Open request (Request Editor)
  → Glance status bar env chip (switch if needed)
  → Edit headers/body/tests visually
  → Run
  → Read Response / copy JSON
  → Commit .api changes
  → Optionally check History for yesterday’s failure
```

Time-to-run for an existing request: **≤ 2 interactions** (open + run) or **1 shortcut**.

---

## What v1.0 explicitly includes

| Area | v1.0 bar |
| --- | --- |
| Activity Bar | Collections + History only |
| Request Editor | Default for single-request files |
| Env / Auth | Panel managers + persisted active env |
| Response | Copy / save / search |
| History | Detail panel |
| Import | OpenAPI; Postman if Phase 5 done |
| Stubs | No Coming Soon in palette |
| Perf | Phase 1–4 budgets met |
| Marketplace | Screenshots + honest README |

---

## What v1.0 can defer

- OAuth2 / Login-Logout (Phase 9) unless pulled earlier  
- GraphQL / WS / gRPC  
- Cloud sync  
- CLI (Phase 10)  
- Dashboard as permanent view (Overview is command-opened only)  
- Multi-request visual editor with surgical rewrite (high risk)  

---

## Success metrics for North Star

| Metric | Target |
| --- | --- |
| First 200 without editing text | ≥ 80% of new-user test sessions |
| Env switch persists across reload | 100% |
| Secret never appears in webview protocol fixtures | 100% |
| Marketplace listing completeness | Gate checklist green |
| Activity Bar view count | Exactly 2 product views |
| Open + Run existing request | ≤ 2 clicks or 1 shortcut |

---

## P0 acceptance journeys (v1.0 gate)

These must pass on a clean VS Code with the demo workspace:

1. Empty → Create Collection → New Request → Request Editor → Run → Response shows status  
2. Switch Environment → reload window → same env still active  
3. Create Auth profile → Set Secret → request with `@auth` succeeds without secret in file  
4. History open → Detail **panel** → Re-run  
5. Response → Copy body works  
6. Activity Bar still shows only Collections + History  

---

## Traceability

| Journey step | Screens | Roadmap phases | Gaps |
| --- | --- | --- | --- |
| First launch | S02, S10, S06, S09 | 1, 5 | G01, G21, G22 |
| Collections CRUD | S01 | — (done) | G09 |
| Edit/run | S06, S08, S09 | 1, 6 | G07, G11, G18 |
| Environments | S25, S13 | 2 | G02, G04 |
| Auth | S27, S28 | 3 | G03, G05 |
| History | S03, S30 | 4 | G06 |
| Import | S18, S29 | 5 | G15 |

---

## Related documents

- [`vision.md`](./vision.md)  
- [`product-experience.md`](./product-experience.md)  
- [`information-architecture.md`](./information-architecture.md)  
- [`roadmap.md`](./roadmap.md)  
- [`marketplace-strategy.md`](./marketplace-strategy.md)  
- [`user-flows.md`](./user-flows.md)  
- [`performance-goals.md`](./performance-goals.md)  
