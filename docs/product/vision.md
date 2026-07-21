# API Hero — Product Vision

**Version:** 1.2 (Final Polish)  
**Status:** Product direction grounded in 0.5.x; North Star for 1.0 in [`north-star.md`](./north-star.md)  
**Audience:** Product, design, engineering, and future contributors

---

## Product vision

API Hero is the **UI-first API client that lives inside VS Code**, where every common workflow is visual, fast, and native to the editor — while every request, collection, and assertion remains a **plain `.api` file** that Git can diff, review, and own.

Developers should feel they are using a modern API client (collections, form editors, response panels, environments, auth profiles) without leaving their IDE or abandoning source control. Power users can still open the `.api` text when they want precision; beginners should rarely need to.

> **One-line vision:** Postman-class workflows, Bruno-class Git honesty, Thunder Client–class VS Code presence — with `.api` as the single source of truth.

---

## Target users

### Primary

| Persona | Needs | Success looks like |
| --- | --- | --- |
| **Backend / API engineer** | Author and verify HTTP APIs beside service code | Create → edit → run → assert without leaving VS Code |
| **Full-stack developer** | Hit staging/prod APIs while building UI | Switch env, pick auth, inspect JSON response in one click |
| **QA / API tester** | Collections + assertions in CI-friendly files | Run folder/collection, see pass/fail, keep expects in Git |
| **Platform / DevEx** | Shared team collections under the repo | OpenAPI import → `Collections/` → PR reviewable `.api` |

### Secondary

| Persona | Needs |
| --- | --- |
| **Tech lead / architect** | Consistent request format, no opaque binary collections |
| **Onboarding engineer** | Discoverable UI; minimal DSL learning curve |
| **Security-conscious teams** | Secrets in Secret Storage, never in webviews or history bodies |

### Explicit non-targets (near term)

- Standalone desktop app users who refuse VS Code / Cursor / compatible editors  
- Teams whose primary need is GraphQL playground, gRPC, or WebSocket sessions (deferred)  
- Non-technical stakeholders who need cloud collaboration dashboards (out of scope)

---

## Product philosophy

1. **UI first, file forever** — The default experience is visual. The durable artifact is `.api`.
2. **Git is the collaboration layer** — No proprietary cloud collection sync as a requirement. The workspace is the sync.
3. **Native VS Code, not a web app in a panel** — Prefer Tree Views, Custom Editors, Settings, Problems, and Command Palette patterns users already know.
4. **One pipeline** — Form UI, text editor, OpenAPI generator, and collection runner all feed the same parser → orchestrator → executor path.
5. **Progressive disclosure** — Simple paths are zero-dialog. Advanced options appear when needed.
6. **Honesty over theater** — Prefer incomplete-but-clear (e.g. multi-request banner) over fake completeness.

---

## Core principles

| Principle | Meaning |
| --- | --- |
| **Canonical `.api`** | Document buffer wins. UI serializes into grammar; UI never invents a parallel schema. |
| **Two-way sync** | Form ↔ text must always converge; stale edits are dropped safely. |
| **UI covers common paths** | Create, edit, run, organize, env, auth, history, import — without hand-editing DSL. |
| **Reuse the engine** | Parser, runtime builder, variables, auth, assertions, execution stay shared. |
| **Secrets stay secret** | SecretStorage only; never in webviews, history bodies, or Marketplace logs. |
| **Stable IDs** | `apiRunner.*` commands/views/settings and language `api` remain compatible. |
| **Workspace-native collections** | `Collections/<Name>/` + marker JSON; Legacy discovery remains supported. |
| **Minimal friction** | Prefer click / DnD / inline over modal chains. |

Full UX rules: [`design-principles.md`](./design-principles.md).  
Hard limits: [`technical-constraints.md`](./technical-constraints.md).

---

## What API Hero is

- A **VS Code extension** (`ankitsemwal.api-hero`) for authoring and running HTTP/REST requests  
- A **language** (`.api`) with TextMate highlighting, completions, diagnostics, CodeLens, and outline  
- A **Request Editor** (Custom Text Editor) for visual editing of single-request files  
- A **Collections** Activity Bar for native CRUD, DnD, import/export folders, and runs  
- An **execution pipeline** with response viewer, assertions, history, environments, and auth profiles  
- An **OpenAPI 3.x importer** that generates reviewable `.api` trees under `Collections/`  
- A **Git-first** teammate workflow: requests are files; PRs are the review surface  

---

## What API Hero is not

| Not this | Why |
| --- | --- |
| A Postman cloud clone | Collaboration is Git + workspace, not mandatory SaaS sync |
| A second parser / second AST for the form | Form is a projection of `.api`, not a competing model |
| A general-purpose protocol lab (gRPC / WS / GraphQL first) | HTTP/REST depth before breadth |
| An AI coding agent | Optional AI assertions/assist may appear later; not the product identity |
| A secrets manager product | Uses VS Code Secret Storage; does not replace vault platforms |
| A replacement for the text editor | Power users keep full `.api` text; UI is preferred, not exclusive |
| A breaking rebrand of contribution IDs | User-facing “API Hero”; runtime IDs stay `apiRunner.*` |

---

## Long-term vision

### Horizon A — UI-complete HTTP client (near)

Every day-to-day task is achievable without opening `.api` as text: environments manager, auth profile wizard, richer response tools (copy/save/search), history detail panel, default Request Editor, Run File, guided secrets.

### Horizon B — Team & quality (medium)

Collection-scoped variables, zip import/export, Postman/Insomnia import bridges, richer assertion types (schema/snapshot), Code Actions, walkthroughs, Marketplace polish, optional status-bar env indicator.

### Horizon C — Platform depth (later)

OAuth2 / token refresh flows, real cookie jar, multipart/binary body fidelity, export OpenAPI, optional CLI for CI using the same `.api` grammar — still without forking the parser.

### Non-goals retained

Standalone Electron app, mandatory cloud account, proprietary binary collection format as canonical store.

---

## Competitive positioning

### Comparison matrix

| Dimension | Postman | Bruno | Insomnia | Thunder Client | REST Client | **API Hero** |
| --- | --- | --- | --- | --- | --- | --- |
| Primary surface | Desktop / web app | Desktop | Desktop | VS Code | VS Code text | **VS Code UI + text** |
| Canonical store | Cloud / local collections | Files (Bruno) | Local / cloud | Local / cloud tiers | `.http` files | **`.api` files** |
| Git-friendly | Partial / export | Strong | Partial | Partial | Strong | **Strong (native)** |
| Visual request builder | Excellent | Good | Good | Good | Weak | **Growing (Request Editor)** |
| Collections UX | Excellent | Good | Good | Good | Weak | **Strong tree + DnD** |
| Assertions / tests | Strong | Strong | Good | Good | Scripts / limited | **`expect` + Problems** |
| OpenAPI import | Strong | Good | Good | Good | Limited | **OpenAPI 3.x** |
| Secrets model | App vault / cloud | Env files | App | VS Code / tiers | Env / dotenv | **SecretStorage + profiles** |
| IDE embedding | Weak | Weak | Weak | Strong | Strong (text) | **Strong (UI-first)** |
| Learning curve | Medium–high | Medium | Medium | Low | Low (DSL) | **Low UI / optional DSL** |

### Where each competitor wins today

- **Postman** — Breadth, collaboration, monitoring, ecosystem. Weak for “requests as code in my repo.”  
- **Bruno** — Git-native collections, offline-first ethos. Weak for deep VS Code embedding.  
- **Insomnia** — Clean design, design docs. Same desktop-app gap.  
- **Thunder Client** — Excellent VS Code UX familiarity. Weaker “files are the product” story depending on tier/storage.  
- **REST Client** — Minimal, elegant `.http` beside code. Almost no visual product surface.

### Where API Hero should differentiate

1. **UI-first inside VS Code *and* file-canonical** — Not “text only” (REST Client) and not “UI that hides an opaque store.”  
2. **One grammar, two surfaces** — Request Editor and text share `request-source` + parser; no dual formats.  
3. **Collections as folders** — `Collections/<Name>/` + marker order maps; DnD and Git both make sense.  
4. **Assertions as first-class language** — `expect` lines in the same file, surfaced in Response + Problems.  
5. **Engine reuse** — Import, form, runner, and CodeLens never fork execution semantics.  
6. **VS Code-native trust model** — SecretStorage, Settings scopes, Problems, Output, Activity Bar.  

### Positioning statement

> For developers who live in VS Code and want a modern API client without abandoning Git, API Hero is the UI-first HTTP client whose requests are always plain `.api` files — combining Thunder Client–style IDE presence with Bruno-style source control honesty.

---

## Success metrics (product, not vanity)

| Signal | Indicates |
| --- | --- |
| % of create/edit/run paths completed without opening text | UI-first adoption |
| % of workspace collections under native `Collections/` | Migration from Legacy |
| Time-to-first-200 from empty workspace | Onboarding quality |
| Assertion usage rate on saved requests | Quality culture |
| OpenAPI import → PR of `.api` files | Team workflow fit |
| Support tickets about “lost” env/auth session | Persistence UX health |

---

## Related documents

| Doc | Role |
| --- | --- |
| [`north-star.md`](./north-star.md) | Ideal v1.0 journey |
| [`product-experience.md`](./product-experience.md) | How the product should feel |
| [`feature-matrix.md`](./feature-matrix.md) | Capability inventory |
| [`information-architecture.md`](./information-architecture.md) | Navigation (Collections + History only) |
| [`roadmap.md`](./roadmap.md) | Phased delivery to 1.0 |
| [`marketplace-strategy.md`](./marketplace-strategy.md) | Marketplace & release story |
| [`gap-analysis.md`](./gap-analysis.md) | Current vs desired |
| [`ux-review.md`](./ux-review.md) | Present UX evaluation |
| [`../ux/api-hero-ui-inventory.md`](../ux/api-hero-ui-inventory.md) | As-built UI inventory |
| [`../release/stable-identifiers.md`](../release/stable-identifiers.md) | IDs that must not change |
