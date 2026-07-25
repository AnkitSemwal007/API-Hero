# API Hero v1.0 Production Hardening Audit

**Date:** 2026-07-22  
**Mode:** Production risk review — implement Critical/High only; document Medium/Low.  
**Constraint:** No features, no UI redesign, no speculative refactors.

---

## Critical

| ID | Risk | Status |
| --- | --- | --- |
| C1 | File-watcher / workspace-folder collection refresh used `void discovery.refresh()` without rejection handlers → unhandled promise rejections under scan I/O failures | **Fixed** — `fireAndForget` + logger warnings; initial discovery and watcher paths covered |
| C2 | Request Editor background `handleMessage` / `drainFormApplies` / `postState` could reject without handlers (applyEdit throw, disposed panel) | **Fixed** — `fireAndForget` + webview error reporting; applyEdit try/catch with read-only guidance |

---

## High

| ID | Risk | Status |
| --- | --- | --- |
| H1 | History retention `setMaxEntries` on settings change was `void` without catch | **Fixed** |
| H2 | Language diagnostics refresh was `void` without catch | **Fixed** (best-effort swallow via `fireAndForget`) |
| H3 | Read-only / permission failures during collection CRUD showed generic “check the output log” instead of actionable copy | **Fixed** — `describeFilesystemFailure` maps NoPermissions / EACCES / EROFS |
| H4 | Request Editor applyEdit `false` did not mention read-only | **Fixed** |

---

## Medium (documented — not implemented)

1. **Empty `deactivate()`** — Acceptable: orchestrator/response viewer are on `context.subscriptions` and dispose with the extension host. Documented only.
2. **Collections welcome still lists Manage Env/Auth** — Onboarding CTAs vs thinned toolbar (UX consistency, not crash risk).
3. **Create Folder Cancel keeps the allocated default folder** — **Create Folder** still allocate-then-rename; Cancel leaves the default-named folder on disk (Explorer-like). **Create Collection** is prompt-first: Cancel writes nothing (no temporary collection, no project-store write, no tree refresh).
4. **Env Set Active while dirty** — Host skips full `postInit` when dirty (by design for secret restore); residual edge if external settings change mid-edit.
5. **OpenAPI cancel** — `cancelRequested` polled during import; long blocking FS writes may finish current file before stop (cooperative cancel).
6. **Multi-root pickWorkspaceRoot** — Already prompts; rare confusion when folders lack write access on only some roots.
7. **Corrupt collection marker** — Replaced on next mutate; tree may briefly show odd labels until refresh.
8. **Malformed `.api`** — Parser diagnostics / Request Editor single-request gate already soft-fail; no crash path found.
9. **Malformed OpenAPI** — Wizard surfaces preview/import errors; large specs may stress memory (no hard cap beyond import settings).
10. **History corrupt quarantine** — Already migrates/quarantines to `.bak` with logger warning.

---

## Low (backlog)

1. Historical CHANGELOG “Auth Profiles Manager” wording.
2. Suppressible status presenter export path layering note.
3. Dialog HTML CSS duplication across CRUD dialogs.
4. Coming Soon command stubs remain contributed (`when: false`).
5. Watcher storms on bulk git checkout — single-flight refresh mitigates; optional debounce not required for v1.

---

## Implemented this audit

| Area | Change |
| --- | --- |
| `shared/async.ts` | `fireAndForget` |
| `shared/filesystem-failure.ts` | Actionable FS/permission copy |
| `register-collections.ts` | Safe background refresh/invalidation |
| `extension.ts` | Safe history retention updates |
| `language-providers.ts` | Safe diagnostics refresh |
| `request-editor-provider.ts` | Safe message/apply/postState + read-only apply errors |
| `register-mutation-commands.ts` | Permission-aware mutation errors |

---

## Verification

- `tsc --noEmit` / `npm run compile` — pass  
- New unit tests: `async.test`, `filesystem-failure.test` — pass  

---

## Release recommendation

**Ship v1.0** after this hardening pass.

Remaining Medium/Low items are residual edge-case polish or known platform limits, not activation/crash blockers. Continue monitoring Output channel for “Collections refresh failed” / history retention warnings in the field.
