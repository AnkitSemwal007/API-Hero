# API Hero — Gap Analysis

**Version:** 1.2 (Final Polish)  
**Method:** Compare current 0.5.x behavior (code + `docs/ux/api-hero-ui-inventory.md`) to the UI-first vision in [`vision.md`](./vision.md) / [`north-star.md`](./north-star.md).

**Priority:** P0 / P1 / P2 / P3  
**Risk:** Low / Medium / High  
**IA:** Managers are panels — do not close discoverability gaps by adding Activity Bar views.

---

## G01 — Dual edit surfaces without clear default

| Field | Content |
| --- | --- |
| **Current behavior** | Custom editor priority `option`; tree open uses form for single-request; New Request opens text |
| **Desired behavior** | Single-request happy path always opens Request Editor; text via Open With / power-user setting |
| **Priority** | P0 |
| **Suggested approach** | Align `openCollectionRequest`, createRequest open, and optionally custom editor `priority`; document in README |
| **Files likely involved** | `src/collections/vscode/navigation-service.ts`, `new-request-dialog.ts`, `package.json`, `register-request-editor.ts` |
| **Risk** | Low–Medium (text-first users need escape hatch) |

---

## G02 — Session vs settings for environment

| Field | Content |
| --- | --- |
| **Current behavior** | `switchEnvironment` is session-only; `apiRunner.activeEnvironment` may diverge |
| **Desired behavior** | One active environment concept; UI switch persists; restart restores |
| **Priority** | P0 |
| **Suggested approach** | Write setting on switch; initialize session from setting on activate; show active in status bar |
| **Files likely involved** | `switch-environment-command.ts`, `document-variable-adapter.ts`, `vscode-settings-provider.ts`, `settings.ts` |
| **Risk** | Medium (behavior change) |

---

## G03 — Session vs settings for auth

| Field | Content |
| --- | --- |
| **Current behavior** | Select Authentication updates session default only |
| **Desired behavior** | Optional persist default profile; `@auth` still overrides; manager for CRUD |
| **Priority** | P1 |
| **Suggested approach** | Add explicit “Set as default” ; keep session override for ephemeral use |
| **Files likely involved** | auth selection command, settings schema, auth resolution |
| **Risk** | Medium |

---

## G04 — No Environments / Variables manager UI

| Field | Content |
| --- | --- |
| **Current behavior** | Edit via Settings JSON arrays |
| **Desired behavior** | Visual managers for CRUD + sensitive flags |
| **Priority** | P0 |
| **Suggested approach** | Webview **panel** (command-opened) reading/writing existing settings keys; reuse variable types — **not** an Activity Bar view |
| **Files likely involved** | new `src/environments/vscode/` or `src/variables/vscode/manager*`, `package.json` views/commands |
| **Risk** | Low (settings schema stable) |

---

## G05 — Auth profile & secret setup is JSON-heavy

| Field | Content |
| --- | --- |
| **Current behavior** | Profiles in settings; secrets via SecretStorage without wizard |
| **Desired behavior** | Auth Profiles Manager + Set Secret prompt; never show secret values |
| **Priority** | P0 |
| **Suggested approach** | Webview **panel** for metadata; InputBox password → SecretStorageService — **not** Activity Bar |
| **Files likely involved** | `src/auth/**`, `secret-storage-service.ts`, new vscode manager, OpenAPI hint CTAs |
| **Risk** | Low |

---

## G06 — History detail is a modal

| Field | Content |
| --- | --- |
| **Current behavior** | `showInformationMessage` for open entry |
| **Desired behavior** | Structured History Detail panel (S30) |
| **Priority** | P0 |
| **Suggested approach** | Webview similar to response metadata sections; actions re-run/reveal |
| **Files likely involved** | `src/history/vscode/**`, new HTML builder |
| **Risk** | Low |

---

## G07 — Response viewer lacks copy/save/search

| Field | Content |
| --- | --- |
| **Current behavior** | Pretty/Raw only; no clipboard/FS/find |
| **Desired behavior** | Copy body/headers; save body; search in body |
| **Priority** | P0 |
| **Suggested approach** | Extend webview message protocol carefully; host performs clipboard/FS |
| **Files likely involved** | response webview HTML/provider under `src/**/response**` |
| **Risk** | Low (CSP/message allowlist changes) |

---

## G08 — Coming Soon commands in palette

| Field | Content |
| --- | --- |
| **Current behavior** | Run File, Login, Logout show Coming Soon |
| **Desired behavior** | Implement Run File; hide Login/Logout until real; or implement OAuth later |
| **Priority** | P1 |
| **Suggested approach** | `enablement`/`when` false or remove from palette menus; keep command ids registered |
| **Files likely involved** | `placeholder-commands.ts`, `package.json` menus |
| **Risk** | Low |

---

## G09 — Legacy vs native capability split

| Field | Content |
| --- | --- |
| **Current behavior** | Same tree; fewer menus on Legacy; easy confusion |
| **Desired behavior** | Clear labeling + migration assistant; encourage native |
| **Priority** | P2 |
| **Suggested approach** | Badge “Legacy” in description; command Migrate to Collections/ |
| **Files likely involved** | tree provider, mutation, new migration helper |
| **Risk** | Medium (moves files) |

---

## G10 — Collection failure policy easy to miss

| Field | Content |
| --- | --- |
| **Current behavior** | QuickPick each run |
| **Desired behavior** | Sensible default + setting + optional prompt |
| **Priority** | P1 |
| **Suggested approach** | Config `apiRunner.collectionRunner.failurePolicy`; prompt only if “ask” |
| **Files likely involved** | `register-collection-runner.ts`, `package.json` configuration |
| **Risk** | Low |

---

## G11 — No editor title Run button

| Field | Content |
| --- | --- |
| **Current behavior** | CodeLens / keybinding / context |
| **Desired behavior** | Editor title menu Run for `.api` / Request Editor |
| **Priority** | P1 |
| **Suggested approach** | Contribute `editor/title` menus |
| **Files likely involved** | `package.json` |
| **Risk** | Low |

---

## G12 — Multi-request files second-class in form

| Field | Content |
| --- | --- |
| **Current behavior** | Banner; no rewrite |
| **Desired behavior** | Keep safety; optional request picker to edit one request block 🆕 |
| **Priority** | P2 |
| **Suggested approach** | Phase later: select request index → project slice → serialize only that block carefully |
| **Files likely involved** | request-editor, request-source, parser |
| **Risk** | High if naive rewrite — defer until solid design |

---

## G13 — Cookies stub

| Field | Content |
| --- | --- |
| **Current behavior** | Placeholder section |
| **Desired behavior** | Real cookie jar or hide section until ready |
| **Priority** | P2 |
| **Suggested approach** | Hide stub short-term; implement jar in Phase 6 |
| **Files likely involved** | response presentation, execution |
| **Risk** | Medium when implementing jar |

---

## G14 — Import collection folder-only

| Field | Content |
| --- | --- |
| **Current behavior** | Folder copy; no zip |
| **Desired behavior** | Zip import/export |
| **Priority** | P2 |
| **Suggested approach** | Extend transfer module with zip |
| **Files likely involved** | `src/collections/transfer/**` |
| **Risk** | Low |

---

## G15 — No Postman / Insomnia import

| Field | Content |
| --- | --- |
| **Current behavior** | OpenAPI only |
| **Desired behavior** | Import Hub with Postman first |
| **Priority** | P1 |
| **Suggested approach** | New provider writing `.api` via request-source/serialize; registry already open |
| **Files likely involved** | `src/openapi-import/**` or sibling import package |
| **Risk** | Medium (mapping fidelity) |

---

## G16 — No Code Actions

| Field | Content |
| --- | --- |
| **Current behavior** | Diagnostics without quick fixes |
| **Desired behavior** | Actions: add `@auth`, create expect, set secret CTA |
| **Priority** | P1 |
| **Suggested approach** | `CodeActionProvider` in language-support |
| **Files likely involved** | `src/language-support/**` |
| **Risk** | Low |

---

## G17 — Built-in variables unsupported

| Field | Content |
| --- | --- |
| **Current behavior** | `$uuid` / `$timestamp` recognized as unsupported |
| **Desired behavior** | Resolve built-ins |
| **Priority** | P2 |
| **Suggested approach** | Extend variable resolver |
| **Files likely involved** | `src/variables/**` |
| **Risk** | Low |

---

## G18 — Multipart / binary body gaps

| Field | Content |
| --- | --- |
| **Current behavior** | Non-empty multipart / binary → `UNSUPPORTED_BODY` |
| **Desired behavior** | Full construction from Request Editor |
| **Priority** | P1 |
| **Suggested approach** | Executor multipart builder + serialize fidelity |
| **Files likely involved** | `src/execution/**`, request-source body, request-editor Body tab |
| **Risk** | Medium |

---

## G19 — Run File stub

| Field | Content |
| --- | --- |
| **Current behavior** | Coming Soon |
| **Desired behavior** | Run all requests in current document |
| **Priority** | P1 |
| **Suggested approach** | Reuse collection-runner sequencing on in-memory request list |
| **Files likely involved** | `placeholder-commands.ts`, collection-runner, orchestration |
| **Risk** | Low |

---

## G20 — OAuth / Login-Logout absent

| Field | Content |
| --- | --- |
| **Current behavior** | Placeholder commands |
| **Desired behavior** | Real OAuth2 providers + Login/Logout semantics |
| **Priority** | P2 (P3 until managers exist) |
| **Suggested approach** | After Auth Manager (Phase 3); URI handler / device code |
| **Files likely involved** | `src/auth/**`, extension activation, secrets |
| **Risk** | High |

---

## G21 — No Overview / walkthrough

| Field | Content |
| --- | --- |
| **Current behavior** | Welcome views only |
| **Desired behavior** | Walkthrough + optional Overview **command/panel** (not Activity Bar view) |
| **Priority** | P1 |
| **Suggested approach** | `contributes.walkthroughs` + command-opened OverviewPanel |
| **Files likely involved** | new overview module, `package.json` |
| **Risk** | Low |

---

## G22 — Marketplace assets incomplete

| Field | Content |
| --- | --- |
| **Current behavior** | Icon ready; screenshots/banner incomplete |
| **Desired behavior** | Full Marketplace listing assets |
| **Priority** | P1 |
| **Suggested approach** | Capture EDH screenshots per `docs/release/marketplace-assets.md` |
| **Files likely involved** | `README.md`, `docs/marketplace/**`, package media |
| **Risk** | None (docs/assets) |

---

## G23 — No collection-scoped variables

| Field | Content |
| --- | --- |
| **Current behavior** | Global/workspace/env/document only |
| **Desired behavior** | Optional collection-level vars in marker or sidecar |
| **Priority** | P2 |
| **Suggested approach** | Extend marker / vars precedence carefully |
| **Files likely involved** | marker, variables, discovery |
| **Risk** | Medium (precedence changes) |

---

## G24 — Advanced assertions missing

| Field | Content |
| --- | --- |
| **Current behavior** | Core `expect` kinds only |
| **Desired behavior** | Schema / snapshot / scripts later |
| **Priority** | P3 |
| **Suggested approach** | Additive grammar + engine |
| **Files likely involved** | `src/assertions/**`, parser |
| **Risk** | Medium |

---

## G25 — Duplicate move pathways without shared feedback

| Field | Content |
| --- | --- |
| **Current behavior** | DnD and Move QuickPick both exist; refresh lacks dirty indicator |
| **Desired behavior** | Same outcome; subtle tree refresh affordance OK |
| **Priority** | P3 |
| **Suggested approach** | Share transfer service (already); unify success toasts |
| **Files likely involved** | DnD controller, move command |
| **Risk** | Low |

---

## Gap priority summary

| Priority | Gaps |
| --- | --- |
| P0 | G01, G02, G04, G05, G06, G07 |
| P1 | G03, G08, G10, G11, G15, G16, G18, G19, G21, G22 |
| P2 | G09, G12, G13, G14, G17, G20, G23 |
| P3 | G24, G25 |

## Gap → roadmap index

| Gap | Priority | Phase | Screens |
| --- | --- | --- | --- |
| G01 Dual edit default | P0 | 1 | S06, S08, S10 |
| G02 Env session vs settings | P0 | 2 | S13, S25 |
| G03 Auth session vs settings | P1 | 3 | S14, S27 |
| G04 Env/Vars manager | P0 | 2 | S25, S26 |
| G05 Auth manager + secrets | P0 | 3 | S27, S28 |
| G06 History detail modal | P0 | 4 | S05 → S30 |
| G07 Response copy/save/search | P0 | 1 | S09 |
| G08 Coming Soon stubs | P1 | 1 / 9 | S23 |
| G09 Legacy labeling | P2 | 8 | S01, S33 |
| G10 Failure policy discoverability | P1 | 4 | S12 |
| G11 Editor title Run | P1 | 1 | S08, S06 |
| G12 Multi-request form picker | P2 | later | S07 |
| G13 Cookies stub | P2 | 6 | S09 |
| G14 Zip transfer | P2 | 5 | S34 |
| G15 Postman/Insomnia import | P1 | 5 / 10 | S29 |
| G16 Code Actions | P1 | 7 | S20 |
| G17 Built-in variables | P2 | 7 | S06 Variables |
| G18 Multipart/binary | P1 | 6 | S06 Body |
| G19 Run File | P1 | 6 | S23 → command |
| G20 OAuth | P2 | 9 | S27 |
| G21 Overview / walkthrough | P1 | 5 (walkthrough) / 8 (Overview) | S32, S24 |
| G22 Marketplace assets | P1 | 5 | — |
| G23 Collection-scoped vars | P2 | later | — |
| G24 Advanced assertions | P3 | 7 / 10 | S06 Tests |
| G25 Move pathway feedback | P3 | polish | S01 |

Map to delivery: [`roadmap.md`](./roadmap.md) Phases 1–6 cover all P0/P1 engine+UX gaps (walkthrough/assets in Phase 5; Overview command in Phase 8).

---

## Related documents

- [`roadmap.md`](./roadmap.md)  
- [`feature-matrix.md`](./feature-matrix.md)  
- [`north-star.md`](./north-star.md)  
- [`ux-review.md`](./ux-review.md)  
- [`information-architecture.md`](./information-architecture.md)  
- [`../ux/api-hero-ui-inventory.md`](../ux/api-hero-ui-inventory.md)  
