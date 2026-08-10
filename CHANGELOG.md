# Changelog

All notable changes to API Hero are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.7.0] - 2026-08-10

MCP server for AI coding agents — discover and run API Hero collections from Cursor, Claude Code, Codex, and other MCP-compatible clients without the VS Code UI. Reuses the existing Collection Runner and Execution Orchestrator (no parallel HTTP client). Backward compatible with **2.6.0**.

### Added

- **Standalone MCP stdio server** (`api-hero-mcp` / `dist/mcp/server.js`) — workspace via `APIHERO_WORKSPACE` or cwd (`Collections/<Name>/` layout)
- **MCP tools** — `apihero_list_collections`, `apihero_get_collection`, `apihero_list_requests`, `apihero_get_request`, `apihero_run_request`, `apihero_run_collection`, `apihero_get_run`, `apihero_get_request_result`
- **Headless composition** — Node workspace scanner, Collection Discovery, Collection Runner, and Execution Orchestrator with no-op UI sinks
- **Secret-safe agent payloads** — JSON body / JWT / password redaction, masked assertion expected/actual heuristics, auth metadata without secret values
- **Structured failure diagnostics** for agents — existing `RequestFailureDiagnostics` categories (precondition, transport, assertion, extraction, unread, cancelled) with Expected/Actual where available
- Unit tests for MCP service/redaction and optional live DummyJSON smoke script (`scripts/mcp-e2e-smoke.mjs`)

### Changed

- Exported `mapOrchestratorResult` from the collection-runner domain so single-request MCP results stay aligned with collection-run mapping (including blocking extraction failures)

### Docs & Marketplace

- [MCP user guide](docs/user/mcp.md) — Cursor / Claude Code / Codex configuration
- README positions MCP for AI agents
- Release readiness pinned to **2.7.0**

## [2.6.0] - 2026-07-31

Workspace hygiene and Scenarios UX — progressive disclosure, project-store scenario paths, Reset Workspace, and richer Collection Run Report failure details. Backward compatible with **2.5.0** (`.api` files, collections, and settings continue to work). Scenario files under legacy `.api-hero/scenarios/` migrate automatically into `.apihero/scenarios/`.

### Added

- **Scenarios progressive disclosure** — the Scenarios Activity Bar view stays hidden until a workspace successfully loads scenarios or you create one; once revealed it stays visible for that workspace (sticky). Focus Scenarios does not unlock a hidden view.
- **Reset Workspace...** (`apiHero.resetWorkspace`) — Command Palette–only command that permanently clears API Hero workspace data (`.apihero`, legacy `.api-hero/scenarios`, extension-wide request history, auth secrets for discovered profiles, and related workspace state) after a modal confirm. Collections, `.api` files, collection variables, and project source are preserved. Operates on the primary workspace folder only.
- **Collection Run Report failure diagnostics** — categorized failure reasons (precondition, transport, assertion, extraction, …) with clearer Details panel copy derived from a single diagnostics model.

### Changed

- Canonical scenario storage moved from `.api-hero/scenarios/` to `.apihero/scenarios/`. Existing legacy folders migrate automatically on discover/create (byte-preserving, idempotent; never overwrites differing canonical files). Migration does not by itself reveal the Scenarios view.
- `SCENARIOS_DIRECTORY_NAME` is now the project-store relative segment `scenarios` (was the full legacy path `.api-hero/scenarios`). Use `scenariosRootPath` / `scenariosDirectoryPath` for the absolute root.
- Parser / tokenizer hardening for collection-runner and scenario-related request parsing edge cases covered by expanded unit tests.

### Docs & Marketplace

- User and architecture docs updated for progressive disclosure, Reset Workspace, and `.apihero/scenarios` paths
- Release readiness pinned to **2.6.0**

## [2.5.0] - 2026-07-30

Authentication Premium UX and Scenario Experience — flagship workflows for secure auth and multi-step API automation. Backward compatible with **2.4.0** (`.api` files, collections, scenarios, and settings continue to work).

### Highlights

#### Authentication Premium UX

- **Auth Manager redesign** — templates (Bearer, API Key, Basic, JWT Login, …), inline secrets (masked after save), **Test** and **Run Login** from one place
- **Login API / Session** — run a login request, pick detected tokens, store access/refresh in Secret Storage with health and identity presentation
- **One-shot Bearer** — paste a token in the Request Editor for a single Send; optional **Save as Authentication**
- **Collection default Authentication** — set a collection-level default from the tree or command palette
- **Response → Use as Authentication** — create a session or auth profile from detected response tokens (with confirm)
- **Health, Identity, Preview** — derived health states, optional identity display, masked send preview (header names only for copy)

#### Scenario Experience

- **Starter templates** — login + token reuse, health-check branch, CRUD, and more when creating a scenario
- **Scenario Editor polish** — step palette, guided properties, request binding (**Choose Request…**), edge insert, keyboard add (**Ctrl/Cmd+K**)
- **Last-run status** in the Scenarios tree (workspace state; not written into `.scenario.json`)
- **Live step status** in the open editor while a scenario runs; clearer Scenario Report handoff

#### UX Improvements

- Request Editor Auth tab modes: None, One-shot Bearer, Saved Authentication
- Clearer separation of **Account Login (Not Available)** stubs vs **Authentication Login API**
- Scenarios welcome and Overview messaging aligned with Collections vs Scenarios roles

#### Performance

- Leaner Auth Manager and Scenario Editor webview updates where coalescing already applies
- Scenario tree last-run reads from workspace state without re-scanning scenario files

#### Accessibility

- Auth Manager and Scenario Editor keyboard flows (palette, property focus, Test / Run actions)
- Clearer labels and status text for health, identity, and last-run outcomes

#### Bug Fixes

- Auth resolution and presentation edge cases covered by expanded unit tests
- Scenario schema / binding helpers for template and unbound request steps
- Collection default authentication marker discovery and tree projection

### Docs & Marketplace

- README positions **Authentication** and **Scenarios** as flagship capabilities
- User docs for Authentication and Scenarios updated for Premium UX / Experience
- Release readiness pinned to **2.5.0**

## [2.4.0] - 2026-07-29

### New

- **Scenario Engine (Phase 1)** — multi-step orchestration via `.apihero/scenarios/*.scenario.json` (request steps, conditions, variables)
- **Scenario Editor** — webview editor to create and edit scenarios
- **Scenario Run Reports** — review results after a scenario run
- **Scenarios** Activity Bar view (`apiHero.explorer`) — browse, create, open, and run scenarios alongside Collections, Execution, and History

### Improved

- Contribution IDs for Scenarios use the `apiHero.*` namespace, with matching `apiRunner.*` legacy command aliases for compatibility

## [2.3.6] - 2026-07-28

### Fixed

- Fixed Activity Bar view registration caused by an invalid `Execution` view manifest contribution.
- Restored Collections, Execution, and History view registration.
- Removed renderer contribution warnings for the invalid view `icon` shape.

## [2.3.5] - 2026-07-28

### Changed

- Migrated contribution namespace from `apiRunner.*` to `apiHero.*` (commands, views, settings, webview panel types, secret key prefix). Legacy `apiRunner.*` command aliases, custom editor view type, and secret-key fallback remain for compatibility.
- **Breaking (layout only):** Activity Bar container and view IDs are now `apiHero` / `apiHero.*`. Saved sidebar layouts and custom `when` clauses that reference `apiRunner.*` views will not restore those views; reopen the API Hero Activity Bar icon once after upgrading.

## [2.3.4] - 2026-07-28

Marketplace presentation and documentation release. Extension behavior is unchanged from **2.3.3**.

### Changed

- Redesigned root README as a scannable Marketplace landing page (hero, benefits, comparison early, features with screenshots beside sections)
- Marketplace listing media (hero, banner, social preview, screenshots, workflow GIF) served from Cloudinary CDN URLs
- `images/marketplace/**` excluded from the VSIX (`.vscodeignore`) and ignored locally (`.gitignore`); extension chrome icons still ship
- Release / readiness / asset docs pinned to **2.3.4**

## [2.3.3] - 2026-07-28

Execution Center, Live Run Report polish, collection execution improvements, dependency workflow enhancements, Request Editor UX, repository cleanup, and Marketplace readiness.

### Added

- **Execution Center** — Activity Bar **Execution** view for live collection runs: Running and Recent sessions, progress, cancel, open Live Report, and reveal collection

### Improved

**Live Run Report**

- Live progress while a collection is running (rows update as requests finish)
- Subtle shimmer on the currently executing request so the active row is easy to spot
- Clearer messaging that **Collection Run Debugger** / **Details** inspect the **last in-memory run** (not History)
- Panel title aligned to **Run Report**

**Collection execution**

- Clearer progress in the Execution view and status bar during collection runs
- Smoother handoff from live progress to the finished Run Report

**Request Editor**

- More reliable editing when the editor is not focused on a single request (Method/URL behave correctly outside form mode)
- Dependencies panel focus and keyboard behavior improvements

**Dependency workflow**

- Clearer Auto / Manual / Unknown / Ambiguous projections and pin-to-manual flow
- Better alignment between editor Depends-on order and collection run order

**Discoverability & UX polish**

- Overview Quick Actions: **New Collection** before **New Request**
- Environment Manager hint for collection variables (`api-hero.variables.json` / Extract Variable with collection scope)
- History welcome and detail copy clarify runs are metadata-only (bodies not stored)
- Auth Manager hint: `@auth` uses profile **id** (label is display-only)
- Consistent **Save as Variable** / **Save Extract Rule** labeling in the Response Viewer

**Docs & Marketplace**

- README screenshots, banner, social preview, and workflow GIF under `images/marketplace/`
- Release notes and readiness docs pinned to **2.3.3**

### Fixed

- Environment rename keeps selection and secrets in sync (carried through from **2.3.2**)
- Request Editor focus no longer stolen by the Dependencies panel (carried through from **2.3.2**)

## [2.3.2] - 2026-07-27

Stability and UX patch following **2.3.0** / **2.3.1**.

### Fixed

**Request Editor**

- Fixed global focus-stealing issue introduced during the Dependencies panel redesign (document outside-click always focused **+ Add Dependency**, so any editable input lost focus on click)
- Fixed dependency picker outside-click behavior so it no longer steals focus from active inputs when the popover is already closed
- Fixed URL/Method appearing editable in multi/empty mode while silently ignoring edits (also shipped in **2.3.1**)
- Disabled URL and Method controls when the editor is not in form mode

**Environment Manager**

- Fixed environment rename synchronization
- Fixed selection after rename
- Fixed "Unknown environment" after renaming new environments
- Fixed environment ID re-keying
- Implemented deterministic secret restoration
- Ambiguous secret restoration is now skipped instead of guessing

### Improved

- Cleaner Dependencies panel
- Better keyboard accessibility
- Hidden empty diagnostics
- Improved manual dependency workflow
- Additional regression coverage

### Internal

- No execution pipeline changes
- No dependency engine changes
- No request persistence changes

## [2.3.1] - 2026-07-27

### Fixed

- **Request Editor toolbar** — disable Method and URL in `multi`/`empty` modes so edits are not silently dropped (`scheduleUpdate` only runs in `form` mode)

## [2.3.0] - 2026-07-27

Collection Run Debugger V1 — inspect an entire collection run from the Run Report without re-running APIs.

### Added

- **Collection Run Debugger (in-memory)** — expandable per-request Details in the Run Report: Response, Headers, Cookies, Extracted Variables, Assertions, Execution Details, Dependencies, and Timeline (Start / End / Duration)
- **Shared response presentation** — Run Report owns `ResponsePresentation` built once via `presentExecutionResult`; never renders `RuntimeResponse` (same pipeline as the Single Request Viewer)
- **Secret-safe resolved variables** — Execution Details shows `{{name}}` → display value (masked when sensitive)
- **Variable Trace** — report-level Produced by / Consumed by projection from existing dependency edges (no graph changes)

### Unchanged

- Collection Runner execution order, failure policies, dependency engine, and extraction logic
- No run persistence / retention (V1 is last-run in-memory only)
- Request files (`.api`) never store responses

### Tests

- Orchestrator attaches `execution` + `resolvedVariables`; runner maps through `presentExecutionResult`; Run Report model/HTML coverage

## [2.2.0] - 2026-07-26

Intelligent Variable & Dependency Autofill (ADR 0003), array-root `@extract` paths, and a FakeStore-oriented regression catalog.

### Added

- **Intelligent Variable & Dependency Autofill** — Request Editor projects Auto / Manual / Unknown / Ambiguous from the same `buildDependencyGraph` the Collection Runner uses ([ADR 0003](docs/architecture/adr/0003-intelligent-variable-dependency-autofill.md))
- **Pin Auto → Manual** — writes human `@depends-on` only; Auto never persists to `.api`
- **Unknown variable Ignore** — workspace-level suppression
- **Regression suite** — TC001–TC038 under `src/regression/` (chaining, FakeStore mocked flow, serialize/pin, graph)

### Fixed

- **`@extract … from body[0].id`** (and other array-root `body[…]` paths) no longer rejected as malformed

### Unchanged

- Collection Runner enrich / execute path (no second dependency engine)
- Multi-producer runtime semantics (Q1 Option A: all producers + last-write-wins)

### Tests

- Unit + regression catalog green before package

## [2.1.3] - 2026-07-26

Human-readable request dependencies (Option C), Create Variable / extract polish, and related fixes. Published as **2.1.3** because Marketplace already has an immutable **2.1.2**.

### Added

- **Folder-aware `@depends-on` refs** — bare `@name` when unique, or `Folder/Name` (and `./Name` for root) when the same display name appears in more than one folder ([ADR 0002](docs/architecture/adr/0002-authored-request-ids.md))
- **Depends-on name picker** in the Request Editor (search, multi-select, folder context); files stay Git-readable
- **Rename Symbol-style cascade** — renaming a request in the Request Editor rewrites matching `@depends-on` tokens across the collection
- **Create Variable From Response** polish — Response Viewer actions, workspace/collection extract scopes, Extract tab Collection/Workspace options

### Changed

- Runtime dependency graph still uses discovery IDs only **after** one resolve at plan enrich; execution never compares display names
- Serialize no longer emits authored `@id` / `req_*` for dependencies; leftover `req_*` tokens reverse-migrate to human refs on save when unique

### Fixed

- Leading `@` on depends-on entries (e.g. `@New Request`) stripped so spaced names resolve

### Unchanged

- Stable `apiRunner.*` command IDs, configuration keys, and Secret Storage patterns
- Discovery `request:<path>#<index>` remains runtime-only (never written to `@depends-on`)

### Tests

- **727** unit tests passing

## [2.1.2] - 2026-07-26

Patch release — fixes JSON array-root path handling for Create Variable / Copy Value that shipped broken in the published 2.1.1 VSIX. (Immutable on Marketplace; follow-on work ships as 2.1.3.)

### Fixed

- Create Variable / Copy Value for JSON **array-root** bodies (`body[0]`, `body[0].id`) via shared `stripBodyPrefix` in `json-path.ts`, used consistently by `resolveCreateVariableValue` and host Copy Value resolution
- Host `handleCreateVariable` now rejects non-extractable JSON paths before persist, instead of silently writing an unusable rule

### Unchanged

- Stable `apiRunner.*` command IDs, configuration keys, and Secret Storage patterns

### Tests

- Array-root path coverage for `stripBodyPrefix`, `resolveCreateVariableValue`, and Create Variable host gate

## [2.1.1] - 2026-07-26

Response Extraction production readiness — Create Variable From Response and full extract write scopes.

Public production release of the 2.1 line.

### Added

- **Create Variable From Response** — Response Viewer JSON tree context menu (Copy Value, Copy JSON Path, Extract Variable…, Expand/Collapse), Save as variable toolbar action, and confirmation sheet (name, path, scope, sensitive, overwrite warning)
- **Mode B persistence** — saves `@extract` / `@sensitive-extract` into the request `.api` source and writes the current value via the VariableWriter for the chosen scope
- **Workspace-scope extraction writes** — `scope=workspace` via `WorkspaceVariableWriter` (ADR-aligned; Global extract remains forbidden)
- **Collection extract outside collection runs** — `scope=collection` resolves the owning collection from the request source path; collection variable cache refreshes on every persist
- **Request Editor Extract tab** — Collection and Workspace scopes in the scope picker
- **Run report consumed variables** — shows declared consumes as `-varName` alongside produced `+varName`
- **JSON tree metadata** — `data-json-path`, value, type, and extractable gating aligned with supported JSON-path grammar

### Changed

- Response Viewer, variables, and collection-runner user docs for Create-from-Response, workspace extracts, and consumed variables
- Host-side Copy Value for extractable paths (re-resolves from the last execution result)

### Fixed

- Collection-variable cache stayed stale after outside-run `scope=collection` writes, so the next request could miss the new value
- Create Variable validation/path failures now surface an error instead of failing silently after the sheet closes

### Unchanged

- Stable `apiRunner.*` command IDs, configuration keys, and Secret Storage patterns
- Global-scope extraction remains forbidden (manual Variable Manager only)
- Activity Bar remains **Collections** + **History** only

### Tests

- **684** unit tests passing

## [2.0.1] - 2026-07-26

Phase 1 + Phase 2 release — response variable extraction and collection chaining.

### Added

- **Extraction Engine** — apply `@extract` / `@sensitive-extract` rules to execution results and produce an extraction report
- **`@extract` / `@sensitive-extract`** — parse, validate, diagnostics, language hover/completion, and RequestSource round-trip
- **Variable resolution improvements** — document, environment, and session **Run** scope writes after successful extracts
- **Request Editor extraction support** — Extract tab to author and edit extraction rules in the UI
- **Response Viewer extraction report** — report-only section parallel to assertions
- **Extraction pipeline** — post-execute observer order (history → extraction → assertion presentation)
- **Parser enhancements** — extract-directive validation and diagnostic codes
- **Collection chaining** — `@depends-on`, produces/consumes edges, cycle/ambiguous/unknown-target detection, topo-ordered plan enrichment
- **Collection Runner per-run store** — shared run-scope variables across a collection run, isolated from the single-request session store
- **Collection variables** — `Collections/<Name>/api-hero.variables.json` with a sensitive local overlay; `scope=collection` extraction writes
- **Collection Run Report dependency reporting** — produced var names, text dependency edges, skip reasons, execution order + Reordered badge, unresolved list; reorder toast (`Reordered N requests for dependencies`); cycle block notification with label path
- **Pre-flight dependency skip honors static definitions** — a request is only skipped for a missing produced variable when it is absent from the run store **and** not statically defined by env/collection/workspace/global
- **Test suite improvements** — unit and integration coverage for extraction, dependency graph, collection variables, and collection runner chaining

### Fixed

- Legacy (workspace-root) collection runs now read back sensitive collection variables written during the same run — the overlay lookup uses the run's actual `collectionId` instead of always recomputing it from the root path
- Sensitive collection-variable upserts now fail loudly instead of silently redacting the tracked file when the local overlay cannot be written (no workspace folder)
- Corrected a stale "until Phase 2+" message on unsupported workspace-scope writes
- Required / malformed extraction failures during a collection run map to `Failed` so `stop-on-first-error` stops (P2 §9.4)
- Lint cleanup: unused parameters and a useless assignment

### Unchanged

- Stable `apiRunner.*` command IDs, configuration keys, and Secret Storage patterns
- Activity Bar remains **Collections** + **History** only

### Tests

- **649** unit tests passing

## [0.2.0] - 2026-07-26

Phase 1 complete — response variable extraction and the post-execution extraction pipeline.

### Added

- **Extraction Engine** — apply `@extract` / `@sensitive-extract` rules to execution results and produce an extraction report
- **`@extract` / `@sensitive-extract`** — parse, validate, diagnostics, language hover/completion, and RequestSource round-trip
- **Variable resolution overlay** — document, environment, and session **Run** scope writes after successful extracts
- **Request Editor Extract tab** — author and edit extraction rules in the UI
- **Response Viewer extraction report** — report-only section parallel to assertions
- **Extraction pipeline** — post-execute observer order (history → extraction → assertion presentation)
- **Parser improvements** — extract-directive validation and diagnostic codes
- Shared webview design tokens, OpenAPI import rollback, history quarantine, and Collections CRUD dialog polish from the 0.6.x line

### Changed

- Version pin to `0.2.0` across package manifest, README, SUPPORT, and product docs
- Product docs and roadmap updated for Phase 1 shipped scope (collection chaining deferred to Phase 2)

### Unchanged

- Stable `apiRunner.*` command IDs, configuration keys, and Secret Storage patterns
- Activity Bar remains **Collections** + **History** only

### Tests

- **559** unit tests passing

## [0.6.7] - 2026-07-23

### Changed

- Marketplace presentation polish (listing metadata, README structure, settings description clarity) — no command or runtime behavior changes
- Version and docs pin alignment to `0.6.7` across README, SUPPORT, product, and Marketplace readiness docs

## [0.6.4] - 2026-07-22

### Added

- Shared webview design tokens/helpers (`src/ui/webview/shared-styles.ts`) for consistent panel chrome
- OpenAPI import workspace writer rollback when a destination directory is occupied or write fails mid-import
- History store quarantine/backup path for corrupt history files

### Changed

- Request Editor layout and host↔webview synchronization (ack / resubmit) for safer custom-editor updates
- Environment and Auth Manager panels polish (search, duplicate, validation, preview)
- History Detail, Collection Run Report, Overview, and Response Viewer visual polish
- Collections tree / New Request dialog / OpenAPI wizard UX hardening

### Fixed

- Custom editor synchronization edge cases when the underlying `.api` document changes during an edit session
- History delete affordances clarified (context menu; inline toolbar cleanup)
- Environment id normalization and settings write consistency

### Unchanged

- No breaking command ID, configuration key, view ID, or `.api` grammar changes
- Activity Bar remains **Collections** + **History** only

## [0.6.3] - 2026-07-22

### Changed

- Packaging and Marketplace metadata alignment for the post-0.6.2 polish wave
- Incremental UI resilience on managers, History, and OpenAPI import (superseded by 0.6.4 notes where overlapping)

### Unchanged

- Stable `apiRunner.*` identifiers; Secret Storage key patterns unchanged

## [0.6.2] - 2026-07-21

### Changed

- Auth Manager Preview strings centralized in `authentication-presentation-preview` (secret-free core helper)
- Shell/IA commands relocated: Coming Soon stubs stay in `placeholder-commands`; `openWorkspace` / `openSettings` register with Overview; `recentRequests` aliases History focus
- Collections mutation/transfer polish and Overview/Auth Manager UX hardening from production cleanup
- Version bump to `0.6.2`

### Unchanged

- No breaking command ID, configuration key, view ID, or `.api` grammar changes
- SecretStorage and auth profile settings format unchanged
- Activity Bar remains Collections + History only

## [0.6.1] - 2026-07-21

### Changed

- OpenAPI import emits `.api` files through shared `request-source` serialization (same emitter as Request Editor / New Request)
- Webview panels share `src/ui/webview` helpers (escape, nonce, CSP, message-record)
- Authentication validation centralized in auth core (soft load + strict commit); Auth Manager and diagnostics are thin projections
- Marketplace packaging: root README, LICENSE, SUPPORT, gallery icon, and release docs
- Version bump to `0.6.1`

### Unchanged

- No UI redesign, workflow, command ID, configuration key, or `.api` grammar changes relative to 0.6.0 feature set
- SecretStorage and auth profile settings format unchanged
- Activity Bar remains Collections + History only

## [0.6.0] - 2026-07-21

### Added

- Environment Manager panel (visual CRUD for environments and variables; persists active environment)
- Auth Profiles Manager panel (Bearer / Basic / API Key) with Secret Storage prompts
- History Detail panel with status/method facet filters
- Collection Run Report panel after multi-request runs
- OpenAPI import multi-step wizard (preview, progress, summary)
- Overview command panel for recent runs, collections, and quick actions
- Collections tree filter (`apiRunner.filterCollections`)
- Response Viewer copy / save / search actions
- Setting `apiRunner.collectionRunner.failurePolicy` (prompt only when `ask`)
- Environment status bar chip for the active environment

### Changed

- Activity Bar product icon uses `images/icon.png`
- Request Editor visual redesign; custom editor priority `default` for `.api` files
- Response Viewer layout (status card, tabs; cookies hidden until a jar exists)
- Collections tree method-aware icons/descriptions; Import OpenAPI on toolbar
- Switch Environment persists `apiRunner.activeEnvironment`
- Login / Logout / Run File hidden from Command Palette until implemented (`when: false`)
- User-facing brand **API Hero** (stable IDs remain `apiRunner.*`)
- Version bump to `0.6.0`

### Unchanged (stable identifiers)

- Command IDs `apiRunner.*`, configuration keys, view IDs, language id `api`, TextMate `scopeName`, secret key patterns, diagnostic code prefixes — see `docs/release/stable-identifiers.md`
- Activity Bar still hosts only **Collections** and **History** (managers open as panels)

## [0.5.0] - 2026-07-21

### Added

- Marketplace-oriented packaging metadata (description, categories, keywords, repository, license, gallery banner)
- Marketplace gallery icon (`images/icon.png`)
- Root README, CHANGELOG, LICENSE, SUPPORT, and release documentation under `docs/release/`
- Collections and History `viewsWelcome` empty-state copy with command links
- `@vscode/vsce` packaging script (`npm run package`)

### Changed

- User-facing product brand from **API Runner** to **API Hero**
- Marketplace package metadata: publisher `ankitsemwal`, package `api-hero`, extension ID `ankitsemwal.api-hero`
- Stub commands (`runFile`, `login`, `logout`) show a clear “not available in this release” message
- Version bump to `0.5.0`

### Unchanged (stable identifiers)

- Command IDs `apiRunner.*`, configuration keys, view IDs, language id `api`, TextMate `scopeName`, secret key patterns — see `docs/release/stable-identifiers.md`

### Completed modules in this release

- Parser and `.api` language support (grammar, snippets, providers)
- Request execution pipeline and response viewer
- Variables and environments
- Authentication profiles and Secret Storage integration
- Assertions engine and Problems integration
- Collections discovery and Activity Bar explorer
- Collection runner
- History persistence
- OpenAPI 3.x import
