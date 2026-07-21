# API Hero — Feature Matrix

**Version:** 1.2 (Final Polish)  
**Roadmap:** Every planned row maps to a phase in [`roadmap.md`](./roadmap.md).  
**North Star:** v1.0 bar in [`north-star.md`](./north-star.md).

**Status legend**

| Status | Meaning |
| --- | --- |
| **Done** | Shipped and usable in 0.5.x |
| **Partial** | Present with material gaps |
| **Planned** | Specified for roadmap; not shipped |
| **Stub** | Command/UI placeholder (“Coming Soon”) |
| **Deferred** | Explicitly out of near-term scope |

**Priority:** P0 (vision-critical) · P1 (high user value) · P2 (important) · P3 (later) · P4 (exploratory)

**IA note:** Env/Auth/Variables managers are **panels**, not Activity Bar views.

---

## 1. Editing & language

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| `.api` language (TextMate) | Done | Done | P0 | Parser | Grammar `source.api-runner` stable |
| Language configuration / snippets | Done | Done | P1 | — | |
| Completions | Done | Done | P1 | Parser, variables, auth | |
| Hover | Done | Done | P2 | Setting toggle | |
| Diagnostics (parse/vars/auth) | Done | Done | P0 | Language providers | |
| Outline / folding | Done | Done | P2 | Setting toggles | |
| CodeLens Run / Run Tests | Done | Done | P0 | Orchestrator, assertions | |
| Code Actions | Planned | Done | P1 | Diagnostics | Add `@auth`, insert expect, etc. |
| Text editor editing | Done | Done | P0 | — | Power-user path |
| Request Editor (Custom Text Editor) | Done | Done | P0 | request-source | Single-request only |
| Request Editor default open | Partial | Done | P0 | package.json priority / navigation | Today `option`; create opens text |
| Multi-request form editing | Partial | Partial / picker | P2 | Parser | Banner + Open With Text; optional request picker later |
| Preview tab (raw text) | Done | Done | P1 | Request Editor | |
| Bidirectional form ↔ `.api` sync | Done | Done | P0 | request-source | MUST NOT BREAK |
| Editor title Run button | Planned | Done | P1 | Menus | Today CodeLens/keybinding |
| Walkthrough / Getting Started | Planned | Done | P1 | package.json | |

---

## 2. Request model (form tabs)

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Method / URL / name / description | Done | Done | P0 | serialize | |
| Query params table | Done | Done | P0 | URL sync | |
| Headers table + enable/disable | Done | Done | P0 | Comment-out disabled | |
| Body: none/json/text/form/raw | Done | Done | P0 | Executor | |
| Body: multipart (empty) | Partial | Done | P1 | Executor | Non-empty → UNSUPPORTED today |
| Body: binary upload | Partial | Done | P1 | Executor | |
| Auth profile selector | Done | Done | P0 | Auth profiles | No secrets in webview |
| Variables tab + preview | Done | Done | P0 | Variables engine | Sensitive masked |
| Tests → `expect` lines | Done | Done | P0 | Assertions | |
| Settings `@timeout` | Done | Done | P2 | Grammar | |
| Additional directives UI | Planned | Done | P3 | Grammar | Only existing directives |
| Cookies request UI | Deferred | Deferred | P3 | Cookie jar | |

---

## 3. Execution & response

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Run single request | Done | Done | P0 | Orchestrator | Ctrl/Cmd+Alt+R |
| Run with assertions | Done | Done | P0 | Assertions | |
| Cancel in-flight request | Done | Done | P0 | Executor | |
| Timeouts / max bytes | Done | Done | P0 | Settings | |
| Redirect following | Done | Done | P1 | Transport | |
| Response webview | Done | Done | P0 | response module | |
| Pretty / Raw body | Done | Done | P0 | — | |
| JSON tree | Done | Done | P1 | — | |
| Response headers view | Done | Done | P0 | Masking | |
| Assertions section in response | Done | Done | P0 | — | |
| Response timings (duration) | Done | Done | P1 | — | Waterfall later P3 |
| Copy body/headers | Planned | Done | P0 | Webview messages | High UX gap |
| Save / download body | Planned | Done | P1 | FS dialog | |
| Search in body | Planned | Done | P1 | Webview | |
| Cookies section | Stub | Done | P2 | Cookie jar | Placeholder copy today |
| Redirect chain UI | Planned | Done | P2 | Transport metadata | |
| Streaming responses | Deferred | Deferred | P4 | Transport | |
| GraphQL / WS / gRPC | Deferred | Deferred | P4 | New engines | |

---

## 4. Collections

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Native `Collections/` discovery | Done | Done | P0 | Scanner | |
| Legacy discovery | Done | Done | P1 | — | Limited mutations |
| Tree view + icons | Done | Done | P0 | Tree provider | |
| Multi-select | Done | Done | P1 | Runner | |
| Create/rename/delete/duplicate collection | Done | Done | P0 | Mutation | Native only |
| Create/rename/delete/duplicate folder | Done | Done | P0 | Mutation | Native only |
| Create/rename/delete/duplicate/move request | Done | Done | P0 | Mutation | |
| Drag & drop reorder/move | Done | Done | P0 | Marker + DnD | Legacy targets no-op |
| Marker order maps | Done | Done | P1 | marker.ts | |
| Export collection (folder) | Done | Done | P1 | Transfer | |
| Import collection (folder) | Done | Done | P1 | Transfer | Collision UX |
| Zip import/export | Planned | Done | P2 | Transfer | |
| Reveal active request | Done | Done | P1 | Navigation | |
| Refresh collections | Done | Done | P0 | Discovery | |
| Tags / favorites | Planned | Done | P3 | ExtensionBag | Reserved unused |
| Collection description UI | Planned | Done | P3 | Marker | |
| Collection-scoped variables | Planned | Done | P2 | Variables | |
| Migrate Legacy → Native wizard | Planned | Done | P2 | Mutation | |
| Cloud sync collections | Deferred | Deferred | P4 | — | Git is sync |

---

## 5. Collection runner

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Run collection | Done | Done | P0 | Orchestrator | |
| Run folder | Done | Done | P0 | — | |
| Run selected requests | Done | Done | P0 | Multi-select | |
| Run collection tests | Done | Done | P1 | Assertions | |
| Failure policies | Done | Done | P1 | QuickPick | Make more visible |
| Progress + summary | Done | Done | P0 | Progress UI | |
| Suppress per-request viewer | Done | Done | P1 | By design | |
| Run File (all in editor) | Stub | Done | P1 | Orchestrator | Placeholder command exists |
| Parallel runs | Deferred | Deferred | P3 | Executor | Sequential today |
| HTML/JUnit report export | Planned | Done | P3 | Runner | |

---

## 6. Authentication

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Providers: none/basic/bearer/apiKey | Done | Done | P0 | Auth module | |
| `@auth` directive | Done | Done | P0 | Parser | |
| Session Select Authentication | Done | Done | P1 | QuickPick | Does not persist settings |
| Settings profile metadata | Done | Done | P0 | Configuration | |
| SecretStorage integration | Done | Done | P0 | SecretStorageService | |
| Guided auth profile CRUD UI | Planned | Done | P0 | Manager webview | Critical UX gap |
| Secret setup wizard | Planned | Done | P0 | Secrets | |
| Persist default auth selection | Planned | Done | P1 | Settings | Align session/settings |
| Login / Logout commands | Stub | Done / redefine | P2 | OAuth or session UX | Today Coming Soon |
| OAuth2 / refresh | Planned | Done | P2 | Auth providers | |
| AWS/Azure/GCP signed | Deferred | Deferred | P4 | — | |
| JWT helper | Planned | Done | P3 | — | |

---

## 7. Variables & environments

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Global / workspace variables | Done | Done | P0 | Settings | |
| Named environments | Done | Done | P0 | Settings | |
| Document `@variable` | Done | Done | P0 | Grammar | |
| Sensitive masking | Done | Done | P0 | — | |
| Resolution precedence | Done | Done | P0 | Variables engine | doc > env > ws > global |
| Switch Environment (session) | Done | Done | P0 | QuickPick | Persistence gap |
| Persist active environment | Partial | Done | P0 | Settings | Setting exists; switch doesn't write |
| Environments manager UI | Planned | Done | P0 | Webview **panel** | Command-opened; **not** Activity Bar |
| Variables manager UI | Planned | Done | P0 | Webview panel tab | Lives inside Env Manager panel (S26) |
| Built-ins `$uuid` / `$timestamp` | Planned | Done | P2 | Resolver | Recognized unsupported today |
| OS environment bridge | Deferred | Deferred | P3 | Security | |
| Status bar env indicator | Planned | Done | P1 | StatusBar | |

---

## 8. Assertions & testing

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| `expect` syntax engine | Done | Done | P0 | Assertions | |
| Status/header/body/time/size/ctype | Done | Done | P0 | — | |
| Problems post-run | Done | Done | P0 | Diagnostics | Not on keystroke |
| Response pass/fail UI | Done | Done | P0 | — | |
| Request Editor Tests tab | Done | Done | P0 | — | |
| JS test scripts | Planned | Done | P3 | Sandbox | |
| JSON Schema asserts | Planned | Done | P2 | — | |
| Snapshot asserts | Planned | Done | P3 | — | |
| Contract / AI asserts | Deferred | Deferred | P4 | — | |

---

## 9. History

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Capture after execute | Done | Done | P0 | History service | Metadata only |
| Time-grouped tree | Done | Done | P0 | — | |
| Search (text) | Done | Done | P1 | InputBox | |
| Re-run / reveal / delete / clear | Done | Done | P0 | — | |
| Detail modal | Partial | Replace | P0 | — | Upgrade to panel |
| History detail panel | Planned | Done | P0 | Webview | Align with response |
| Facet filters (status/method) | Planned | Done | P2 | API exists | |
| Body persistence | Deferred | Optional | P3 | Privacy | Default off if ever |
| Cloud sync history | Deferred | Deferred | P4 | — | |

---

## 10. Import / export

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| OpenAPI 3.0/3.1 import | Done | Done | P0 | openapi-import | |
| Env/auth hints on import | Done | Done | P1 | Settings patch | |
| Secret scrubbing | Done | Done | P0 | — | |
| OpenAPI export | Planned | Done | P3 | Generators | |
| Swagger 2 import | Planned | Done | P3 | Provider | |
| Postman collection import | Planned | Done | P1 | Provider | High acquisition value |
| Insomnia import | Planned | Done | P2 | Provider | |
| Bruno import | Planned | Done | P2 | Provider | |
| Collection folder export/import | Done | Done | P1 | Transfer | |
| Zip collection transfer | Planned | Done | P2 | — | |

---

## 11. Settings & observability

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| `apiRunner.*` configuration | Done | Done | P0 | package.json | |
| Output channel logging | Done | Done | P1 | logLevel | |
| Status bar run feedback | Done | Done | P1 | Transient | |
| Dedicated Settings webview | Planned | Optional | P3 | — | Prefer native Settings + managers |
| Telemetry | Deferred | Deferred | P4 | Privacy | |

---

## 12. Product / marketplace

| Feature | Current Status | Planned Status | Priority | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| Marketplace extension packaging | Done | Done | P0 | — | 0.5.0 |
| Icon | Done | Done | P1 | images/icon.png | |
| Screenshots / banner | Partial | Done | P1 | Marketing | Checklist open |
| Coming Soon palette stubs | Stub | Clean up | P1 | — | Hide or implement |
| CLI runner | Deferred | Planned | P3 | Core reuse | Same `.api` grammar |

---

## Summary counts (approximate)

| Status | Count (rows) |
| --- | --- |
| Done | ~70 |
| Partial | ~12 |
| Stub | ~4 |
| Planned | ~45 |
| Deferred | ~15 |

---

## Priority theme map

| Theme | P0 items driving roadmap | Phase |
| --- | --- | --- |
| UI-first default | Request Editor default open; create opens form | 1 |
| Managers (panels) | Environments, Variables, Auth profiles + secrets | 2–3 |
| Response power tools | Copy / save / search | 1 |
| History fidelity | Detail panel | 4 |
| Persistence honesty | Env/auth session ↔ settings | 2–3 |
| Acquisition | Postman import; Marketplace screenshots | 5 |
| Orientation | Overview **command** (not Activity Bar) | 8 |

### Feature → roadmap index

| Feature theme | Roadmap phase |
| --- | --- |
| Editor default + response tools + stubs cleanup | 1 |
| Env/vars managers + persist active env | 2 |
| Auth manager + secrets UX | 3 |
| History detail + run report | 4 |
| Import Hub + Marketplace + walkthrough | 5 |
| Multipart/binary + Run File + cookies | 6 |
| Code Actions + built-ins + schema expects | 7 |
| Overview command + Legacy migrate + search | 8 |
| OAuth | 9 |
| CLI / export / extra importers | 10 |

See [`roadmap.md`](./roadmap.md) for exit criteria and [`gap-analysis.md`](./gap-analysis.md) for G-ids.
