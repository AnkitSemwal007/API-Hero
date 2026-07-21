# Changelog

All notable changes to API Hero are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-07-21

### Changed

- OpenAPI import emits `.api` files through shared `request-source` serialization (same emitter as Request Editor / New Request)
- Webview panels share `src/ui/webview` helpers (escape, nonce, CSP, message-record)
- Authentication validation centralized in auth core (soft load + strict commit); Auth Manager and diagnostics are thin projections
- Version bump to `0.6.1`

### Unchanged

- No UI redesign, workflow, command ID, configuration key, or `.api` grammar changes
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

### Changed

- Activity Bar product icon uses `images/icon.png`
- Request Editor visual redesign; custom editor priority `default` for `.api` files
- Response Viewer layout (status card, tabs; cookies hidden until a jar exists)
- Collections tree method-aware icons/descriptions; Import OpenAPI on toolbar
- Switch Environment persists `apiRunner.activeEnvironment`
- Login / Logout hidden from Command Palette until OAuth ships
- Version bump to `0.6.0`

### Unchanged (stable identifiers)

- Command IDs `apiRunner.*`, configuration keys, view IDs, language id `api`, TextMate `scopeName`, secret key patterns, webview types, diagnostic code prefixes — see `docs/release/stable-identifiers.md`
- Activity Bar still hosts only **Collections** and **History** (managers open as panels)

## [0.5.0] - 2026-07-21

### Added

- Marketplace-oriented packaging metadata (description, categories, keywords, repository, license, gallery banner)
- Marketplace gallery icon (`images/icon.png`, 128×128 PNG from brand light mark)
- Root README, CHANGELOG, LICENSE, SUPPORT, and release documentation under `docs/release/`
- Collections and History `viewsWelcome` empty-state copy with command links
- `@vscode/vsce` packaging script (`npm run package`)

### Changed

- User-facing product brand from **API Runner** to **API Hero** (display name, command titles, settings copy, diagnostics sources, notifications, status bar)
- Marketplace package metadata for first public release: publisher `ankitsemwal`, package `api-hero`, extension ID `ankitsemwal.api-hero`
- Stub commands (`runFile`, `login`, `logout`) now show a clear “not available in this release / coming soon” information message
- Version bump to `0.5.0`

### Unchanged (stable identifiers)

- Command IDs `apiRunner.*`, configuration keys, view IDs, language id `api`, TextMate `scopeName`, secret key patterns, webview type, diagnostic code prefixes — see `docs/release/stable-identifiers.md`

### Completed modules in this release

- Parser and `.api` language support (grammar, snippets, providers)
- Request execution pipeline and response viewer
- Variables and environments
- Authentication profiles and Secret Storage integration
- Assertions engine and Problems integration
- Collections discovery and Activity Bar explorer
- Collection runner (collection / folder / selection)
- Request history
- OpenAPI import
