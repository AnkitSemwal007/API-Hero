# API Hero — Current UI / UX Inventory

**Purpose:** Complete documentation of the extension’s present UI and interaction model for an external UX review.  
**Scope:** Inspect and document only. No redesign proposals beyond identifying current problems.  
**Source of truth:** Code and `package.json` contributions as of this inventory.  
**Screenshots:** Not captured in this pass (requires Extension Development Host). Diagrams below replace screenshots.

---

## 1. Extension Overview

### Overall architecture (UI-relevant)

API Hero is a VS Code extension (`ankitsemwal.api-hero`) whose product UI sits on three pillars:

1. **Activity Bar sidebar** — Collections + History tree views  
2. **Editors** — TextMate `.api` text editor + optional Custom Text Editor (`apiRunner.requestEditor`)  
3. **Transient surfaces** — Response webview panel, New Request webview, QuickPicks, InputBoxes, notifications, progress, status bar

Core business logic (parser, execution, auth, variables, assertions) is framework-free; VS Code adapters live under `**/vscode/` folders.

```text
Activity Bar (apiRunner)
  ├─ Collections tree ──► Mutation / Navigation / New Request dialog
  └─ History tree     ──► Rerun / Reveal / Detail modal
Editors
  ├─ Text (.api)      ──► Language features + CodeLens Run
  └─ Custom Request Editor ──► Form ↔ .api sync
Execution
  └─ Orchestrator ──► Progress + Status Bar + Response Panel + History record
```

### Extension entry points

| Entry | Mechanism |
| --- | --- |
| Activation | `src/extension.ts` `activate()` — eager composition (collections, history, language, auth, variables, OpenAPI, request editor, runner) |
| Commands | 43 contributed commands (`apiRunner.*`) |
| Views | `apiRunner.collections`, `apiRunner.history` |
| Custom editor | `apiRunner.requestEditor` for `*.api` (priority `option`) |
| Language | `api` / `.api` |
| Keybinding | `Ctrl+Alt+R` / `Cmd+Alt+R` → Run Request when `editorLangId == api` |

### UI technologies used

| Technology | Usage |
| --- | --- |
| TreeView | Collections, History |
| WebviewPanel | Response viewer (`apiRunner.response`), New Request dialog (`apiRunner.newRequest`) |
| CustomTextEditor | Request form editor |
| ThemeIcon | All tree icons |
| QuickPick / InputBox / OpenDialog / WorkspaceFolderPick | Auth, env, CRUD names, moves, import/export |
| Notifications + `withProgress` | Runs, import, mutations |
| StatusBarItem | Transient run / collection-run status |
| TextMate + language providers | `.api` editing |
| Settings (`contributes.configuration`) | Variables, auth profiles, timeouts, language toggles |

### How surfaces connect

- **Create/organize** → Collections tree / welcome / mutation commands → filesystem under `Collections/` → discovery refresh → tree update  
- **Open request** → tree click → Custom Editor (single-request file) or text editor (multi-request)  
- **Edit** → form or text → `.api` buffer is source of truth  
- **Run** → command / CodeLens / tree Run / history rerun → orchestrator → response panel + history + optional assertion Problems  
- **Auth / env** → QuickPicks (session) + Settings (persistence) + `@auth` / `{{vars}}` in files  

---

## 2. Activity Bar

| Property | Value |
| --- | --- |
| Container id | `apiRunner` |
| Title | API Hero |
| Icon | `images/api-dark.svg` |
| Location | Activity Bar |

### Views inside container

1. **Collections** (`apiRunner.collections`) — primary organization + run entry  
2. **History** (`apiRunner.history`) — past executions  

Reserved in code only (not contributed): `apiRunner.explorer`.

### Layout / navigation

```text
[API Hero icon]
  Collections   ← icons: New Request, New Collection, Import OpenAPI
                ← overflow: Env, Auth, Settings, Recent Requests, Overview, Import Collection, Filter, Refresh, Reveal
  History       ← icons: Filter, Refresh; overflow: Clear, Focus Collections, Overview
```

Users switch views via the sidebar section headers inside the API Hero container. `focusCollections` / `focusHistory` / `recentRequests` commands focus those views.

---

## 3. Sidebar Tree Views

### 3.1 Collections (`apiRunner.collections`)

| Aspect | Detail |
| --- | --- |
| Purpose | Discover and manage API collections, folders, requests; open and run |
| Provider | `CollectionTreeDataProvider` |
| Options | `showCollapseAll: true`, `canSelectMany: true`, drag & drop enabled |
| Population | `CollectionDiscoveryService` snapshot (not live FS walk on expand) |

#### Hierarchy

```text
Collection (root)          // native Collections/<Name>/ and/or Legacy
  ├─ Folder…
  │    ├─ Folder…          // unlimited nesting
  │    └─ Request…         // one parsed request node per request in .api
  └─ Request…              // at collection root
```

Workspace nodes exist in the model but are **not** shown as tree roots.

#### Node types / icons / contextValues

| Kind | Icon | contextValue (native / legacy) |
| --- | --- | --- |
| collection | `library` | `collection` / `collectionLegacy` |
| folder | `folder` | `folder` / `folderLegacy` |
| request | `symbol-method` | `request` / `requestLegacy` |

#### Labels

- Collection: name; description = request count (+ workspace name if multi-root)  
- Folder: name; description = relative path  
- Request: `@name` or summary; description = `METHOD url`

#### Drag & drop

MIME: `application/vnd.code.tree.apiRunner.collections`

| Drag | Drop | Result |
| --- | --- | --- |
| Native collection | Another native collection (same workspace) | Reorder via marker `order` |
| Native folder | Same parent | Reorder `folderOrder` |
| Native folder | Other native collection/folder | Move folder |
| Request | Same folder | Reorder `requestOrder` |
| Request | Other native collection/folder | Move file |
| Legacy collection/folder | — | No-op |
| Request onto Legacy | — | No-op |

#### Keyboard / click

- Click request → `openCollectionRequest`  
- Collapse/expand folders (standard TreeView)  
- Multi-select supported for run-selected  

#### How populated

1. Scan workspace folders  
2. Each `Collections/<Name>/` → native collection (optional `api-hero.collection.json`)  
3. `.api` outside those roots → one **Legacy** collection per workspace (if any)  
4. Parse `.api` via cache → request nodes  
5. Apply marker order maps; fallback locale sort  

Refresh on: workspace change, `.api`/marker create/delete/rename/save, explicit Refresh.

---

### 3.2 History (`apiRunner.history`)

| Aspect | Detail |
| --- | --- |
| Purpose | Browse past runs; reopen details; rerun; reveal source |
| Provider | `HistoryTreeDataProvider` |
| Options | `showCollapseAll: true`; no DnD; no multi-select |
| Storage | Global storage `request-history.json` (metadata only) |

#### Hierarchy

```text
Group: Today | Yesterday | Last 7 Days | Older
  └─ Entry…
```

Empty time groups omitted. Groups have `contextValue: historyGroup` (no menus).

#### Entry display

| Field | Content |
| --- | --- |
| label | requestName or `METHOD shortUrl` |
| description | `status · duration · time` |
| icon | `pass` / `error` / `circle-slash` (cancelled) |
| click | `openHistoryEntry` (information modal) |

#### Search / filter / grouping

- Always time-grouped  
- Search = InputBox free-text filter over method, URL, status, names, env, collection, error  
- No UI for status/method facet filters (API supports them; UI does not expose)

---

## 4. Collections UI — Capabilities Matrix

| Action | Collection | Folder | Request |
| --- | --- | --- | --- |
| Create | Yes (InputBox) | Yes (InputBox) | Yes (webview dialog; InputBox fallback) |
| Rename | Yes (native) | Yes (native) | Yes (native) |
| Delete | Yes (native, confirm) | Yes (native, confirm) | Yes (native + Legacy) |
| Duplicate | Yes (native) | Yes (native) | Yes (native) |
| Drag move | Reorder only | Move + reorder | Move + reorder |
| Export | Yes (folder copy) | — | — |
| Import | Yes (folder → Collections/) | — | — |
| Run | Yes | Yes | Yes (selected) |
| Open / Edit | — | — | Open editor |

### Limitations

- **Legacy** collection: organize/run/open/delete request/move-into-native only; no create/rename/duplicate collection or folders; no DnD reorder of Legacy roots  
- Mutations that create content always target **native** `Collections/`  
- After create/rename/duplicate via mutation commands, files often open as **text**, not Custom Editor (tree Open uses Custom Editor for single-request files)  
- No collection description editor UI beyond marker JSON on disk  
- No tags/favorites UI (`ExtensionBag` reserved unused)  
- Multi-request `.api` files appear as multiple request nodes under the same folder; form editor disabled for those files  

---

## 5. History UI

| Element | Behavior |
| --- | --- |
| History page | Tree view under Activity Bar |
| History item | One past execution summary |
| Context menu | Open, Re-run, Reveal Original, Delete |
| Inline icons | Re-run, Reveal, Delete |
| Search | View title → InputBox filter |
| Filtering | Text only |
| Grouping | Fixed time buckets |
| Clear | View title → confirm modal |
| Refresh | View title / welcome |
| Detail view | `showInformationMessage` modal (not a panel) |

No history webview, no charts, no body replay storage.

---

## 6. Request Editing

### 6.1 Create paths

1. **New Request** (toolbar / context / welcome) → webview form (name, method, URL, description, collection, folder) → writes one `.api` under `Collections/...` → opens as **text**  
2. Fallback InputBox name-only if webview fails  
3. OpenAPI import → many `.api` files under `Collections/<slug>/`  
4. Manual / Explorer create of `.api` files (still discovered; Legacy if outside Collections/)

### 6.2 Edit paths

| Path | When |
| --- | --- |
| Custom Text Editor | Tree Open on file with exactly one request; or Command Palette “Open Request Editor”; or Open With… |
| Text editor | Default for `*.api` (custom editor priority `option`); multi-request files; power users |

### 6.3 `.api` language experience

| Feature | Present? | Notes |
| --- | --- | --- |
| Syntax highlighting | Yes | `syntaxes/api.tmLanguage.json` |
| Language config | Yes | comments, brackets, folding markers `###` |
| Completions | Yes | methods, directives, headers, MIME, variables (`@`, `{`, `:`) |
| Hover | Yes | toggle setting |
| Diagnostics | Yes | parser, variables, auth; toggle setting |
| Outline | Yes | per-request symbols; toggle setting |
| CodeLens | Yes | Run Request; Run Tests if expects present |
| Folding | Yes | requests, directives, JSON + markers |
| Snippets | Yes | get, post, bearer, json, multipart, basic, apikey, env, separator, connection, timeout |
| Code Actions | **No** | |

### 6.4 Custom Request Editor

**Top bar:** Method · URL · Environment · Authentication · Run  

**Tabs:** Request | Headers | Params | Body | Auth | Variables | Tests | Settings | Preview  

- Sync: form ↔ document (debounced); `.api` canonical  
- Multi-request: banner only; no form rewrite; offer Open With Text  
- Auth: profile id only (secrets not in webview); Manage Authentication on Auth tab  
- Variables tab: Manage Environments opens the Env Manager panel  
- Host handles `manageEnvironments` / `manageAuthProfiles` / `switchEnvironment` / `selectAuthentication` via existing commands (`request-editor-provider.ts`)  
- Sensitive variables masked in UI  
- Settings tab: `@timeout` only  
- Run uses the same orchestrator as CodeLens / editor title  

---

## 7. Response Viewer

| Property | Value |
| --- | --- |
| Type | Webview panel `apiRunner.response` |
| Opened | After single-request run (beside editor); collection runs suppress per-request viewer |
| Layout | Single scrolling page (not VS Code editor tabs) |

### Sections

1. Hero — status + method/URL summary  
2. Stats grid — duration, sizes, content-type, encoding, header count, final URL, timestamps  
3. Body — Pretty / Raw; JSON tree expand/collapse; highlight json/html/xml  
4. Headers — collapsible details  
5. Cookies — placeholder (“not enabled”); Set-Cookie masked  
6. Assertions — collapsible when present  
7. Failure card on errors  

### Present vs absent

| Feature | Status |
| --- | --- |
| Pretty / Raw | Yes |
| Timings (duration) | Yes (not waterfall) |
| Assertions | Yes |
| Copy | **No** |
| Save / download | **No** |
| Search in body | **No** |
| Cookie jar UI | Placeholder only |

CSP: strict nonce, `default-src 'none'`, host accepts only `{type:'ready'}`.

---

## 8. Authentication UI

| Surface | What it does |
| --- | --- |
| QuickPick `selectAuthentication` | Session default profile (None + profiles); does **not** write settings; overridden by `@auth` |
| Settings `apiRunner.authentication.profiles` | Persist profile metadata (provider, field sources) |
| SecretStorage | Secrets for `kind: "secret"` fields (`apiRunner.auth.profile.<id>.<field>`) — **no dedicated UI wizard** |
| `@auth` in `.api` | Request/document directive; diagnostics for unknown ids |
| Request Editor Auth tab | Choose profile → writes `@auth` |
| OpenAPI import | Can create profiles + show secret-setup hints |
| Login / Logout commands | Placeholders “Coming Soon” |

Providers: `none`, `basic`, `bearer`, `apiKey`.

---

## 9. Variables UI

| Scope | Where edited | How selected |
| --- | --- | --- |
| Global | Settings `apiRunner.variables.global` | Always in resolution |
| Workspace | Settings `apiRunner.variables.workspace` | Always in resolution |
| Environment | Settings `apiRunner.environments` + `activeEnvironment` | QuickPick `switchEnvironment` is **session-only** (does not write setting) |
| Document | `@variable` / `@sensitive-variable` in `.api` | Highest precedence |

Additional UX: completions/hover/diagnostics for `{{name}}`; Request Editor Variables tab + resolution preview.  
No dedicated Variables tree or env manager webview.

Precedence: document > environment > workspace > global.

---

## 10. OpenAPI Import

### Workflow

1. Command / welcome: Import OpenAPI  
2. Workspace folder pick (multi-root)  
3. OpenDialog for json/yaml/yml  
4. `withProgress` notification (cancellable) through parse → auth → env → generate → write → refresh collections  
5. May patch workspace settings (environments, active env, auth profiles)  
6. Modal summary (info / warn / error) + secret hints  

### Generated structure

```text
Collections/<api-slug>/
  api-hero.collection.json
  <folder>/
    <method>-<operation>.api
```

One operation → one `.api` file. Failures write nothing and do not refresh.

---

## 11. Commands Table

| Command ID | Title | Where accessible | Shortcut | Context menu | Toolbar | Palette | Purpose |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `apiRunner.runRequest` | Run Request | Editor, CodeLens, editor title | Ctrl/Cmd+Alt+R | editor | editor/title | Yes | Execute request at cursor |
| `apiRunner.runRequestWithAssertions` | Run Request with Assertions | CodeLens | — | — | — | Yes | Run + evaluate expects |
| `apiRunner.runFile` | Run File (Coming Soon) | — | — | — | — | Hidden | Placeholder |
| `apiRunner.login` | Login (Coming Soon) | — | — | — | — | Hidden | Placeholder |
| `apiRunner.logout` | Logout (Coming Soon) | — | — | — | — | Hidden | Placeholder |
| `apiRunner.switchEnvironment` | Switch Environment | Request Editor, editor title overflow | — | — | overflow | Yes | Session env QuickPick |
| `apiRunner.manageEnvironments` | Manage Environments | Collections overflow, Overview, editor | — | — | overflow | Yes | Env Manager panel |
| `apiRunner.manageAuthProfiles` | Manage Authentication | Collections overflow, Overview, editor | — | — | overflow | Yes | Auth Manager panel |
| `apiRunner.selectAuthentication` | Select Authentication Profile | Request Editor toolbar | — | — | overflow | Yes | Session auth QuickPick |
| `apiRunner.refreshCollections` | Refresh Collections | Collections title | — | — | Yes | Yes | Rescan tree |
| `apiRunner.revealActiveRequest` | Reveal Active Request | Editor ctx, title | — | editor | Yes | Yes | Reveal tree node |
| `apiRunner.openCollectionRequest` | Open Request | Tree | — | tree | inline | Yes | Open editor |
| `apiRunner.focusCollections` | Focus Collections | Welcome | — | — | — | Yes | Focus view |
| `apiRunner.runCollection` | Run Collection | Tree | — | tree | inline | Yes | Run all in collection |
| `apiRunner.runCollectionTests` | Run Collection Tests | — | — | — | — | Yes | Run with assertions |
| `apiRunner.runFolder` | Run Folder | Tree | — | tree | inline | Yes | Run folder |
| `apiRunner.runSelectedRequests` | Run Selected Requests | Tree | — | tree | inline | Yes | Run selection / single |
| `apiRunner.focusHistory` | Focus History | Welcome | — | — | — | Yes | Focus history |
| `apiRunner.recentRequests` | Recent Requests | Collections overflow, Overview | — | — | overflow | Yes | Alias → focus History |
| `apiRunner.openSettings` | Open Settings | Collections overflow, Overview | — | — | overflow | Yes | Opens API Hero settings |
| `apiRunner.openOverview` | Open Overview | Collections/History overflow, welcome | — | — | overflow | Yes | Overview panel |
| `apiRunner.openHistoryEntry` | Open History Entry | Tree click | — | tree | — | Yes | Detail panel |
| `apiRunner.rerunHistoryEntry` | Re-run History Entry | Tree | — | tree | inline | Yes | Rerun from source |
| `apiRunner.revealHistoryRequest` | Reveal Original Request | Tree | — | tree | inline | Yes | Open source |
| `apiRunner.deleteHistoryEntry` | Delete History Entry | Tree | — | tree | inline | Yes | Delete one |
| `apiRunner.clearHistory` | Clear History | History overflow | — | — | overflow | Yes | Clear all |
| `apiRunner.searchHistory` | Filter History | History title | — | — | Yes | Yes | Filter InputBox |
| `apiRunner.refreshHistory` | Refresh History | History title, welcome | — | — | Yes | Yes | Reload list |
| `apiRunner.importOpenApi` | Import OpenAPI Specification | Collections title, welcome | — | — | Yes | Yes | Import pipeline |
| `apiRunner.createCollection` | New Collection | Collections title, welcome | — | — | Yes | Yes | New Collections/ folder |
| `apiRunner.renameCollection` | Rename Collection | Tree | — | tree | — | Yes | Native rename |
| `apiRunner.deleteCollection` | Delete Collection | Tree | — | tree | — | Yes | Native delete |
| `apiRunner.duplicateCollection` | Duplicate Collection | Tree | — | tree | — | Yes | Deep copy |
| `apiRunner.exportCollection` | Export Collection | Tree | — | tree | — | Yes | Folder copy out |
| `apiRunner.importCollection` | Import Collection | Collections overflow | — | — | overflow | Yes | Folder copy in |
| `apiRunner.createFolder` | New Folder | Tree | — | tree | — | Yes | Native folder |
| `apiRunner.renameFolder` | Rename Folder | Tree | — | tree | — | Yes | Native rename |
| `apiRunner.deleteFolder` | Delete Folder | Tree | — | tree | — | Yes | Native delete |
| `apiRunner.duplicateFolder` | Duplicate Folder | Tree | — | tree | — | Yes | Copy folder |
| `apiRunner.createRequest` | New Request | Collections title, tree, welcome | — | tree | Yes | Yes | New Request dialog |
| `apiRunner.renameRequest` | Rename Request | Tree | — | tree | — | Yes | Rename .api |
| `apiRunner.duplicateRequest` | Duplicate Request | Tree | — | tree | — | Yes | Copy .api |
| `apiRunner.deleteRequest` | Delete Request | Tree | — | tree | — | Yes | Delete .api |
| `apiRunner.moveRequest` | Move Request | Tree | — | tree | — | Yes | QuickPick destination |
| `apiRunner.openWorkspace` | Open Existing Workspace | Welcome | — | — | — | Yes | `vscode.openFolder` |
| `apiRunner.openRequestEditor` | Open Request Editor | Editor title overflow | — | — | overflow | Yes | Custom editor |

---

## 12. Context Menus

### Editor (`editor/context`, `.api` focused)

- Run Request  
- Reveal Active Request  

### Collections view title

- Create Collection, Import Collection, New Request, Refresh, Reveal Active Request  

### Collections item context (summary)

| Node | Groups |
| --- | --- |
| Collection (native) | Run; New Request/Folder; Rename, Duplicate, Export, Delete |
| Folder (native) | Run; New Request/Folder; Rename, Duplicate, Delete |
| Request (native) | Run; Open; Duplicate, Rename, Move, Delete |
| Legacy request | Run; Open; Move; Delete (via regex menus) |
| Legacy collection/folder | Run (collection/folder); limited mutations |

### History view title

- Refresh, Search, Clear  

### History entry

- Open; Re-run; Reveal; Delete  

### Not contributed

- Explorer context, editor title menu, command palette custom groups, walkthroughs  

---

## 13. Welcome Screens

### Collections empty

Copy: “No collections yet…”  
Buttons: Create Collection | Import Collection | Import OpenAPI | Open Existing Workspace  

### History empty

Copy: “No request history yet…”  
Buttons: Refresh History | Focus Collections  

---

## 14. Settings

Section title: **API Hero** (`apiRunner`).

| Category | Keys |
| --- | --- |
| Logging | `logLevel` |
| Execution | `requestTimeout`, `maxResponseBytes` |
| History | `history.maxEntries` |
| Variables | `variables.global`, `variables.workspace`, `environments`, `activeEnvironment` |
| Auth | `authentication.profiles` |
| Import | `import.maxFileBytes` |
| Language | `languageFeatures.hover`, `.outline`, `.diagnostics` |

**Discovery:** VS Code Settings UI search “API Hero”, or edit `settings.json`.  
Auth secrets are **not** editable as plain settings when `kind: "secret"` — SecretStorage keys must be populated separately (no first-class secret editor UI).

---

## 15. Notifications (patterns)

### Information

Coming Soon placeholders; created/exported/imported collection; history entry detail modal; collection run summaries; OpenAPI success; open Request Editor guidance; reveal-active guidance  

### Warning

Select X first; native-only actions; collision Rename/Overwrite; clear history confirm; collection run in progress / partial failures; OpenAPI cancelled / warnings; could not find request  

### Error

Mutation failures (`API Hero: …`); run resolve failures; orchestration failures; history missing source; collection run failures; OpenAPI failures  

### Progress

Single request (`API Hero`); collection runs (dynamic titles); OpenAPI import  

### Status bar (transient)

- Request run status (priority 100) — hides after ~3s  
- Collection run status (priority 99) — hides after ~5s  

No permanent idle status bar item.

---

## 16. Current UX Problems (identify only)

1. **Dual edit surfaces without clear default** — Custom editor is `option`; create opens text; tree open uses form for single-request → inconsistent first experience  
2. **Session vs settings for env/auth** — Switch Environment / Select Auth do not persist; settings `activeEnvironment` is separate → surprising  
3. **Legacy vs native capability split** — Same tree, different menus; easy to confuse why Rename is missing  
4. **History “Open” is a modal**, not a rich detail panel — limited compared to Response viewer  
5. **Response viewer lacks copy/save/search** — common API-client expectations unmet  
6. **Auth profile & secret setup is settings-JSON heavy** — no guided CRUD UI; Login/Logout Coming Soon  
7. **Variables only in Settings + file** — no sidebar env manager  
8. **Coming Soon stubs** (`runFile`, Login, Logout) remain registered for stable command IDs; Command Palette entries are **hidden** (`menus.commandPalette` `when: false`) — not palette noise, but unfinished product surface  
9. **No Code Actions** for common fixes (add `@auth`, insert expect, etc.)  
10. **Collection runner failure policy** via QuickPick is easy to miss vs always-visible UI  
11. **New Request opens text**, not the form editor just created for editing  
12. **Multi-request files** second-class in form editor (banner only)  
13. **Cookies section** is a stub  
14. **Import Collection is folder-only** (no zip) — may surprise users expecting archive export  
15. **Duplicate workflows**: Move via context menu QuickPick **and** DnD; Refresh on both views without shared “dirty” indicator  

Shipped chrome (not problems): **editor/title Run** for `.api` (`$(play)`); Env / Select Auth / Open Request Editor in editor-title overflow.

---

## 17. UI Inventory (complete)

| Category | Items |
| --- | --- |
| Activity Bar | `apiRunner` |
| Tree Views | Collections, History |
| Welcome Views | Both views |
| Custom Editors | `apiRunner.requestEditor` |
| Webview Panels | Response (`apiRunner.response`), New Request (`apiRunner.newRequest`) |
| Status Bar | 2 transient items |
| Dialogs | Confirms, OpenDialog, WorkspaceFolderPick, collision prompts |
| Quick Picks | Auth, Environment, Move request, Open Request Editor doc, Run collection, Failure policy |
| Input Boxes | Names (collection/folder/request), history search, New Request fallback |
| Menus | editor/context, editor/title, view/title ×2, view/item/context |
| Commands | 43 |
| Language UI | grammar, completions, hover, diagnostics, outline, CodeLens, folding, snippets |
| Settings | 13 properties (+ nested profile/variable schemas) |
| Problems | Language diagnostics; assertion Problems after test runs |

---

## 18. File Map (UI-responsible)

### Shell / contributions

| File | Responsibility |
| --- | --- |
| `package.json` | All contributions |
| `src/extension.ts` | Activate wiring |
| `src/constants/commands.ts` | Command IDs |
| `src/constants/views.ts` | View IDs + request editor viewType |
| `src/constants/configuration.ts` | Setting keys |
| `images/api-*.svg` | Activity / language icons |

### Collections UI

| File | Responsibility |
| --- | --- |
| `src/collections/vscode/collection-tree-provider.ts` | Tree rendering |
| `src/collections/vscode/register-collections.ts` | View registration + watchers |
| `src/collections/vscode/register-mutation-commands.ts` | CRUD command UX |
| `src/collections/vscode/collection-dnd-controller.ts` | Drag & drop |
| `src/collections/vscode/navigation-service.ts` | Open / reveal |
| `src/collections/vscode/new-request-dialog.ts` | New Request host |
| `src/collections/vscode/new-request-dialog-html.ts` | New Request HTML |
| `src/collections/vscode/mutation-filesystem.ts` | FS adapter |
| `src/collections/tree-projection.ts` | Neutral tree model |
| `src/collections/discovery.ts` | Populate graph |
| `src/collections/mutation/service.ts` | Mutations |
| `src/collections/marker.ts` | Marker parse/order |

### History UI

| File | Responsibility |
| --- | --- |
| `src/history/vscode/history-tree-provider.ts` | Tree |
| `src/history/vscode/register-history.ts` | Commands + menus wiring |
| `src/history/query.ts` | Group/filter |
| `src/history/vscode/file-history-repository.ts` | Persistence adapter |

### Request editor / language / response

| File | Responsibility |
| --- | --- |
| `src/request-editor/vscode/*` | Custom editor |
| `src/request-source/*` | Form ↔ `.api` model |
| `src/language-support/*` | Text language UX |
| `syntaxes/api.tmLanguage.json` | Highlighting |
| `language-configuration.json` | Editor config |
| `snippets/api.json` | Snippets |
| `src/response/*` | Response webview |
| `src/orchestration/vscode-execution-ui.ts` | Run progress + status bar |
| `src/collection-runner/vscode/*` | Collection run UX |

### Auth / variables / OpenAPI commands

| File | Responsibility |
| --- | --- |
| `src/commands/select-authentication-command.ts` | Auth QuickPick |
| `src/commands/switch-environment-command.ts` | Env QuickPick |
| `src/commands/placeholder-commands.ts` | Coming Soon stubs only (`runFile`, `login`, `logout`) |
| `src/openapi-import/vscode/register-openapi-import.ts` | Import UX |

---

## 19. Screenshots

**Not captured** in this inventory (no Extension Development Host session).  

Suggested capture list for a follow-up pass:

1. Activity Bar + Collections populated  
2. Collections empty welcome  
3. Collection / folder / request context menus  
4. New Request webview  
5. Custom Request Editor (each tab)  
6. Text `.api` editor with CodeLens  
7. Response panel after a run  
8. History tree + entry modal  
9. Auth / Environment QuickPicks  
10. OpenAPI progress + summary modal  
11. Settings → API Hero  

Architectural stand-ins: sections 2–7 diagrams above.

---

## 20. Final Report Summary

### Current UI architecture

Git-first `.api` files remain canonical. Organization UI (Collections) and dual editors (text + optional form) wrap filesystem + parser. Execution results surface in a response webview and History tree. Configuration for auth/variables lives primarily in VS Code Settings; session QuickPicks overlay without always persisting.

### Interaction model

**Organize in sidebar → open editor → run → inspect response / history.**  
Secondary: Command Palette for env/auth/import; settings for durable config.

### User workflows (happy paths)

1. Create Collection → New Folder → New Request → edit → Run  
2. Import OpenAPI → browse generated tree → Run  
3. Edit Legacy `.api` in place → Run → History rerun  
4. Switch environment (session) → Run with resolved variables  
5. Select auth profile (session) or `@auth` in file → Run  

### Feature map

| Feature | UI maturity |
| --- | --- |
| Collections CRUD / DnD | Strong (native) |
| Legacy support | Partial |
| Text `.api` editing | Strong |
| Form request editor | Present (single-request) |
| Response viewer | Partial (no copy/save/search) |
| History | Basic |
| Auth | Settings + QuickPick (weak guided UX) |
| Variables / Environments | Settings + QuickPick |
| OpenAPI import | Strong |
| Collection runner | Present (commands + progress) |

### Missing UX capabilities (factual gaps)

- Guided auth/secret setup; Login/Logout  
- Variables/environments sidebar  
- Response copy/save/search; real cookies UI  
- Rich history detail view  
- Code Actions  
- Editor title Run control  
- Zip import/export  
- Form-first create path  
- Persistent env switch writing settings  

### Technical constraints (for reviewers)

- Do not change parser / `.api` format without product decision  
- Secrets must not enter webviews  
- Discovery is read-only; mutations via mutation service  
- Custom editor must not rewrite multi-request files from a single form  
- VS Code-free core modules  

### Primary files per feature

See §18 File Map.

---

*End of inventory. Suitable as input for a professional UX review and roadmap exercise.*
