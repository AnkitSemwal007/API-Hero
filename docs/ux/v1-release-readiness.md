# API Hero v1.0 Release Readiness Review

**Date:** 2026-07-22  
**Mode:** Staff production review — fix Critical/High only; document Medium/Low pending approval.  
**Source of truth:** Implementation (not aspirational docs).

---

## Critical Issues (must fix before release)

| ID | Issue | Status |
| --- | --- | --- |
| C1 | Run Request (Ctrl/Cmd+Alt+R, palette, menus) failed when Request Editor (default custom editor) had focus — only `activeTextEditor` + `editorTextFocus` | **Fixed** — active Request Editor tracker; keybinding/context `when` includes `activeCustomEditorId == 'apiRunner.requestEditor'`; webview Ctrl/Cmd+Alt+R |
| C2 | Reveal Active Request ignored Request Editor | **Fixed** — same tracker; first-request fallback for custom editor |
| C3 | History tree delete without confirm | **Already fixed** (prior polish) |
| C4 | Variable scope “Document” vs “Request” glossary | **Already resolved** — product term **Request** |

---

## High Issues (strongly recommended)

| ID | Issue | Status |
| --- | --- | --- |
| H1 | Env Manager Set Active optimistic UI without rollback | **Fixed** — pending/previous + `activeEnvironmentSet` ack + distinct error channel |
| H2 | Request Editor variable preview showed raw codes `(MISSING_VARIABLE)` | **Fixed** — human `error.message` |
| H3 | Auth panel titled “Auth Profiles Manager” vs command “Manage Authentication” | **Fixed** — titles aligned (command IDs unchanged) |
| H4 | `console.warn` in history quarantine path | **Fixed** — injectable `onWarning` → logger |
| H5 | Auth QuickPick missing Manage… escape hatch | **Already fixed** (prior polish) |
| H6 | “Recent Requests” aliased History | **Already fixed** → **Open History** |
| H7 | Filter icon mismatch | **Already fixed** → `$(filter)` |
| H8 | Collections toolbar IA dump | **Fixed** — lean navigation + overflow; shell actions via palette/Overview |
| H9 | Uneven CRUD success toasts | **Fixed** — status-bar success pattern |
| H10 | Filter Collections still InputBox vs History QuickPick | **Fixed** — copy/behavior aligned; History facets kept |

---

## Medium Issues (can ship if necessary — **awaiting approval**)

1. **Collections `view/title` overload** — **Resolved** in v1 polish (lean nav + overflow).
2. **CRUD success feedback rule** — **Resolved** (status-bar success pattern).
3. **Filter UX siblings** — **Resolved** (copy aligned; History facets kept).
4. **Empty-state voice** — Collections welcome overloads managers; trim CTAs to create/import; managers via Overview.
5. **Request Editor chip vs tab labels** — Align chip `title`/`aria-label` exactly to command titles.
6. **Status bar competition** — **Resolved** (suppressible request status presenter during collection runs).
7. **Delete copy** — Prefer request display name over `Foo.api` file wording.
8. **Env/Auth in-panel delete** — Applies only after Save; no modal (unlike tree deletes).
9. **History Detail raw `errorCode`** — Prefer human status text when message exists.
10. **Docs leftovers** — Historical CHANGELOG may still say “Auth Profiles Manager”; user-facing strings/docs aligned to Manage Authentication.
11. **Create Folder Cancel keeps default name** — Allocate-then-rename residual (Explorer-like). **Create Collection** Cancel is prompt-first and side-effect free (resolved).

---

## Low Issues (backlog — **awaiting approval**)

1. Toast `API Hero:` prefix consistency across History/runner.
2. “Open Text” button → “Open Text Editor”.
3. Coming Soon commands remain contributed but palette-hidden (acceptable if IDs must stay stable).
4. Minor Auth tab vs chip wording.
5. Extract shared dialog CSS / destination types (maintainability, not user-facing).
6. HTTP DELETE method icon shares trash metaphor with delete actions.

---

## UX Findings

- **Default path is now first-class for Run/Reveal** after C1/C2 — largest prior friction for Request Editor users.
- **Destructive deletes** confirm on Collections + History tree/Detail.
- **Session switchers** (Env/Auth QuickPicks) both offer Manage… escape hatches.
- **Variable discoverability** (precedence legend, Request/Environment/Workspace/Global labels) is in place; do not flip glossary back to “Document”.
- Remaining friction is mostly **menu density** and **feedback consistency**, not missing capabilities.

---

## Accessibility Findings

- Env Manager: Environments vs Scopes listboxes, `aria-current` on active env, live active strip.
- Auth Manager: aside/list empty-state aria improved in polish.
- Request Editor: run group label; variable completion keyboard (arrows/Enter/Tab/Esc/Ctrl+Space).
- **Residual (Medium):** two Env listboxes could use a documented keyboard model; emoji scope icons are secondary to text labels (acceptable).

---

## Performance Findings

- No objective Critical/High performance regressions found in this pass.
- History corrupt path no longer uses `console.warn` (logger only).
- Large-collection / large-response paths unchanged; do not optimize without evidence.
- Request Editor retains context when hidden (`retainContextWhenHidden`) — intentional for sync; not a leak if dispose on panel close (verified).

---

## Consistency Findings

| Area | State |
| --- | --- |
| Run / Reveal | Aligned for text + Request Editor |
| Delete confirms | Aligned Collections + History |
| Auth naming | Aligned to Manage Authentication |
| Variable scopes | Aligned to Request / Environment / Workspace / Global |
| Filters | Icons aligned; interaction dialects remain (Medium) |
| CRUD dialogs | Name/destination webviews; secrets/OS pickers correctly native |
| Collections toolbar | Still dense (Medium) |
| Success toasts | Uneven (Medium) |

---

## Release Readiness Assessment

**Verdict: Conditionally ready for v1.0** after Critical/High fixes landed and verified (`tsc` clean; focused tests pass; staff review ✅).

Ship blockers from this review are **cleared**. Remaining Medium/Low items are polish debt that can ship if necessary; recommend scheduling M1–M3 (toolbar, toast rule, filter interaction) in a fast follow if bandwidth allows.

### What was implemented this review

- Active Request Editor document tracker + Run/Reveal/keybinding/webview shortcut
- Env Set Active rollback + ack (+ distinct error channel hardening)
- Human-readable variable preview errors
- Auth panel/H1/QuickPick title alignment
- History store warning injection → logger

### Do not do before v1.0 without approval

- New features (workspace ZIP export, `.apihero` layout, etc. — proposals only)
- Architecture redesigns / speculative refactors
- Medium/Low list above (awaiting explicit approval)
