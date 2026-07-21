# API Hero — Screen List

**Version:** 1.2 (Final Polish)  
**Purpose:** Enumerate every screen the product should eventually contain.  
**Status:** ✅ Current · 🔶 Partial · 🆕 Planned  
**IA law:** Only Collections + History are permanent Activity Bar views — [`information-architecture.md`](./information-architecture.md).  
**Components:** Canonical contracts in [`component-library.md`](./component-library.md).  
**Roadmap:** Phase ownership in [`roadmap.md`](./roadmap.md).

---

## Master index (screen → components → phase)

| ID | Screen | Kind | Status | Components (primary) | Phase |
| --- | --- | --- | --- | --- | --- |
| S01 | Collections Tree | Activity Bar | ✅ | CollectionTree, nodes, MethodBadge, EmptyState | — |
| S02 | Collections Welcome | Welcome | ✅ | EmptyState | — |
| S03 | History Tree | Activity Bar | ✅ | HistoryCard, SearchInput, badges | — |
| S04 | History Welcome | Welcome | ✅ | EmptyState | — |
| S05 | History Entry Detail | Modal | 🔶 retiring | → replaced by S30 | 4 |
| S06 | Request Editor | Editor | ✅ | RequestCard, KV tables, pickers, AssertionBuilder | 1 |
| S07 | Multi-Request Guard | Banner | ✅ | MultiRequestBanner | — |
| S08 | Text Editor `.api` | Editor | ✅ | workbench + CodeLens | 1 |
| S09 | Response Panel | Panel | ✅/🔶 | StatusBadge, ResponseTabs, JSONViewer | 1 |
| S10 | New Request Dialog | Dialog | ✅ | RequestCard subset | 1 |
| S11 | Collection Run Progress | Progress | ✅ | ProgressBanner / host | 4 |
| S12 | Failure Policy Picker | QuickPick | ✅ | host QuickPick | 4 |
| S13 | Switch Environment | QuickPick | ✅ | EnvironmentPicker | 2 |
| S14 | Select Authentication | QuickPick | ✅ | AuthPicker | 3 |
| S15 | Move Request Picker | QuickPick | ✅ | host | — |
| S16 | Import/Export Folder | Dialogs | ✅ | CollisionResolve | — |
| S17 | Collision Resolve | Dialog | ✅ | CollisionResolve | — |
| S18 | OpenAPI Import | Flow | ✅ | ProgressBanner, ErrorCallout | 5 |
| S19 | Settings | Settings | ✅ | VS Code Settings | — |
| S20 | Problems | Workbench | ✅ | VS Code Problems | 7 |
| S21 | Output Channel | Workbench | ✅ | VS Code Output | — |
| S22 | Delete/Clear Confirm | Dialog | ✅ | ConfirmationDialog | — |
| S23 | Coming Soon Stubs | Stub | 🔶 remove | — | 1/9 |
| S24 | Overview Panel | Panel cmd | 🆕 | OverviewPanel, chips, HistoryCard | 8 |
| S25 | Environments Manager | Panel | 🆕 | EnvironmentManager, KeyValueTable | 2 |
| S26 | Variables Manager | Panel tab | 🆕 | VariableEditor, KeyValueTable | 2 |
| S27 | Auth Profiles Manager | Panel | 🆕 | AuthProfileManager, SecretPrompt | 3 |
| S28 | Set Secret Prompt | Dialog | 🆕 | SecretPrompt | 3 |
| S29 | Import Hub | Panel | 🆕 | ImportHub, ProgressBanner | 5 |
| S30 | History Detail Panel | Panel | 🆕 | badges, Toolbar, ErrorCallout | 4 |
| S31 | Collection Run Report | Panel | 🆕 | CollectionRunReport | 4 |
| S32 | Walkthrough | Walkthrough | 🆕 | VS Code walkthrough | 5 |
| S33 | Legacy Migration | Dialog/flow | 🆕 | ConfirmationDialog, ProgressBanner | 8 |
| S34 | Zip Import/Export | Flow | 🆕 | ImportHub, CollisionResolve | 5 |

**S05 → S30:** Opening a history entry must migrate from `showInformationMessage` (S05) to History Detail panel (S30). Do not keep both as product destinations.

---

## S01 — Collections Tree

| Field | Content |
| --- | --- |
| **Purpose** | Browse and organize collections, folders, and requests; primary launchpad |
| **Entry point** | Activity Bar → API Hero → Collections; `focusCollections`; welcome |
| **Actions** | Create/import collection; new request/folder; refresh; reveal; run; CRUD; DnD; export |
| **Data displayed** | Collection/folder/request nodes; counts; method + URL descriptions |
| **Toolbar** | Create Collection, Import Collection, New Request, Refresh, Reveal Active Request |
| **Context menu** | Run; New; Rename; Duplicate; Move; Export; Delete (native/legacy variants) |
| **Navigation** | Open request → editor; Run → response/history |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S02 — Collections Welcome (Empty)

| Field | Content |
| --- | --- |
| **Purpose** | First-run guidance when no collections exist |
| **Entry point** | Empty Collections view |
| **Actions** | Create Collection; Import Collection; Import OpenAPI; Open Workspace |
| **Data displayed** | Short empty-state copy |
| **Toolbar** | Same as S01 when visible |
| **Context menu** | — |
| **Navigation** | Into create/import flows |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S03 — History Tree

| Field | Content |
| --- | --- |
| **Purpose** | Browse past executions |
| **Entry point** | Activity Bar → History; `focusHistory` |
| **Actions** | Search; refresh; clear; open; re-run; reveal; delete |
| **Data displayed** | Time groups; status icons; method/URL; duration; time |
| **Toolbar** | Refresh, Search, Clear |
| **Context menu** | Open; Re-run; Reveal Original; Delete |
| **Navigation** | Detail; Response (on re-run); Collections (reveal) |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S04 — History Welcome (Empty)

| Field | Content |
| --- | --- |
| **Purpose** | Explain history is empty; route to collections |
| **Entry point** | Empty History view |
| **Actions** | Refresh History; Focus Collections |
| **Data displayed** | Empty copy |
| **Toolbar** | As S03 |
| **Context menu** | — |
| **Navigation** | Collections |
| **Current status** | ✅ |
| **Priority** | P1 |

---

## S05 — History Entry Detail

| Field | Content |
| --- | --- |
| **Purpose** | Inspect one past run without re-executing |
| **Entry point** | Click/Open history entry |
| **Actions** | Re-run; Reveal; Copy summary; Close |
| **Data displayed** | Method, URL, status, timing, env, collection, error message; optional headers summary |
| **Toolbar** | Re-run, Reveal, Copy |
| **Context menu** | — |
| **Navigation** | Response (re-run); Collections (reveal) |
| **Components** | Temporary modal — migrate to S30 components |
| **Roadmap** | Phase 4 replaces with S30 |
| **Current status** | 🔶 Modal `showInformationMessage` only — **retiring** |
| **Priority** | P0 → replace with panel S30 |

---

## S06 — Request Editor (Custom Text Editor)

| Field | Content |
| --- | --- |
| **Purpose** | Visually author a single-request `.api` file |
| **Entry point** | Tree open (single-request); Open Request Editor; Open With |
| **Actions** | Edit tabs; Run; sync to buffer; open text |
| **Data displayed** | Form model projected from document |
| **Toolbar** | Run; (planned) Env picker; Auth shortcut; Open Text |
| **Context menu** | VS Code editor defaults + API Hero where contributed |
| **Navigation** | Response on run; Preview shows text |
| **Current status** | ✅ |
| **Priority** | P0 |

### S06 tabs (sub-screens)

| Tab | Purpose | Status |
| --- | --- | --- |
| Request | Name, description, method, URL | ✅ |
| Params | Query table | ✅ |
| Headers | Header table | ✅ |
| Body | Body mode editors | ✅ / 🔶 multipart·binary |
| Auth | Profile select | ✅ |
| Variables | Document vars + preview | ✅ |
| Tests | Expect builders | ✅ |
| Settings | Timeout | ✅ |
| Preview | Read-only `.api` text | ✅ |

---

## S07 — Multi-Request Guard Banner

| Field | Content |
| --- | --- |
| **Purpose** | Prevent unsafe form rewrite of multi-request files |
| **Entry point** | Opening Request Editor when N ≠ 1 requests |
| **Actions** | Open With Text Editor; dismiss/read-only |
| **Data displayed** | Warning banner; request count |
| **Toolbar** | Limited |
| **Context menu** | — |
| **Navigation** | Text editor |
| **Current status** | ✅ |
| **Priority** | P0 (safety) |

---

## S08 — Text Editor (`.api`)

| Field | Content |
| --- | --- |
| **Purpose** | Power-user DSL editing; multi-request files |
| **Entry point** | Default open; Open With Text; create paths that open text |
| **Actions** | Type; Run via CodeLens/keybinding/context; Reveal |
| **Data displayed** | Full document; diagnostics; outline |
| **Toolbar** | (Planned) editor title Run |
| **Context menu** | Run Request; Reveal Active Request |
| **Navigation** | Response; Collections reveal |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S09 — Response Panel

| Field | Content |
| --- | --- |
| **Purpose** | Inspect HTTP result and assertions after a run |
| **Entry point** | Successful orchestration of single-request run |
| **Actions** | Expand/collapse; Pretty/Raw; (planned) Copy/Save/Search |
| **Data displayed** | Status hero; stats; body; headers; cookies stub; assertions; errors |
| **Toolbar** | View mode toggles; planned action buttons |
| **Context menu** | — |
| **Navigation** | Standalone panel; link from History later |
| **Current status** | ✅ / 🔶 tools missing |
| **Priority** | P0 |

---

## S10 — New Request Dialog

| Field | Content |
| --- | --- |
| **Purpose** | Create a new request file with initial metadata |
| **Entry point** | Collections toolbar/context/welcome; `createRequest` |
| **Actions** | Fill name/method/URL/description/collection/folder; Create; Cancel |
| **Data displayed** | Form fields; collection/folder choices |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Opens created `.api` (should open Request Editor — gap) |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S11 — Collection Run Progress / Summary

| Field | Content |
| --- | --- |
| **Purpose** | Feedback during/after multi-request runs |
| **Entry point** | Run Collection / Folder / Selected / Tests |
| **Actions** | Cancel; view summary; (planned) open report |
| **Data displayed** | Counts pass/fail/skip; current item; policy |
| **Toolbar** | Progress UI |
| **Context menu** | — |
| **Navigation** | History entries; optional report panel |
| **Current status** | ✅ notifications/progress |
| **Priority** | P1 |

---

## S12 — Failure Policy Picker

| Field | Content |
| --- | --- |
| **Purpose** | Choose stop/continue behavior for collection runs |
| **Entry point** | Before collection/folder/selected run |
| **Actions** | Select policy; confirm |
| **Data displayed** | Policy options |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Into run |
| **Current status** | ✅ QuickPick |
| **Priority** | P1 (discoverability) |

---

## S13 — Switch Environment

| Field | Content |
| --- | --- |
| **Purpose** | Choose active environment for resolution |
| **Entry point** | Command Palette; (planned) status bar / Request Editor |
| **Actions** | Pick environment |
| **Data displayed** | Environment names |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Returns to prior editor |
| **Current status** | ✅ session QuickPick |
| **Priority** | P0 (persist + manager) |

---

## S14 — Select Authentication Profile

| Field | Content |
| --- | --- |
| **Purpose** | Choose session default auth profile |
| **Entry point** | Command Palette; (planned) toolbar |
| **Actions** | Pick None or profile |
| **Data displayed** | Profile list |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | — |
| **Current status** | ✅ session QuickPick |
| **Priority** | P1 |

---

## S15 — Move Request Picker

| Field | Content |
| --- | --- |
| **Purpose** | Choose destination collection/folder |
| **Entry point** | Move Request command |
| **Actions** | Select destination |
| **Data displayed** | Native targets |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Tree refresh |
| **Current status** | ✅ |
| **Priority** | P1 |

---

## S16 — Import / Export Folder Dialogs

| Field | Content |
| --- | --- |
| **Purpose** | Copy collections in/out of workspace |
| **Entry point** | Import/Export Collection commands |
| **Actions** | Pick folder; resolve collisions |
| **Data displayed** | FS picker; collision choice |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Collections refresh |
| **Current status** | ✅ |
| **Priority** | P1 |

---

## S17 — Collision Resolve

| Field | Content |
| --- | --- |
| **Purpose** | Handle name conflicts on import |
| **Entry point** | Import when target exists |
| **Actions** | Rename / Overwrite / Cancel |
| **Data displayed** | Conflicting names |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Completes import |
| **Current status** | ✅ |
| **Priority** | P1 |

---

## S18 — OpenAPI Import Flow

| Field | Content |
| --- | --- |
| **Purpose** | Generate collection from OpenAPI 3.x |
| **Entry point** | Import OpenAPI; Collections welcome |
| **Actions** | Pick workspace; pick file; progress; review summary |
| **Data displayed** | Progress; success/warn/error; secret hints |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | New `Collections/<slug>/` |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S19 — VS Code Settings (API Hero)

| Field | Content |
| --- | --- |
| **Purpose** | Persist configuration |
| **Entry point** | Settings UI search “API Hero”; settings.json |
| **Actions** | Edit keys |
| **Data displayed** | All `apiRunner.*` settings |
| **Toolbar** | VS Code Settings |
| **Context menu** | — |
| **Navigation** | — |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S20 — Problems Panel (Language / Assertions)

| Field | Content |
| --- | --- |
| **Purpose** | Surface parse/var/auth issues and post-run assertion failures |
| **Entry point** | Automatic diagnostics |
| **Actions** | Click to navigate; (planned) Code Actions |
| **Data displayed** | Diagnostic list |
| **Toolbar** | VS Code Problems |
| **Context menu** | VS Code defaults |
| **Navigation** | Editor locations |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S21 — Output Channel (API Hero)

| Field | Content |
| --- | --- |
| **Purpose** | Detailed logs for support/debug |
| **Entry point** | Output panel; logLevel |
| **Actions** | Read / clear (VS Code) |
| **Data displayed** | Log lines |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | — |
| **Current status** | ✅ |
| **Priority** | P2 |

---

## S22 — Delete / Clear Confirmations

| Field | Content |
| --- | --- |
| **Purpose** | Confirm destructive actions |
| **Entry point** | Delete collection/folder/request; clear history |
| **Actions** | Confirm / Cancel |
| **Data displayed** | Warning copy |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Back to tree |
| **Current status** | ✅ |
| **Priority** | P0 |

---

## S23 — Coming Soon Stub Messages

| Field | Content |
| --- | --- |
| **Purpose** | Placeholder for Run File / Login / Logout |
| **Entry point** | Command Palette |
| **Actions** | Dismiss |
| **Data displayed** | Coming Soon info |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | — |
| **Current status** | 🔶 Stub (should be removed or implemented) |
| **Priority** | P1 |

---

## Planned screens

### S24 — Overview Panel 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Optional orientation: env, auth, recent activity, quick actions |
| **Entry point** | Command (`Open Overview`) / walkthrough — **not** Activity Bar |
| **Actions** | Quick create/import/switch env/manage auth |
| **Data displayed** | Summaries from history + collections + settings |
| **Toolbar** | Refresh |
| **Context menu** | — |
| **Navigation** | Opens manager **panels** and Collections |
| **Components** | OverviewPanel, HistoryCard, EnvironmentPicker, AuthPicker |
| **Roadmap** | Phase 8 |
| **Current status** | 🆕 |
| **Priority** | P1 |

---

### S25 — Environments Manager 🆕

| Field | Content |
| --- | --- |
| **Purpose** | CRUD environments and env variables visually |
| **Entry point** | Command / status bar chip / Request Editor link / Overview |
| **Actions** | Add/edit/delete env; set active; mark sensitive; duplicate |
| **Data displayed** | Env list; variable tables; active badge |
| **Toolbar** | Add Environment; Set Active; Import/Export |
| **Context menu** | Duplicate; Delete |
| **Navigation** | Writes Settings; does **not** add Activity Bar view |
| **Components** | EnvironmentManager, KeyValueTable, SectionCard |
| **Roadmap** | Phase 2 |
| **Current status** | 🆕 |
| **Priority** | P0 |

---

### S26 — Variables Manager 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Edit global/workspace variables without raw JSON |
| **Entry point** | Tab inside Environments Manager panel; command |
| **Actions** | CRUD rows; sensitive toggle |
| **Data displayed** | Scoped variable tables |
| **Toolbar** | Add Variable |
| **Context menu** | Delete |
| **Navigation** | Document vars via Request Editor |
| **Components** | VariableEditor, KeyValueTable |
| **Roadmap** | Phase 2 |
| **Current status** | 🆕 |
| **Priority** | P0 |

---

### S27 — Auth Profiles Manager 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Guided profile CRUD + secret status |
| **Entry point** | Command / status bar / Request Editor Auth link / Overview |
| **Actions** | Add profile; edit fields; set/clear secrets; set default; delete |
| **Data displayed** | Profiles; provider; field sources; secret set/missing |
| **Toolbar** | Add Profile; Set Default |
| **Context menu** | Duplicate; Delete |
| **Navigation** | Secret prompts; Request Auth tab; **panel only** |
| **Components** | AuthProfileManager, AuthPicker, ConfirmationDialog |
| **Roadmap** | Phase 3 |
| **Current status** | 🆕 |
| **Priority** | P0 |

---

### S28 — Set Secret Prompt 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Capture secret into SecretStorage |
| **Entry point** | Auth manager; OpenAPI hints; missing-secret diagnostic action |
| **Actions** | Enter secret; save; cancel |
| **Data displayed** | Profile/field labels; never echo after save |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Back to Auth manager |
| **Current status** | 🆕 |
| **Priority** | P0 |

---

### S29 — Import Hub 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Single place for OpenAPI / Postman / Insomnia / zip |
| **Entry point** | Welcome; command; Overview |
| **Actions** | Choose format; pick file; configure options; import |
| **Data displayed** | Format cards; progress; summary |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Collections |
| **Components** | ImportHub, ProgressBanner, ErrorCallout |
| **Roadmap** | Phase 5 |
| **Current status** | 🆕 (OpenAPI path exists as S18) |
| **Priority** | P1 |

---

### S30 — History Detail Panel 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Rich replacement for S05 modal |
| **Entry point** | History open |
| **Actions** | Re-run; Reveal; Copy; Delete |
| **Data displayed** | Structured metadata; error detail; links |
| **Toolbar** | Actions above |
| **Context menu** | — |
| **Navigation** | Response / Collections |
| **Current status** | 🆕 |
| **Priority** | P0 |

---

### S31 — Collection Run Report 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Post-run table of results |
| **Entry point** | End of collection run |
| **Actions** | Filter failed; open request; export report |
| **Data displayed** | Per-request status, duration, assertion summary |
| **Toolbar** | Filter; Export |
| **Context menu** | Open; Re-run item |
| **Navigation** | Editors / History |
| **Current status** | 🆕 |
| **Priority** | P2 |

---

### S32 — Walkthrough / Getting Started 🆕

| Field | Content |
| --- | --- |
| **Purpose** | In-product onboarding |
| **Entry point** | First activate; Help; Overview command |
| **Actions** | Step through create → run → env |
| **Data displayed** | Guided steps |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Live commands |
| **Current status** | 🆕 |
| **Priority** | P1 |

---

### S33 — Legacy Migration Assistant 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Move Legacy `.api` files into `Collections/` |
| **Entry point** | Legacy collection context; Overview tip |
| **Actions** | Preview moves; confirm; execute |
| **Data displayed** | File list; targets |
| **Toolbar** | Migrate |
| **Context menu** | — |
| **Navigation** | Native tree |
| **Current status** | 🆕 |
| **Priority** | P2 |

---

### S34 — Zip Import/Export 🆕

| Field | Content |
| --- | --- |
| **Purpose** | Archive-based collection transfer |
| **Entry point** | Import Hub / Export menu |
| **Actions** | Pick zip; extract/write; collisions |
| **Data displayed** | Progress; summary |
| **Toolbar** | — |
| **Context menu** | — |
| **Navigation** | Collections |
| **Current status** | 🆕 |
| **Priority** | P2 |

---

## Screen priority backlog (P0/P1)

| Priority | Screens |
| --- | --- |
| P0 | S01–S03, S06, S08–S10, S09 tools, S25–S28, S30, persistence of S13 |
| P1 | S24 Overview (command), S29 Import Hub, S32 Walkthrough, editor title Run, stub cleanup |
| P2 | S31 Report, S33 Migration, S34 Zip, cookies |

---

## Screen → roadmap quick map

| Screens | Phase |
| --- | --- |
| S06/S09/S10 defaults + tools | 1 |
| S25, S26, S13 | 2 |
| S27, S28, S14 | 3 |
| S30, S31, S12 | 4 |
| S29, S32, S34, Marketplace | 5 |
| Body/cookies/Run File | 6 |
| S24, S33 | 8 |

---

## Related documents

- [`information-architecture.md`](./information-architecture.md)  
- [`component-library.md`](./component-library.md)  
- [`user-flows.md`](./user-flows.md)  
- [`north-star.md`](./north-star.md)  
- [`roadmap.md`](./roadmap.md)  
