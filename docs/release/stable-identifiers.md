# Stable identifiers (do not change)

These IDs are intentionally **unchanged** for workspace and keybinding compatibility. User-facing brand text says **API Hero**; runtime contribution IDs remain historical `apiRunner` / `api-runner` forms where noted below.

## Extension (Marketplace metadata)

| Kind | Value |
| --- | --- |
| `package.json` `name` | `api-hero` |
| `package.json` `publisher` | `ankitsemwal` |
| Extension ID | `ankitsemwal.api-hero` |
| `EXTENSION_ID` constant | `ankitsemwal.api-hero` |

## Commands

All command IDs use the `apiRunner.*` prefix, including stubs:

- `apiRunner.runRequest`
- `apiRunner.runRequestWithAssertions`
- `apiRunner.runFile`
- `apiRunner.login`
- `apiRunner.logout`
- `apiRunner.switchEnvironment`
- `apiRunner.selectAuthentication`
- `apiRunner.refreshCollections`
- `apiRunner.revealActiveRequest`
- `apiRunner.openCollectionRequest`
- `apiRunner.focusCollections`
- `apiRunner.runCollection`
- `apiRunner.runCollectionTests`
- `apiRunner.runFolder`
- `apiRunner.runSelectedRequests`
- `apiRunner.focusHistory`
- `apiRunner.openHistoryEntry`
- `apiRunner.rerunHistoryEntry`
- `apiRunner.revealHistoryRequest`
- `apiRunner.deleteHistoryEntry`
- `apiRunner.clearHistory`
- `apiRunner.searchHistory`
- `apiRunner.refreshHistory`
- `apiRunner.importOpenApi`

## Configuration

All settings keys use the `apiRunner.*` namespace (for example `apiRunner.logLevel`, `apiRunner.variables.global`, `apiRunner.authentication.profiles`).

## Views

| Kind | Value |
| --- | --- |
| Activity Bar container | `apiRunner` |
| Collections view | `apiRunner.collections` |
| History view | `apiRunner.history` |

## Language & grammar

| Kind | Value |
| --- | --- |
| Language id | `api` |
| Grammar `scopeName` | `source.api-runner` |
| TextMate scope suffixes | `*.api-runner` (for example `comment.line.number-sign.api-runner`) |

The grammar display `"name"` field may be **API Hero**; `scopeName` must not change.

## Secrets

Secret Storage key pattern for auth profiles: `apiRunner.auth.profile.*` (implementation may compose prefixes from constants under the `apiRunner` namespace).

## Webview

| Kind | Value |
| --- | --- |
| Response webview type | `apiRunner.response` |

## Diagnostics

Diagnostic **codes** that use `api-runner.*` prefixes (for example `api-runner.unknown-method`) must not change. User-visible diagnostic **source labels** may say API Hero / API Hero Variables / API Hero Assertions.

## What may change

- `displayName`, command **titles**, configuration **title**/descriptions, `EXTENSION_NAME`, README, CHANGELOG, Marketplace SEO fields (`description`, `keywords`, `categories`, `galleryBanner`)
- Empty-state `viewsWelcome` copy
- Marketplace `publisher`, package `name`, and extension ID for first publish (now `ankitsemwal.api-hero`)
