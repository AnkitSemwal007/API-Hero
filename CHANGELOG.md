# Changelog

All notable changes to API Hero are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
