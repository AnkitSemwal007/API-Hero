# API Hero — Interaction Model

**Version:** 1.2 (Final Polish)  
**Purpose:** Consistent interaction rules across trees, editors, webviews, and dialogs.  
**Feeling:** [`product-experience.md`](./product-experience.md) · **Visuals:** [`design-system.md`](./design-system.md)

---

## 1. Pointer interactions

### Single click

| Target | Result |
| --- | --- |
| Collection / folder | Select; expand/collapse chevron as VS Code default |
| Request node | Open request (Request Editor if single-request; else text) |
| History entry | Open detail (panel when available; modal today) |
| Toolbar icon | Run bound command |
| Tab | Switch Request Editor / response mode |

### Double click

| Target | Result |
| --- | --- |
| Request | Same as single click open (no alternate “edit mode”) |
| Folder | Expand/collapse (VS Code default) |
| Editable table cell (webview) | Enter edit if not already focused |

**Rule:** Do not bind destructive actions to double click.

### Right click

| Target | Result |
| --- | --- |
| Tree node | Context menu for that `contextValue` |
| Editor (`.api`) | Editor context: Run, Reveal |
| Webview | Prefer visible buttons; custom context menus sparingly |

### Drag

| Gesture | Result |
| --- | --- |
| Drag request/folder (native) | Move or reorder per DnD controller |
| Drag collection (native) | Reorder among collections |
| Drop on Legacy / invalid | No-op; no error toast spam |
| Drag history | Not supported |

**Rule:** DnD and Move command must produce the same filesystem outcome.

---

## 2. Keyboard shortcuts

### Shipped

| Shortcut | Command | When |
| --- | --- | --- |
| `Ctrl+Alt+R` / `Cmd+Alt+R` | Run Request | `editorLangId == api && editorTextFocus` |

### Planned standard set

| Shortcut | Command | Notes |
| --- | --- | --- |
| Same Run binding | Also when Request Editor focused | Ensure custom editor focus context |
| `Ctrl+Alt+E` | Switch Environment | Conflict-check before ship |
| `Ctrl+Alt+A` | Select Authentication | Conflict-check |
| `F2` | Rename | Prefer VS Code tree rename if enabled |
| `Delete` | Delete with confirm | Tree focus |
| `/` or `Ctrl+F` | Search History / in-response search | Context-specific |

**Rule:** Never override core VS Code chords (`Ctrl+P`, `Ctrl+Shift+P`, etc.).

---

## 3. Toolbar behavior

| Rule | Detail |
| --- | --- |
| Primary left, secondary right | Match VS Code view title patterns |
| Icons need tooltips | Always set `title` / command title |
| Destructive not in title by default | Clear History is OK with confirm; Delete stays context |
| Disable when invalid | Grey Run when no request selectable |
| One Run affordance visible | Editor title / form toolbar / CodeLens may coexist but must call same orchestrator |

---

## 4. Inline editing

| Surface | Rule |
| --- | --- |
| Request Editor fields | Debounced sync to `.api`; no Save button required (document dirty state is VS Code’s) |
| Tables | Enter commits cell; Esc cancels cell edit |
| Tree rename | InputBox or inline rename; validates non-empty / illegal path chars |
| Preview tab | Read-only; edits happen in other tabs or text editor |

**Rule:** No separate “Apply” for form vs file — the buffer is the commit.

---

## 5. Dialogs

| Type | When allowed |
| --- | --- |
| InputBox | Single string (name) |
| QuickPick | Choose one of many |
| Confirm modal | Destructive / irreversible |
| Webview dialog | Multi-field create (New Request) or complex managers |
| Open/Save dialog | Filesystem paths |

**Rules:**

1. Never stack dialogs.  
2. Prefer QuickPick over webview for ≤1 field decisions.  
3. Esc cancels; Enter confirms primary.  
4. Restore focus to invoking view/editor on close.

---

## 6. Confirmation rules

| Action | Confirm? |
| --- | --- |
| Delete request/folder/collection | Yes |
| Clear history | Yes |
| Overwrite on import collision | Yes (explicit choice) |
| Run request | No |
| Switch env/auth | No |
| Refresh | No |
| Duplicate | No |
| Mode switch that clears body | Yes if non-empty content would be lost |

Confirm copy must name the object and consequence (“Delete collection **Payments** and all requests?”).

---

## 7. Loading

| Operation | Pattern |
| --- | --- |
| Single run | `withProgress` + status bar |
| Collection run | Progress with item counts; cancellable |
| OpenAPI import | Notification progress; cancellable |
| Tree refresh | Silent if fast; no full-screen blocker |
| Manager load 🆕 | Skeleton inside panel |

**Rules:**

- Never block the entire workbench.  
- Cancellation leaves partial collection runs in a defined state (completed items kept in history; in-flight aborted).  
- Do not open Response panel for cancelled runs.

---

## 8. Error handling

| Layer | Behavior |
| --- | --- |
| Validation (form) | Inline message; block submit |
| Parse errors | Diagnostics on document; form may show banner |
| Resolution (vars/auth) | Diagnostics + run failure with actionable text |
| Transport | Error card in Response / notification |
| Mutation FS errors | Error notification with reason; tree unchanged |
| Unexpected | Log to Output; user-facing generic + hint to Output |

**Rule:** Prefer actionable errors (“Auth profile `prod` secret missing”) over stack traces in toasts.

---

## 9. Notifications

| Severity | Use |
| --- | --- |
| Info | Success summaries; guidance |
| Warning | Partial success; cancelled; capability limits (Legacy) |
| Error | Hard failures |

**Rules:**

- Don’t notify on every successful single run if Response panel is open (status bar enough).  
- Do notify collection run completion.  
- Coming Soon stubs should not remain as Info noise — hide or implement.

---

## 10. Selection & multi-selection

| View | Selection model |
| --- | --- |
| Collections | Multi-select for Run Selected; context acts on focused/selected per VS Code norms |
| History | Single selection |
| Request Editor | N/A (document-centric) |

**Rules:**

- Run Selected uses multi-select when >1; single selection runs one.  
- Destructive bulk delete is out of scope until explicitly designed.  
- Clear visual selection vs highlight for reveal.

---

## 11. Reveal & focus

| Command | Behavior |
| --- | --- |
| Reveal Active Request | Expand parents; select node; focus Collections |
| Reveal Original (history) | Open document; reveal tree node |
| Focus Collections / History | Focus view without mutating data |

**Rule:** Reveal should not steal focus from Response if user is inspecting results unless explicitly Reveal.

---

## 12. Synchronization interactions

| Event | UX |
| --- | --- |
| User types in form | Debounced write; document becomes dirty |
| User types in text | Form refreshes; unsaved form field edits may drop if stale (version guard) — show subtle “reloaded from file” if disruptive 🆕 |
| External disk change | Discovery refresh; open editors follow VS Code file events |
| Conflict (parse fail after edit) | Keep text; show errors; don’t auto-revert |

---

## 13. Accessibility

| Requirement | Application |
| --- | --- |
| Keyboard operability | All tree commands via palette/menus; webview tab order logical |
| Screen reader labels | Tree labels include method/status; buttons aria-label |
| Focus visible | Use VS Code focus styles; don’t remove outlines |
| Contrast | Theme tokens only |
| Reduced motion | No essential timed animation |
| Secrets | Never announce secret values; say “Secret set” / “Missing” |

Webviews must include a skip path back to workbench (Esc closes panel where appropriate).

---

## 14. Custom Editor vs Text

| Gesture | Request Editor | Text |
| --- | --- | --- |
| Open from tree (single) | Preferred | Fallback |
| Open from tree (multi) | Banner / refuse rewrite | Preferred |
| Run | Toolbar button | CodeLens / shortcut / context |
| Format | N/A (serialize pretty enough) | User formatting |

**Rule:** Switching editors never forks content — both bind to the same `TextDocument`.

---

## 15. Consistency with VS Code

Mirror familiar IDE behaviors:

- Explorer-like tree for Collections  
- Problems for issues  
- Output for logs  
- Settings for persistence  
- Progress for long tasks  

When unsure, copy VS Code Explorer / Testing / SCM patterns rather than Postman desktop patterns.

---

## Related documents

- [`product-experience.md`](./product-experience.md)  
- [`design-principles.md`](./design-principles.md)  
- [`design-system.md`](./design-system.md)  
- [`ui-components.md`](./ui-components.md)  
- [`component-library.md`](./component-library.md)  
- [`user-flows.md`](./user-flows.md)  
