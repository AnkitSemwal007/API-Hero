/**
 * Architecture notes for Variable IntelliSense (completion, hover, validation, preview).
 */

# Variable IntelliSense

## Goal

Provide a native-feeling `{{variable}}` completion experience in every surface
that supports interpolation, without changing syntax or resolution semantics.

## Components

| Piece | Location | Role |
| --- | --- | --- |
| `VariableCompletionService` | `src/variables/variable-completion-service.ts` | Catalog, cache, fuzzy filter, insert/hover/preview models |
| `RuntimeParserAdapter` | `src/language-support/core/runtime-parser-adapter.ts` | Text-editor completions, hover, warning diagnostics |
| Request Editor host | `register-request-editor.ts` | Posts safe `variableCompletions` with each form state |
| Request Editor webview | `variable-intellisense-script.ts` + HTML | Popup UI, keyboard UX, inline resolved preview |

## Precedence

Effective definitions follow the resolver: **run > document (Request) >
environment > collection > workspace > global**. Duplicate names collapse to the
winning scope in the catalog.

## Completion detail

`description` / VS Code `detail` is built by `formatVariableCompletionDetail`:

- Scope labels stay product-facing (`Request`, `Environment`, `Collection`,
  `Run`, `Workspace`, `Global`)
- Environment-scoped items prefer `Environment: <active env name>` when the
  host stamps optional `VariableDefinition.environmentName` (IntelliSense-only;
  ignored by the resolver)
- Sensitive items append `· Secret value` and never include `valuePreview`

## Locations

| Surface | Where `{{` completion activates |
| --- | --- |
| `.api` text editor | Any line with an open `{{` region (URL, headers, body, directives, and **comment lines** — so commented-out headers that still contain `{{name}}` keep working). Pure comment gating is intentionally not applied. |
| Request Editor | Fields marked `data-var-complete`: URL, header/query/form/multipart values, body text, assertion expected value, and Variables-tab name/value cells. Name/description/auth/timeout controls stay unbound. |

## Catalog refresh

| Change | How the catalog refreshes |
| --- | --- |
| Active environment / workspace / global settings | `EnvironmentManager.onDidChange` clears language-adapter caches and re-posts Request Editor state |
| Collection variable load (cache miss) or persist | Extension notifies shared catalog listeners (language providers + open Request Editors) |
| Document `@variable` / form Variables tab | Adapter rebuild on document version; Request Editor merges live form rows over the posted catalog |
| Run / overlay definitions | Included via `externalVariableContext` on the next adapter/editor snapshot |

## Caching

`setDefinitions` fingerprints name/scope/sensitive/value/`environmentName`.
Identical snapshots reuse the previous catalog. Filtering is in-memory only.

## Security

Completion and hover never include sensitive values. Mask glyph: `••••••••`.
Webview catalogs omit `valuePreview` for sensitive entries; detail shows
`Secret value` instead.

## Registration for future editors

1. Construct or share a `VariableCompletionService`.
2. Call `setDefinitions` when the snapshot changes.
3. Use `analyzeInput` + `getCompletions` + `buildInsertText` at the caret.
4. Optionally `resolvePreview` / `suggestCorrection` for chrome and warnings.
