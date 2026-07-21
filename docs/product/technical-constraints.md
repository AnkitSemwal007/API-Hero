# API Hero — Technical Constraints

**Version:** 1.2 (Final Polish)  
**Purpose:** Document hard limits from VS Code, current architecture, and product invariants so future UI work cannot accidentally break the engine.  
**IA:** Do not add permanent Activity Bar views beyond Collections + History ([`information-architecture.md`](./information-architecture.md)).

---

## Constraint categories

1. VS Code platform APIs  
2. Extension architecture & module boundaries  
3. `.api` format & parser  
4. Runtime & execution pipeline  
5. Custom Editor & webviews  
6. Tree Views & workspace model  
7. Secrets & settings  
8. Synchronization  
9. Stable identifiers  

Anything marked **MUST NOT BREAK** is a release-blocking invariant.

---

## 1. VS Code APIs

### Available building blocks (current product)

| API | Used for |
| --- | --- |
| TreeView | Collections, History |
| CustomTextEditor | Request Editor |
| WebviewPanel | Response viewer, New Request dialog |
| Commands / Menus / Keybindings | All actions |
| WorkspaceEdit / TextDocument | Canonical writes to `.api` |
| SecretStorage | Auth secrets |
| Configuration | Environments, variables, profiles, limits |
| DiagnosticCollection | Language + assertion Problems |
| StatusBarItem / Progress / Notifications | Run feedback |
| CodeLens / Completion / Hover / Folding / DocumentSymbol | Language support |

### Platform limits that shape UX

| Limit | Product implication |
| --- | --- |
| TreeView is not a freeform layout engine | Managers (env/auth) need webviews or Settings, not fake trees with widgets |
| CustomTextEditor is document-centric | One form ↔ one document; multi-request needs picker or text |
| Webview CSP & message passing | No remote fetch from webview; host mediates all I/O |
| No arbitrary OS UI | Match workbench; theme via CSS variables |
| Extension host ≠ UI thread assumptions | Debounce sync; never block activate with network |
| Contribution ID stability | Renaming commands/views breaks user keybindings & settings |

### MUST NOT BREAK

- Extension activates and registers views/commands without requiring network.  
- Webviews use strict CSP (`default-src 'none'`, nonce scripts/styles).  
- No `fetch()` from extension code outside the Request Engine transport.

---

## 2. Current architecture

### Layering (simplified)

```text
┌─────────────────────────────────────────────────────────┐
│ VS Code adapters (**/vscode/, commands, extension.ts)   │
├─────────────────────────────────────────────────────────┤
│ Orchestration · Collections · History · OpenAPI · Editor│
├─────────────────────────────────────────────────────────┤
│ Parser · Validation · Request Builder · Variables · Auth│
├─────────────────────────────────────────────────────────┤
│ Execution (Node HTTP transport) · Assertions            │
└─────────────────────────────────────────────────────────┘
```

### Module boundary rules

| Rule | Rationale |
| --- | --- |
| Core modules must not import `vscode` | Testability; CLI/future hosts |
| Adapters live under `**/vscode/` | Clear dependency direction |
| Discovery is read-only | Mutations go through `CollectionMutationService` |
| Single live execution path | Orchestrator → builder → variables → auth → executor → response |
| Completed subsystems must be preferred | Integration rule: no parallel unused engines |

### MUST NOT BREAK

- Domain barrels remain framework-free.  
- Collection mutations do not bypass the mutation service with ad-hoc FS writes from random commands.  
- No second HTTP client library path beside the Node transport in the Request Engine.

---

## 3. `.api` format & parser

### Canonical pipeline

```text
Text → tokenizer → lexer → parser → AST → semantic validation → ApiDocument
```

| Constraint | Detail |
| --- | --- |
| Single parser | Only `parseApiDocument` produces the AST |
| No parallel form schema | `request-source` projects to/from grammar; does not invent directives |
| Separators | `###` request boundaries |
| Directives | Known `@` directives only (auth, variable, timeout, …) |
| Assertions | `expect …` lines owned by assertions grammar |

### Request Editor implications

- Serialization must round-trip through parser-accepted syntax.  
- Disabled headers comment-out (`# Name: value`) rather than inventing flags.  
- Settings tab may only expose existing directives (today: `@timeout`).  
- Multi-request documents (**N ≠ 1**) must not be rewritten from a single-request form.

### MUST NOT BREAK

- Existing valid `.api` files continue to parse.  
- Form saves do not strip unknown-but-valid constructs without an explicit migration policy.  
- Language id `api` and grammar `source.api-runner` remain stable.

---

## 4. Runtime & execution

### Staged contracts

```text
ApiDocument → RuntimeRequest → ResolvedRequest → AuthenticatedRequest → ExecutionResult
```

| Stage | Responsibility |
| --- | --- |
| Builder | Project AST → runtime; placeholders for unresolved pieces |
| Variables | Resolve `{{name}}` with precedence document > env > workspace > global |
| Auth | Apply profile providers (none/basic/bearer/apiKey) |
| Executor | Node `http`/`https` only; timeouts; size caps; cancel |
| Assertions | Evaluate `expect` against `ExecutionResult` |

### Known intentional gaps (do not fake)

- Non-empty multipart construction / binary upload → `UNSUPPORTED_BODY` until implemented  
- Streaming, GraphQL, WebSocket, gRPC — deferred  
- Cookie jar — stub in response UI  

### MUST NOT BREAK

- Executor accepts only `AuthenticatedRequest` (no AST leakage into `src/execution`).  
- Collection runner uses the same orchestrator semantics as single-request run.  
- `apiRunner.requestTimeout` / `maxResponseBytes` continue to bound resources.

---

## 5. Custom Editor & webviews

### Request Editor (`apiRunner.requestEditor`)

| Constraint | Detail |
| --- | --- |
| Priority | Currently `option` (product may change default open behavior carefully) |
| Sync | Debounced; version-guarded; document wins |
| Secrets | Profile id only in webview |
| Run | Calls orchestrator; must not assume `window.activeTextEditor` |

### Response / New Request webviews

| Constraint | Detail |
| --- | --- |
| Host messages | Narrow protocol; response host accepts readiness only from viewer today |
| No secrets | Strip/mask before postMessage |
| Panel lifecycle | Collection runs suppress per-request viewer by design |

### MUST NOT BREAK

- Two-way sync integrity (no silent data loss on form save).  
- CSP and message allowlists.  
- Multi-request guard (banner + no rewrite).

---

## 6. Tree Views & workspace model

### Collections discovery

```text
Workspace folder
  ├─ Collections/<Name>/          → Native collection
  │    ├─ api-hero.collection.json (optional order maps)
  │    ├─ folders…
  │    └─ *.api
  └─ other/**/*.api               → Legacy synthetic collection
```

| Constraint | Detail |
| --- | --- |
| Snapshot provider | Tree reads discovery snapshot; not unbounded FS walk on every expand |
| Marker maps | `order`, `folderOrder`, `requestOrder` |
| Legacy | Discoverable; limited mutations; DnD onto Legacy no-op |
| Multi-root | Workspace name may appear in descriptions |

### History

- Global storage metadata only (`request-history.json`)  
- Bounded by `apiRunner.history.maxEntries`  
- No body/credential persistence  

### MUST NOT BREAK

- Native collections remain folder-based and Git-friendly.  
- Refresh reacts to workspace / `.api` / marker changes.  
- History never stores response bodies or secrets.

---

## 7. Secrets & settings

### Settings (`apiRunner.*`)

Environments, variables, auth profile **metadata**, timeouts, language toggles, import size, history retention.

### SecretStorage

| Rule | Detail |
| --- | --- |
| Sole adapter | `SecretStorageService` only |
| Key pattern | `apiRunner.auth.profile.<id>.<field>` |
| Sources | Profile fields with `kind: "secret"` |

### MUST NOT BREAK

- Literals may exist for convenience but product guidance prefers secrets.  
- OpenAPI import must continue scrubbing secrets to placeholders.  
- No webview may receive raw secret values.

---

## 8. Synchronization

### Document ↔ UI

```text
Form update ──debounce──► serialize ──WorkspaceEdit──► TextDocument
TextDocument change ──debounce──► parse ──state──► Form
```

Version tokens drop stale form commits when the buffer moved ahead.

### Session vs settings (current debt)

Today, Switch Environment / Select Authentication are **session-scoped** and may diverge from `apiRunner.activeEnvironment` / profile defaults. Product roadmap must **converge** these without breaking users who rely on either behavior — see [`gap-analysis.md`](./gap-analysis.md).

### Collection tree ↔ filesystem

Mutations write disk → discovery refresh → tree update. UI must not show successful create if write failed.

### MUST NOT BREAK

- Round-trip fidelity for single-request documents.  
- Atomic-enough OpenAPI import (failure writes nothing / no partial refresh).  
- Collision handling on collection import (Rename / Overwrite).

---

## 9. Stable identifiers

See [`../release/stable-identifiers.md`](../release/stable-identifiers.md).

**MUST NOT change without migration plan:**

- Extension id `ankitsemwal.api-hero`  
- Command ids `apiRunner.*` (including stubs)  
- View ids `apiRunner`, `apiRunner.collections`, `apiRunner.history`  
- Config keys `apiRunner.*`  
- Language id `api`, grammar `source.api-runner`  
- Diagnostic code prefixes `api-runner.*`  
- Secret key prefix pattern  
- Webview type ids already published (`apiRunner.response`, etc.)

User-facing titles **may** say “API Hero”.

---

## What should never be broken (checklist)

| Invariant | Owner docs |
| --- | --- |
| `.api` is canonical source of truth | parser, request-source, request-editor |
| Single parser / single AST | `docs/architecture/parser.md` |
| Single execution pipeline | orchestration, execution |
| No `fetch()` outside Request Engine | engineering workflow |
| SecretStorage only via service | authentication, storage |
| No `vscode` in core modules | architecture |
| Native collection folder layout | collections |
| History metadata-only | history |
| Custom editor multi-request safety | request-editor |
| Stable contribution IDs | stable-identifiers |

---

## Safe evolution patterns

| Change type | Guidance |
| --- | --- |
| New UI manager webview | Read/write settings + files via existing services; do not fork resolution |
| New assertion kinds | Extend grammar + engine together; keep Problems source stable |
| Default open Request Editor | Change carefully; preserve Open With Text |
| Persist session env to settings | Explicit UX; migration note in CHANGELOG |
| New import providers | Registry pattern; keep OpenAPI path intact |
| Remove Coming Soon stubs from palette | Prefer hide over delete command ids |

---

## Related documents

- [`vision.md`](./vision.md)  
- [`information-architecture.md`](./information-architecture.md)  
- [`performance-goals.md`](./performance-goals.md)  
- [`gap-analysis.md`](./gap-analysis.md)  
- [`roadmap.md`](./roadmap.md)  
- Architecture docs under `docs/architecture/`  
