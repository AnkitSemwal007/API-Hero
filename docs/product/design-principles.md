# API Hero — Design Principles

**Version:** 1.2 (Final Polish)  
**Applies to:** All product surfaces — Activity Bar (Collections + History), editors, webviews, dialogs, settings, notifications

These rules govern UX decisions across roadmap phases. They complement:

- Feeling: [`product-experience.md`](./product-experience.md)  
- Interactions: [`interaction-model.md`](./interaction-model.md)  
- Constraints: [`technical-constraints.md`](./technical-constraints.md)  
- Visuals: [`design-system.md`](./design-system.md)

---

## 1. UI First

**Rule:** The default path for any common task is visual.

| Do | Don't |
| --- | --- |
| Open single-request files in the Request Editor by default | Force beginners into DSL editing for CRUD |
| Provide tables for headers, params, expects | Require memorizing directive syntax for everyday edits |
| Surface Run, Env, Auth in toolbars / title bars | Hide critical actions only in Command Palette |

**Exception:** Multi-request `.api` files and power-user preference for text remain fully supported.

---

## 2. Git First

**Rule:** The workspace filesystem is the collaboration and backup model.

| Do | Don't |
| --- | --- |
| Store requests as `.api` under `Collections/` | Make cloud sync a prerequisite to save work |
| Keep order metadata in `api-hero.collection.json` | Invent a binary collection blob as canonical |
| Generate import output that is PR-reviewable | Scrub away structure users need to diff |

Secrets never belong in Git; use Secret Storage and placeholders.

---

## 3. Native VS Code

**Rule:** Prefer platform patterns over custom chrome.

| Prefer | Avoid unless justified |
| --- | --- |
| TreeView, Custom Text Editor, Settings UI | Full-app SPA shelling the whole product |
| QuickPick / InputBox for short choices | Multi-step modal wizards for one field |
| Problems / Output / Progress / Notifications | Custom toast systems that ignore VS Code a11y |
| ThemeIcon + workbench colors | Hard-coded brand palettes that ignore themes |
| **Two** Activity Bar views + command-opened panels | Long list of permanent sidebar views |

Webviews are for rich content (Request Editor, Response, managers) — not for reinventing the Activity Bar.

---

## 4. No unnecessary dialogs

**Rule:** Ask only when the action is destructive, ambiguous, or irreversible.

| Action | Preferred UX |
| --- | --- |
| Create folder / rename | InputBox or inline rename |
| Delete collection / clear history | Confirm once |
| Run request | Immediate execution |
| Collision on import | Explicit Rename / Overwrite choice |
| Switch environment | QuickPick (persist when product requires) |

Avoid confirmation for Run, Open, Refresh, Reveal.

---

## 5. Minimal clicks

**Rule:** Optimize for the happy path: create → edit → run → inspect.

Targets:

- **First run from empty workspace:** ≤ 4 meaningful actions  
- **Open + run existing request:** ≤ 2 clicks (tree open + Run) or 1 shortcut  
- **Switch environment:** 1 command + 1 selection  

Remove duplicate entry points that diverge in behavior (e.g. create opens text vs tree opens form).

---

## 6. Consistency

**Rule:** Same object, same verbs, same outcomes.

| Domain | Consistency expectation |
| --- | --- |
| Collections | Native CRUD verbs match across title bar, context menu, welcome |
| Run | Same orchestrator whether CodeLens, keybinding, tree, or Request Editor |
| Auth | Profile id in `@auth`, Settings, and Auth tab means the same profile |
| Env | Active environment meaning is one concept (session vs settings must converge) |

Legacy vs native capability differences must be explainable in empty states / tooltips, not silent missing menus.

---

## 7. Predictability

**Rule:** Users should anticipate side effects.

| Predictable | Surprising (fix) |
| --- | --- |
| Form edit updates `.api` buffer | Form silently refuses to write multi-request files (must banner) |
| Session-only switch clearly labeled | Switch Environment looks persistent but isn't |
| Collection run suppresses per-request panels | Random response panels per item |

Document loading, cancellation, and failure policy before they bite.

---

## 8. Fast navigation

**Rule:** Jump between collection, request, response, and history without hunting.

- Reveal Active Request from editor  
- Reveal Original from history  
- Focus Collections / Focus History commands  
- Status / progress that does not steal focus unnecessarily  
- Future: Overview command shortcuts and env indicator on status bar  

---

## 9. Discoverability

**Rule:** Important capabilities appear where users already look.

| Surface | Should advertise |
| --- | --- |
| Welcome views | Create, Import, OpenAPI, Open workspace |
| View title toolbars | Primary verbs for that view |
| Request Editor toolbar | Run, Env, Auth, Open text |
| Editor title / CodeLens | Run / Run Tests |
| Empty states | Next best action, not a blank void |

Hide or demote “Coming Soon” stubs from the Command Palette when they add noise without value.

---

## 10. Visual over text

**Rule:** Prefer structured UI for structured data.

| Data | Preferred presentation |
| --- | --- |
| Headers / params | Tables with enable toggles |
| Assertions | Form rows → `expect` lines |
| Response body | Pretty / Raw / tree for JSON |
| History | Tree with status icons + time groups |
| Auth | Profile picker, not raw secret fields in webview |

Text remains available via Preview tab and Open With Text Editor.

---

## 11. Progressive disclosure

**Rule:** Beginners see the short path; experts can dig deeper.

| Layer | Contents |
| --- | --- |
| Essential | Method, URL, headers, body, Run, status |
| Intermediate | Params, auth profile, env, expects |
| Advanced | Timeouts, multipart/binary, Legacy migration, language toggles, failure policies |
| Expert | Raw `.api`, Output channel log levels, marker JSON |

Do not put advanced failure-policy jargon on the first Run click without a sensible default.

---

## 12. Two-way synchronization

**Rule:** UI and `.api` always reconcile.

1. Form → serialize → WorkspaceEdit into buffer  
2. Buffer change → parse → refresh form  
3. Version guards prevent echo loops and stale overwrites  
4. If parse fails, preserve user text; show diagnostics; do not clobber  

Never keep a long-lived “UI-only” model that can diverge from disk.

---

## 13. Accessibility & inclusion

**Rule:** Meet VS Code accessibility baselines.

- Keyboard: all primary actions reachable without pointer  
- Screen reader: tree labels include method/status where relevant  
- Contrast: use theme tokens; avoid low-contrast custom CSS  
- Motion: no essential info only in animation  
- Focus: webviews manage focus on open; dialogs restore focus on close  

Details: [`interaction-model.md`](./interaction-model.md) § Accessibility.

---

## 14. Feedback & error honesty

**Rule:** Every async action has a start, progress, and terminal state.

| Outcome | Pattern |
| --- | --- |
| Success | Quiet status bar or brief info; keep response panel primary |
| Partial | Warning with counts (collection runs, OpenAPI) |
| Failure | Error notification + actionable message; Output for detail |
| Cancel | Acknowledge; leave workspace consistent |

Never swallow mutation failures. Never claim cookies/OAuth work when stubbed.

---

## 15. Security by design (UX)

**Rule:** Convenience must not leak secrets.

- Mask sensitive variables in UI, hover, diagnostics, history  
- Auth webviews show profile ids only  
- History stores metadata, not bodies/credentials  
- Confirm before destructive deletes that remove many files  

---

## Principle conflicts — resolution order

When principles conflict, resolve in this order:

1. **Security / secrets**  
2. **Canonical `.api` integrity**  
3. **Predictability**  
4. **UI First / minimal clicks**  
5. **Visual polish**

Example: Prefer a confirm dialog on delete collection (security of user data) over one-click delete (minimal clicks).

---

## Applying principles in reviews

Use this checklist for any new screen or flow:

- [ ] Can a new user complete it without reading `.api` grammar docs?  
- [ ] Does it write/read only through parser-compatible serialization?  
- [ ] Are VS Code native controls used where sufficient?  
- [ ] Is there at most one confirmation, and only if needed?  
- [ ] Are loading and error states defined?  
- [ ] Are secrets excluded from the surface?  
- [ ] Does keyboard access work?  
- [ ] Does it match existing verbs for the same object type?  

---

## Related documents

- [`product-experience.md`](./product-experience.md)  
- [`vision.md`](./vision.md)  
- [`interaction-model.md`](./interaction-model.md)  
- [`design-system.md`](./design-system.md)  
- [`ui-components.md`](./ui-components.md)  
- [`component-library.md`](./component-library.md)  
- [`ux-review.md`](./ux-review.md)  
