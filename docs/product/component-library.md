# API Hero — Component Library

**Version:** 1.2 (Final Polish)  
**Role:** Canonical reusable UI component contracts for webviews and shared chrome.  
**Companion:** [`ui-components.md`](./ui-components.md) (design inventory) · [`design-system.md`](./design-system.md)  
**Note:** Native VS Code TreeView nodes are specified here as logical components even when implemented via `TreeItem`.

Status: ✅ shipped · 🆕 planned · 🔶 partial

Every screen in [`screen-list.md`](./screen-list.md) must reference components defined here. New UI must add a row here before implementation.

---

## Conventions

| Field | Meaning |
| --- | --- |
| **Props** | Inputs (logical; not React-specific) |
| **States** | Visual/interaction states |
| **Events** | Outbound user intents to the host |
| **A11y** | Minimum accessibility requirements |

Host message names should stay stable once shipped (version in protocol if breaking).

---

## Shell & navigation

### Toolbar ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Horizontal action strip for editors/panels |
| **Props** | `items: ToolbarButton[]`, `align?: 'start'\|'end'\|'split'` |
| **States** | default, disabled region |
| **Events** | `onAction(id)` |
| **Reuse** | Request Editor, Response, managers, History Detail |
| **A11y** | `role="toolbar"`; roving tabindex optional |

### ToolbarButton ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Icon or labeled action |
| **Props** | `id`, `label`, `icon?`, `disabled?`, `primary?`, `tooltip` |
| **States** | default, hover, active, disabled, loading |
| **Events** | `onClick` |
| **Reuse** | All toolbars |
| **A11y** | `aria-label` = tooltip/label |

### SidebarHeader ✅

| Field | Detail |
| --- | --- |
| **Purpose** | View title + contributed actions (VS Code view title) |
| **Props** | Host-contributed via `package.json` |
| **States** | — |
| **Events** | Commands |
| **Reuse** | Collections, History |
| **A11y** | Provided by workbench |

### SearchInput ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Filter lists |
| **Props** | `value`, `placeholder`, `debounceMs?` |
| **States** | empty, filled, focused |
| **Events** | `onChange`, `onSubmit`, `onClear` |
| **Reuse** | History (InputBox today → inline 🆕), Collections filter 🆕, Response body search 🆕 |
| **A11y** | Label “Search”; Esc clears when focused |

### EmptyState ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Guide next action when no data |
| **Props** | `title`, `body?`, `actions: {id,label,primary?}[]` |
| **States** | default |
| **Events** | `onAction(id)` |
| **Reuse** | Collections welcome, History welcome, empty tables, managers |
| **A11y** | Actions are real buttons |

---

## Collections tree (logical)

### CollectionTree ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Hierarchical collections browser |
| **Props** | snapshot from discovery; multi-select; DnD enabled |
| **States** | loading (refresh), empty, populated, error |
| **Events** | open, run, mutate commands, drop |
| **Reuse** | `apiRunner.collections` |
| **A11y** | Tree keyboard nav via VS Code |

### FolderNode ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Folder in collection |
| **Props** | `name`, `path`, `contextValue`, children |
| **States** | collapsed, expanded, selected, drop-target |
| **Events** | expand, context menu |
| **Reuse** | CollectionTree |
| **A11y** | Accessible name = folder name |

### RequestNode ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Request under folder/collection |
| **Props** | `label`, `method`, `url`, `contextValue` |
| **States** | selected, running? (future) |
| **Events** | open, run |
| **Reuse** | CollectionTree |
| **A11y** | Name includes method + label |

### CollectionNode ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Root collection (native or legacy) |
| **Props** | `name`, `requestCount`, `legacy?` |
| **States** | selected, drop-target |
| **Events** | run, create child, export |
| **Reuse** | CollectionTree |
| **A11y** | Include “Legacy” in description when applicable |

---

## Badges

### MethodBadge ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Show HTTP method |
| **Props** | `method: string` |
| **States** | default |
| **Events** | none |
| **Reuse** | RequestNode description, RequestCard, HistoryCard, Response hero |
| **A11y** | Text content is the method |

### StatusBadge ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | HTTP status or run outcome |
| **Props** | `status?: number`, `outcome?: 'pass'\|'fail'\|'cancel'` |
| **States** | success, redirect, client-error, server-error, cancel |
| **Events** | none |
| **Reuse** | Response, History |
| **A11y** | Include numeric status in accessible name |

### DurationBadge ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Show elapsed time |
| **Props** | `ms: number` |
| **States** | default |
| **Events** | none |
| **Reuse** | Response stats, History |
| **A11y** | Announce human-readable duration |

---

## Request editing

### RequestCard ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Identity fields: name, description, method, URL |
| **Props** | `name`, `description`, `method`, `url` |
| **States** | valid, invalid-url, syncing |
| **Events** | `onChange(partial)` |
| **Reuse** | Request Editor Request tab; New Request (subset) |
| **A11y** | Labeled inputs; method select announced |

### KeyValueTable ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Editable rows for headers/params/vars/form |
| **Props** | `columns`, `rows`, `allowDisable?`, `allowSensitive?` |
| **States** | empty, editing-cell, disabled-row |
| **Events** | `onRowsChange`, `onAdd`, `onRemove` |
| **Reuse** | Params, Headers, Variables, Body form, Env manager |
| **A11y** | Row headers; checkbox labels |

### SectionCard ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Group related fields |
| **Props** | `title`, `children`, `collapsible?` |
| **States** | expanded, collapsed |
| **Events** | `onToggle` |
| **Reuse** | Managers, Request Editor sections |
| **A11y** | Heading level; button for collapse |

### VariableEditor ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Document variables + resolution preview |
| **Props** | `variables`, `previewRows` (masked) |
| **States** | masked, unresolved-highlight |
| **Events** | `onChange`, `onInsertPlaceholder` |
| **Reuse** | Request Editor Variables tab; Variables manager 🆕 |
| **A11y** | Sensitive values announced as “hidden” |

### AssertionBuilder ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Build `expect` lines visually |
| **Props** | `assertions: {target,op,value}[]` |
| **States** | empty, invalid-row |
| **Events** | `onChange` |
| **Reuse** | Request Editor Tests tab |
| **A11y** | Each row fields labeled |

### EnvironmentPicker ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Select active environment |
| **Props** | `environments`, `activeId` |
| **States** | open, closed |
| **Events** | `onSelect(id)` |
| **Reuse** | QuickPick today; Request Editor toolbar 🆕; status bar 🆕 |
| **A11y** | Combobox pattern; active announced |

### AuthPicker ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Select auth profile id (no secrets) |
| **Props** | `profiles`, `selectedId`, `allowNone` |
| **States** | open, missing-secret-warning |
| **Events** | `onSelect(id)`, `onManageProfiles?` |
| **Reuse** | Auth tab; Select Authentication; Auth manager link |
| **A11y** | Warn when secret missing without revealing it |

### BodyModeSelector ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Choose request body representation |
| **Props** | `mode`, `modes: BodyMode[]` |
| **States** | default; confirm-pending when switching would clear content |
| **Events** | `onChange(mode)` |
| **Reuse** | Request Editor Body tab |
| **A11y** | Radiogroup or select with label “Body mode” |

### MultiRequestBanner ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Block unsafe rewrite of multi-request files |
| **Props** | `requestCount`, `message` |
| **States** | visible |
| **Events** | `onOpenText` |
| **Reuse** | Request Editor when N ≠ 1 |
| **A11y** | `role="alert"`; CTA is a button |

### StatusBarChip 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Ambient env/auth identity in status bar |
| **Props** | `kind: 'env'\|'auth'`, `label`, `commandId` |
| **States** | idle, active, missing |
| **Events** | Host command on click |
| **Reuse** | Workbench status bar (Phases 1–3) |
| **A11y** | Accessible name includes kind + label; never secrets |

---

## Response & history

### ResponseTabs ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Switch body modes / sections |
| **Props** | `tabs`, `active` |
| **States** | active tab |
| **Events** | `onChange(tab)` |
| **Reuse** | Response panel (Pretty/Raw; future Headers/Cookies tabs if split) |
| **A11y** | `role="tablist"` |

### JSONViewer ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Expandable JSON tree |
| **Props** | `value`, `expandLevel?` |
| **States** | collapsed, expanded, parse-error→raw |
| **Events** | `onCopyPath?` 🆕 |
| **Reuse** | Response Pretty |
| **A11y** | Tree semantics; keyboard expand |

### HistoryCard ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Summarize a past run |
| **Props** | `method`, `url`, `status`, `durationMs`, `timeLabel`, `outcome` |
| **States** | selected |
| **Events** | `onOpen`, `onRerun`, `onReveal`, `onDelete` |
| **Reuse** | History tree (as TreeItem); Overview panel recent list 🆕 |
| **A11y** | Combined accessible name |

---

## Dialogs & feedback

### ConfirmationDialog ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Confirm destructive action |
| **Props** | `title`, `body`, `confirmLabel`, `danger?` |
| **States** | open |
| **Events** | `onConfirm`, `onCancel` |
| **Reuse** | Deletes, clear history (VS Code modal or webview) |
| **A11y** | Focus trap; Esc cancels |

### SecretPrompt 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Capture a secret into SecretStorage |
| **Props** | `profileId`, `fieldLabel`, `password: true` |
| **States** | open, saving, error |
| **Events** | `onSave(value)` (host only — value never re-enters webview), `onCancel` |
| **Reuse** | Auth manager; OpenAPI secret hints; Code Action |
| **A11y** | Password field; announce “Secret set” / failure without echoing value |

### CollisionResolve ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Resolve name conflicts on import |
| **Props** | `conflicts: string[]` |
| **States** | choosing |
| **Events** | `onRename`, `onOverwrite`, `onCancel` |
| **Reuse** | Import collection / Import Hub / zip |
| **A11y** | Clear choice labels; default Cancel |

### ProgressBanner ✅/🆕

| Field | Detail |
| --- | --- |
| **Purpose** | In-panel progress when not using host progress |
| **Props** | `label`, `cancellable?` |
| **States** | running, cancelling |
| **Events** | `onCancel` |
| **Reuse** | Managers, Import Hub |
| **A11y** | `aria-live="polite"` |

### ErrorCallout ✅

| Field | Detail |
| --- | --- |
| **Purpose** | Show blocking/panel errors |
| **Props** | `message`, `detail?`, `actions?` |
| **States** | visible |
| **Events** | `onAction` |
| **Reuse** | Response failure, managers, Import Hub |
| **A11y** | `role="alert"` |

---

## Planned composite components

### OverviewPanel 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Optional first-run / returning-user orientation (command-opened panel — **not** Activity Bar view) |
| **Props** | env chip, auth chip, recent HistoryCards, quick actions |
| **States** | loading, ready |
| **Events** | navigate commands |
| **Reuse** | Walkthrough / “API Hero: Open Overview” |
| **A11y** | Landmark regions |

### EnvironmentManager 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | CRUD environments + variables |
| **Props** | settings-backed model |
| **States** | dirty, saving, error |
| **Events** | save, setActive, delete |
| **Reuse** | Panel via command |
| **A11y** | List + detail keyboard flow |

### AuthProfileManager 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | CRUD profiles + secret status |
| **Props** | profiles metadata; `secretStatus` map |
| **States** | editing, secret-prompt |
| **Events** | save, setSecret, clearSecret, setDefault |
| **Reuse** | Panel via command |
| **A11y** | Never expose secret values to AT |

### ImportHub 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Choose import source and run pipeline |
| **Props** | `providers: {id,label,enabled}[]` |
| **States** | picking, running, summary |
| **Events** | `onImport(provider)` |
| **Reuse** | Command / welcome |
| **A11y** | Provider cards as buttons |

### CollectionRunReport 🆕

| Field | Detail |
| --- | --- |
| **Purpose** | Tabular multi-request results |
| **Props** | `rows: {name,status,ms,assertions}[]` |
| **States** | filter-failed |
| **Events** | `onOpen`, `onRerun` |
| **Reuse** | After collection run |
| **A11y** | Sortable table headers |

---

## Screen → component map (complete)

| Screen | Primary components |
| --- | --- |
| S01 Collections | CollectionTree, CollectionNode, FolderNode, RequestNode, MethodBadge, SidebarHeader, EmptyState |
| S02 Collections Welcome | EmptyState, ToolbarButton |
| S03 History | HistoryCard, SearchInput, EmptyState, SidebarHeader, StatusBadge, DurationBadge |
| S04 History Welcome | EmptyState |
| S05 History Detail (modal, retiring) | ConfirmationDialog patterns → replaced by S30 |
| S06 Request Editor | Toolbar, ToolbarButton, RequestCard, KeyValueTable, BodyModeSelector, AuthPicker, VariableEditor, AssertionBuilder, EnvironmentPicker, SectionCard, MultiRequestBanner |
| S07 Multi-Request Guard | MultiRequestBanner |
| S08 Text Editor | (workbench + CodeLens; Open Request Editor command) |
| S09 Response | StatusBadge, MethodBadge, DurationBadge, ResponseTabs, JSONViewer, ErrorCallout, Toolbar, ToolbarButton, SearchInput |
| S10 New Request | RequestCard (subset), ConfirmationDialog patterns |
| S11 Collection Run Progress | ProgressBanner / host Progress |
| S12 Failure Policy | QuickPick (host) |
| S13 Switch Environment | EnvironmentPicker |
| S14 Select Auth | AuthPicker |
| S15 Move Request | QuickPick (host) |
| S16 Import/Export folder | OpenDialog (host), CollisionResolve |
| S17 Collision Resolve | CollisionResolve |
| S18 OpenAPI Import | ProgressBanner, ErrorCallout, EmptyState CTAs |
| S19 Settings | VS Code Settings UI |
| S20 Problems | VS Code Problems |
| S21 Output | VS Code Output |
| S22 Delete/Clear confirm | ConfirmationDialog |
| S23 Stubs | — (remove from palette) |
| S24 Overview | OverviewPanel, HistoryCard, EnvironmentPicker, AuthPicker, StatusBarChip |
| S25 Env Manager | EnvironmentManager, KeyValueTable, SectionCard, ConfirmationDialog |
| S26 Variables Manager | VariableEditor, KeyValueTable, SectionCard |
| S27 Auth Manager | AuthProfileManager, AuthPicker, ConfirmationDialog, SecretPrompt |
| S28 Set Secret | SecretPrompt |
| S29 Import Hub | ImportHub, ProgressBanner, ErrorCallout, CollisionResolve |
| S30 History Detail Panel | HistoryCard fields, StatusBadge, DurationBadge, Toolbar, ErrorCallout |
| S31 Collection Run Report | CollectionRunReport, StatusBadge, DurationBadge, SearchInput |
| S32 Walkthrough | VS Code Walkthrough contribution |
| S33 Legacy Migration | ConfirmationDialog, ProgressBanner, EmptyState |
| S34 Zip Import/Export | ImportHub, CollisionResolve, ProgressBanner |

Full screen definitions: [`screen-list.md`](./screen-list.md).

---

## Implementation notes

1. Prefer shared HTML/CSS partials or small TS render helpers per webview family.  
2. Do not introduce React/Vue unless a future decision explicitly adopts a bundler — current stack is vanilla webviews.  
3. Keep props serializable across `postMessage`.  
4. Visual specs live in [`design-system.md`](./design-system.md); do not fork colors per component.  
5. Host-only controls (QuickPick, InputBox, OpenDialog) are still “components” for flow purposes; do not reimplement them in webviews.

---

## Related documents

- [`ui-components.md`](./ui-components.md)  
- [`design-system.md`](./design-system.md)  
- [`interaction-model.md`](./interaction-model.md)  
- [`screen-list.md`](./screen-list.md)  
- [`user-flows.md`](./user-flows.md)  
