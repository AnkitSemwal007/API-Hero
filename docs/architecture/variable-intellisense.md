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

Effective definitions follow the resolver: **document (Request) > environment >
workspace > global**. Duplicate names collapse to the winning scope in the
catalog.

## Caching

`setDefinitions` fingerprints name/scope/sensitive/value. Identical snapshots
reuse the previous catalog. Filtering is in-memory only.

## Security

Completion and hover never include sensitive values. Mask glyph: `••••••••`.
Webview catalogs omit `valuePreview` for sensitive entries.

## Registration for future editors

1. Construct or share a `VariableCompletionService`.
2. Call `setDefinitions` when the snapshot changes.
3. Use `analyzeInput` + `getCompletions` + `buildInsertText` at the caret.
4. Optionally `resolvePreview` / `suggestCorrection` for chrome and warnings.
