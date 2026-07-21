# API Hero — UI Components

**Version:** 1.2 (Final Polish)  
**Purpose:** Design-oriented inventory of UI building blocks.  
**Canonical contracts:** For Purpose / Props / States / Events / A11y, use [`component-library.md`](./component-library.md).  
**Visual tokens:** [`design-system.md`](./design-system.md).

Components marked ✅ exist; 🆕 are planned for UI-first phases.

**IA note:** Sidebar hosts **Collections + History only**. Managers are panels, not sidebar views.

---

## Design tokens (webview)

| Token role | Source |
| --- | --- |
| Colors / fonts | VS Code CSS variables (`--vscode-*`) — see design-system |
| Icons | `ThemeIcon` in trees; codicons in webviews where needed |
| Spacing | 4px grid; compact density matching workbench |
| Radius | Minimal; match VS Code webview norms (avoid marketing-card chrome) |

---

## 1. Shell & navigation

### Activity Bar Icon ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Enter API Hero container |
| **Properties** | Product SVG; title “API Hero” |
| **Interactions** | Click focuses last view |
| **Reuse** | Container `apiRunner` only |

### Sidebar View Container ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Host **Collections** and **History** only |
| **Properties** | Two views; collapse |
| **Interactions** | Section headers switch views |
| **Reuse** | Product Activity Bar container |
| **Library id** | SidebarHeader + CollectionTree / History |

### View Title Toolbar ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Primary actions for a view |
| **Properties** | Command icons; group order |
| **Interactions** | Click runs command |
| **Reuse** | Collections, History; future managers |

### Welcome / Empty State ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Guide next action when empty |
| **Properties** | Title, body, button commands |
| **Interactions** | Button → command |
| **Reuse** | Collections, History; Overview tips 🆕 |

---

## 2. Trees

### Tree View ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Hierarchical navigation |
| **Properties** | `showCollapseAll`, multi-select (collections), DnD flag |
| **Interactions** | Expand, select, click, context menu, keyboard |
| **Reuse** | Collections, History |

### Tree Node (Collection / Folder / Request) ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Represent filesystem + parsed requests |
| **Properties** | label, description, icon, contextValue |
| **Interactions** | Click open; context CRUD/run; DnD |
| **Reuse** | Collections tree |

### History Group / Entry Nodes ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Time buckets + run summaries |
| **Properties** | status icon; description `status · duration · time` |
| **Interactions** | Open, re-run, reveal, delete |
| **Reuse** | History tree |

### Drag Ghost / Drop Indicator ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Visualize reorder/move |
| **Properties** | MIME `application/vnd.code.tree.apiRunner.collections` |
| **Interactions** | Drag native nodes; drop on valid targets |
| **Reuse** | Collections DnD |

---

## 3. Request Editor chrome

### Editor Tab Strip ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Switch Request Editor sections |
| **Properties** | Tabs list; active tab |
| **Interactions** | Click tab; keyboard where supported |
| **Reuse** | Request Editor only |

### Editor Toolbar 🔶/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Run and context controls |
| **Properties** | Run button ✅; Env picker 🆕; Auth shortcut 🆕; Open Text 🆕 |
| **Interactions** | Click → commands |
| **Reuse** | Request Editor; optionally text editor title |

### Multi-Request Banner ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Safety messaging |
| **Properties** | Warning text; CTA Open Text |
| **Interactions** | CTA click |
| **Reuse** | Request Editor guard |

### Request Card / Identity Form ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Name, description, method, URL |
| **Properties** | Method dropdown; URL input; text fields |
| **Interactions** | Change → sync model |
| **Reuse** | Request tab; New Request dialog (subset) |

---

## 4. Tables & structured editors

### Key-Value Table ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Headers, params, variables, form fields |
| **Properties** | columns: key, value, enabled?, sensitive? |
| **Interactions** | Add/remove row; toggle enabled; edit cells |
| **Reuse** | Params, Headers, Variables, Body form mode |

### Header Table ✅

| Field | Detail |
| --- | --- |
| **Purpose** | HTTP headers with disable-as-comment |
| **Properties** | enabled flag |
| **Interactions** | Toggle disables without deleting |
| **Reuse** | Headers tab |

### Params Table ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Query string editing |
| **Properties** | Syncs to URL |
| **Interactions** | Edit rows ↔ URL parse |
| **Reuse** | Params tab |

### Expect / Tests Table ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Build `expect` lines |
| **Properties** | target, operator, value |
| **Interactions** | Add/remove; serialize to tests section |
| **Reuse** | Tests tab |

### Environment Variables Table 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Manage env-scoped vars |
| **Properties** | key, value, sensitive |
| **Interactions** | CRUD; mask sensitive |
| **Reuse** | Environments Manager |

---

## 5. Body editors

### Body Mode Selector ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Choose body representation |
| **Properties** | none/json/text/form/raw/multipart/binary |
| **Interactions** | Switch mode (may clear incompatible content with confirm if needed) |
| **Reuse** | Body tab |

### Code / JSON Editor Pane ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Edit structured or raw bodies |
| **Properties** | language hint; monospace |
| **Interactions** | Type; sync |
| **Reuse** | Body; Preview (read-only) |

### Multipart Parts Editor 🔶

| Field | Detail |
| --- | --- |
| **Purpose** | Edit multipart parts |
| **Properties** | part name, type, value/file |
| **Interactions** | Add part; pick file 🆕 |
| **Reuse** | Body multipart — engine support required |

---

## 6. Selectors & pickers

### Environment Picker ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Choose active environment |
| **Properties** | list of env ids/names; active mark |
| **Interactions** | QuickPick today; toolbar dropdown 🆕 |
| **Reuse** | Commands; Overview; Request Editor |

### Auth Selector ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Choose auth profile id |
| **Properties** | None + profiles; labels |
| **Interactions** | Dropdown writes `@auth`; QuickPick for session |
| **Reuse** | Auth tab; Select Authentication; managers |

### Method Dropdown ✅

| Field | Detail |
| --- | --- |
| **Purpose** | HTTP method |
| **Properties** | Standard methods (+ custom if grammar allows) |
| **Interactions** | Select |
| **Reuse** | Request tab; New Request |

### Destination Picker ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Move/create target collection/folder |
| **Properties** | Hierarchical QuickPick |
| **Interactions** | Select destination |
| **Reuse** | Move Request; New Request |

### Failure Policy Picker ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Collection run stop behavior |
| **Properties** | Policy enum |
| **Interactions** | QuickPick |
| **Reuse** | Collection runner |

---

## 7. Response components

### Status Hero ✅

| Field | Detail |
| --- | --- |
| **Purpose** | At-a-glance outcome |
| **Properties** | status code color; method; URL |
| **Interactions** | Collapsible sections below |
| **Reuse** | Response panel |

### Stats Grid ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Duration, sizes, content-type, etc. |
| **Properties** | metric tiles |
| **Interactions** | Read-only |
| **Reuse** | Response |

### Response Tabs / Modes ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Body presentation |
| **Properties** | Pretty / Raw; Search 🆕 |
| **Interactions** | Toggle; search highlight 🆕 |
| **Reuse** | Response body |

### JSON Tree ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Expand/collapse JSON |
| **Properties** | nested nodes |
| **Interactions** | Expand all/collapse |
| **Reuse** | Response Pretty |

### Headers List ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Show response headers (masked) |
| **Properties** | name/value rows |
| **Interactions** | Expand; Copy 🆕 |
| **Reuse** | Response |

### Assertions List ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Pass/fail expects |
| **Properties** | icon, message, expected/actual |
| **Interactions** | Expand details |
| **Reuse** | Response; Run Report 🆕 |

### Cookies Panel 🔶

| Field | Detail |
| --- | --- |
| **Purpose** | Cookie jar visualization |
| **Properties** | Placeholder today |
| **Interactions** | None until jar exists |
| **Reuse** | Response |

### Action Button Group 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Copy / Save / Search |
| **Properties** | icon buttons |
| **Interactions** | Clipboard / save dialog / find |
| **Reuse** | Response toolbar |

---

## 8. History components

### History Card / Row ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Summarize a past run in tree |
| **Properties** | status icon; labels |
| **Interactions** | Open/re-run/reveal/delete |
| **Reuse** | History; Overview recent 🆕 |

### History Detail Layout 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Replace modal with structured panel |
| **Properties** | sections mirroring response metadata |
| **Interactions** | Re-run, reveal, copy |
| **Reuse** | History Detail screen |

### Search Box ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Filter history (and later collections) |
| **Properties** | query string |
| **Interactions** | InputBox today; inline search field 🆕 |
| **Reuse** | History; Collections filter 🆕 |

---

## 9. Dialogs & forms

### New Request Dialog ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Create request metadata |
| **Properties** | name, method, URL, description, collection, folder |
| **Interactions** | Submit/cancel; validation |
| **Reuse** | createRequest flow |

### Confirm Dialog ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Destructive confirmation |
| **Properties** | message; Confirm/Cancel |
| **Interactions** | Modal |
| **Reuse** | Deletes; clear history |

### Secret Prompt 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Capture secrets safely |
| **Properties** | password InputBox; field label |
| **Interactions** | Save to SecretStorage |
| **Reuse** | Auth manager; OpenAPI hints |

### Progress Notification ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Long-running feedback |
| **Properties** | title, cancellable |
| **Interactions** | Cancel |
| **Reuse** | Runs; OpenAPI; imports |

### Summary Modal / Message ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Import/run outcomes |
| **Properties** | info/warn/error severity |
| **Interactions** | Dismiss; optional actions |
| **Reuse** | OpenAPI; collection run |

---

## 10. Buttons, inputs, dropdowns

### Primary Button ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Main CTA (Run, Create) |
| **Properties** | label; disabled state |
| **Interactions** | Click / Enter |
| **Reuse** | Webviews |

### Secondary / Ghost Button ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Cancel, Open Text |
| **Properties** | quieter style |
| **Interactions** | Click |
| **Reuse** | Dialogs; banners |

### Text Input ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Single-line fields |
| **Properties** | placeholder; validation |
| **Interactions** | Type; debounce sync |
| **Reuse** | Forms |

### Text Area ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Description / raw body |
| **Properties** | rows; monospace option |
| **Interactions** | Type |
| **Reuse** | Request; Body |

### Checkbox / Toggle ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Enabled flags; sensitive |
| **Properties** | boolean |
| **Interactions** | Toggle |
| **Reuse** | Tables |

### Dropdown / Select ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Enumerations |
| **Properties** | options; selected |
| **Interactions** | Open list; choose |
| **Reuse** | Method; Auth; Body mode |

---

## 11. Feedback

### Status Bar Item ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Transient run status |
| **Properties** | text; priority; auto-hide |
| **Interactions** | Optional command 🆕 (switch env) |
| **Reuse** | Execution; collection run; env 🆕 |

### Notification Toast ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Info/warn/error |
| **Properties** | severity; actions |
| **Interactions** | Click actions |
| **Reuse** | Global |

### Inline Validation Message ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Field-level errors in forms |
| **Properties** | text; associated field |
| **Interactions** | Show on invalid submit |
| **Reuse** | New Request; managers |

### Skeleton / Loading State 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Panel loading |
| **Properties** | placeholder blocks |
| **Interactions** | None |
| **Reuse** | Managers; History detail |

---

## 12. Overview panel components 🆕

### Summary Chip

| Field | Detail |
| --- | --- |
| **Purpose** | Show active env / auth at a glance |
| **Properties** | label; click target |
| **Interactions** | Click → picker/manager **panel** |
| **Reuse** | Overview; editor toolbar; status bar |
| **Library id** | EnvironmentPicker / AuthPicker |

### Quick Action Grid

| Field | Detail |
| --- | --- |
| **Purpose** | One-click common tasks |
| **Properties** | icon + label buttons |
| **Interactions** | Run commands |
| **Reuse** | Overview; Welcome |

### Recent List

| Field | Detail |
| --- | --- |
| **Purpose** | History preview |
| **Properties** | subset of history cards |
| **Interactions** | Open detail / re-run |
| **Reuse** | Overview |
| **Library id** | HistoryCard |

---

## Component reuse matrix (summary)

| Component | Collections | History | Request Editor | Response | Managers (panels) 🆕 |
| --- | --- | --- | --- | --- | --- |
| Tree | ✓ | ✓ | | | |
| KV Table | | | ✓ | | ✓ |
| Auth Selector | | | ✓ | | ✓ |
| Env Picker | | | ✓ | | ✓ |
| Status Hero | | | | ✓ | |
| Search | | ✓ | | ✓ | ✓ |
| Confirm | ✓ | ✓ | | | ✓ |
| Progress | ✓ | | ✓ | | ✓ |

---

## Related documents

- [`component-library.md`](./component-library.md) (canonical)  
- [`design-system.md`](./design-system.md)  
- [`design-principles.md`](./design-principles.md)  
- [`interaction-model.md`](./interaction-model.md)  
- [`screen-list.md`](./screen-list.md)  
