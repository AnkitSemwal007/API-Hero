# Stable identifiers

Canonical contribution IDs use the **`apiHero.*`** namespace. Legacy **`apiRunner.*`** aliases remain registered where noted so existing keybindings, workspaces, and secret keys keep working.

**Compatibility warning:** Renaming published command IDs, view IDs, setting keys, language id, grammar `scopeName`, custom editor `viewType`, or Secret Storage key patterns breaks user keybindings, settings sync, and saved workspaces. Change titles and descriptions freely; change IDs only with an explicit migration plan (as documented below).

## Extension (Marketplace metadata)

| Kind | Value |
| --- | --- |
| `package.json` `name` | `api-hero` |
| `package.json` `publisher` | `ankitsemwal` |
| Extension ID | `ankitsemwal.api-hero` |
| `EXTENSION_ID` constant | `ankitsemwal.api-hero` |

## Commands (canonical)

All contributed command IDs use the `apiHero.*` prefix. At runtime every public command is also registered under the matching `apiRunner.*` legacy alias (`LEGACY_COMMAND_IDS` / `registerCommandWithLegacyAlias`).

### Execution and stubs

- `apiHero.runRequest` (alias `apiRunner.runRequest`)
- `apiHero.runRequestWithAssertions`
- `apiHero.runFile`
- `apiHero.login`
- `apiHero.logout`

### Environments and authentication

- `apiHero.switchEnvironment`
- `apiHero.manageEnvironments`
- `apiHero.manageAuthProfiles`
- `apiHero.selectAuthentication`
- `apiHero.initializeProjectStore`
- `apiHero.resetWorkspace`
- `apiHero.setAuthSecret` (internal; not listed in `package.json` contributes; alias `apiRunner.setAuthSecret`)

### Collections and CRUD

- `apiHero.refreshCollections`
- `apiHero.filterCollections`
- `apiHero.revealActiveRequest`
- `apiHero.openCollectionRequest`
- `apiHero.focusCollections`
- `apiHero.createCollection`
- `apiHero.renameCollection`
- `apiHero.deleteCollection`
- `apiHero.duplicateCollection`
- `apiHero.exportCollection`
- `apiHero.importCollection`
- `apiHero.createFolder`
- `apiHero.renameFolder`
- `apiHero.deleteFolder`
- `apiHero.duplicateFolder`
- `apiHero.createRequest`
- `apiHero.renameRequest`
- `apiHero.duplicateRequest`
- `apiHero.deleteRequest`
- `apiHero.moveRequest`

### Collection runner

- `apiHero.runCollection`
- `apiHero.runCollectionTests`
- `apiHero.runFolder`
- `apiHero.runSelectedRequests`

### Execution view

- `apiHero.focusExecution`
- `apiHero.cancelCollectionRun`
- `apiHero.openLiveRunReport`
- `apiHero.openRecentRunReport`
- `apiHero.revealExecutionCollection`
- `apiHero.copyCollectionRunId`

### History

- `apiHero.focusHistory`
- `apiHero.openHistoryEntry`
- `apiHero.rerunHistoryEntry`
- `apiHero.revealHistoryRequest`
- `apiHero.copyHistorySummary`
- `apiHero.deleteHistoryEntry`
- `apiHero.clearHistory`
- `apiHero.searchHistory`
- `apiHero.refreshHistory`

### Scenarios

- `apiHero.refreshScenarios`
- `apiHero.openScenarioEditor`
- `apiHero.runScenario`
- `apiHero.createScenario`
- `apiHero.focusScenarios`

### Import and navigation

- `apiHero.importOpenApi`
- `apiHero.openWorkspace`
- `apiHero.openRequestEditor`
- `apiHero.openOverview`
- `apiHero.openSettings`
- `apiHero.recentRequests`

## Configuration

Canonical settings keys use the `apiHero.*` namespace (for example `apiHero.logLevel`, `apiHero.variables.global`, `apiHero.authentication.profiles`, `apiHero.collectionRunner.failurePolicy`).

On activate, `migrateConfigurationNamespace` copies inspected `apiRunner.*` values into `apiHero.*` (User / Workspace / WorkspaceFolder) when the new key is unset, then clears the legacy value. Idempotent via `globalState` flag `apiHero.migration.configuration.v1`.

## Views

| Kind | Value |
| --- | --- |
| Activity Bar container | `apiHero` |
| Collections view | `apiHero.collections` |
| Scenarios view (UX label **Scenarios**; stable id `explorer`) | `apiHero.explorer` |
| Execution view | `apiHero.execution` |
| History view | `apiHero.history` |
| Collections DnD mime | `application/vnd.code.tree.apiHero.collections` |

## Language, grammar, and editors

| Kind | Value |
| --- | --- |
| Language id | `api` |
| Grammar `scopeName` | `source.api-runner` (**unchanged** — TextMate / theme compatibility) |
| TextMate scope suffixes | `*.api-runner` (for example `comment.line.number-sign.api-runner`) |
| Request Editor custom editor (canonical) | `apiHero.requestEditor` (priority `default`) |
| Request Editor custom editor (legacy alias) | `apiRunner.requestEditor` (priority `option`; dual-registered) |

The grammar display `"name"` field may be **API Hero**; `scopeName` must not change.

Menu / keybinding `when` clauses that care about the custom editor accept either view type.

## Secrets

Canonical Secret Storage key pattern: `apiHero.auth.profile.*` (`authenticationSecretKey`).

Legacy reads fall back to `apiRunner.auth.profile.*` and lazily copy + delete the old key (`legacyAuthenticationSecretKey`). `SecretStorageService.onDidChange` fires for both prefixes during the compatibility window.

## Webview panel viewTypes

Session-scoped panel types (hard rename; no alias):

| Panel | viewType |
| --- | --- |
| Response | `apiHero.response` |
| Collection run report | `apiHero.collectionRunReport` |
| Destination picker | `apiHero.destinationPicker` |
| Environment manager | `apiHero.environmentManager` |
| Auth manager | `apiHero.authManager` |
| OpenAPI import wizard | `apiHero.openapiImportWizard` |
| CRUD prompt | `apiHero.crudPrompt` |
| Overview | `apiHero.overview` |
| New request | `apiHero.newRequest` |
| History detail | `apiHero.historyDetail` |
| Assertions | `apiHero.assertions` |
| Scenario editor | `apiHero.scenarioEditor` |
| Scenario run report | `apiHero.scenarioRunReport` |

## Diagnostics

Diagnostic **codes** that use `api-runner.*` prefixes (for example `api-runner.unknown-method`) must not change. User-visible diagnostic **source labels** may say API Hero / API Hero Variables / API Hero Assertions.

## Intentionally remaining `apiRunner` / `api-runner`

- Legacy command alias contributions in `package.json` (hidden from Command Palette) plus runtime dual registration (`LEGACY_COMMAND_IDS` / `registerCommandWithLegacyAlias`) so cold keybindings still activate the extension
- Legacy custom editor `apiRunner.requestEditor` contribution + registration
- Legacy secret key prefix fallback / dual `onDidChange` watch
- TextMate `scopeName` `source.api-runner` and `*.api-runner` token scopes
- Diagnostic codes `api-runner.*`
- Historical CHANGELOG entries (not rewritten)

## Alias sunset (later major)

When removing compatibility aliases, delete in this order:

1. Legacy `apiRunner.*` entries from `contributes.commands` and Command Palette hides
2. `registerCommandWithLegacyAlias` / `LEGACY_COMMAND_IDS` / `toLegacyCommandId`
3. Legacy custom editor contribution + second `registerCustomEditorProvider`
4. Secret legacy read/migrate + `LEGACY_AUTH_SECRET_KEY_PREFIX` dual watch (after confirming secrets migrated)
5. `LEGACY_CONFIGURATION_SECTION` and the settings migrator module (after confirming settings migrated)
6. Update this document to drop the compatibility sections

## What may change

- `displayName`, command **titles**, configuration **title**/descriptions, `EXTENSION_NAME`, README, CHANGELOG, Marketplace SEO fields (`description`, `keywords`, `categories`, `galleryBanner`)
- Empty-state `viewsWelcome` copy
