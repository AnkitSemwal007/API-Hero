# Source-code integration

VS Code CodeLens, hover, and navigation between application source and `.api`
requests, plus Quick Run from a detectable `fetch("https://...")` call. Lives in
`src/source-integration/` (framework-free catalog, annotation parse, Quick Run
detect/match) and `src/source-integration/vscode/` (providers, commands,
QuickPick, file open).

## Boundary

```text
CodeLens / Hover / Command / Quick Run
  → ExecutionOrchestrator.runAtPosition
  → RequestExecutor
```

No second `.api` parser, HTTP runner, type generator, or redaction system.
TypeScript generation calls existing `generateTypeScriptFromJson` /
`ResponseViewerService.generateTypeScript`. Quick Run uses a bounded `fetch(`
scanner (not a JavaScript parser or AST) to map literals into
`RequestSourceDocument` and reuses `serializeRequestDocument`. It does not
share the cURL parser and does not execute JavaScript.

## Quick Run vs persistent mapping

**Persistent mapping** requires explicit annotations (`// @api-hero …`, JSDoc
`@api-hero` / `@apiHero`) and authored `@source` on `.api` files. Unique
`@name`, `.api` path, or `@id`. Ambiguous, invalid, or missing mappings produce
no CodeLens and must not silently pick a request. CodeLens is never offered for
a bare URL.

**Quick Run** does not require `@api-hero`. `detectFetchAtCursor` finds the
`fetch(` call under the cursor in JS/TS/JSX/TSX, extracts a literal URL
(`http://` or `https://` only), optional literal method/headers/body, then:

1. Unique catalog match on **exact method + normalized concrete URL** → reuse
   that `.api` file’s text (do not overwrite auth/vars/body/metadata)
2. Several matches → VS Code QuickPick (name + relativePath); cancel → temporary
3. None → serialize a temporary `.api` document and pass it to `runAtPosition`

Temporary runs use `MappedRunRequestSource` `{ text, sourceId, offset }` with
`sourceId` `untitled:api-hero-quick-run.api`. They are not saved to Collections
and are **not** opened as untitled `language: api` documents (those would leak
into `collectOpenApiOverlays`). History rerun of a Quick Run may not reopen the
original source file.

Matching never expands `{{baseUrl}}` or other variables. Catalog URLs that are
not parseable absolute `http:` / `https:` never match. GraphQL and WebSocket
catalog entries are skipped. Identifier URLs/bodies and interpolated templates
fail closed.

`registerSourceIntegration` exposes `resolveMappedRun` (CatalogRequest, mapping
only) and `resolveSourceRun` (MappedRunRequestSource: mapping, then Quick Run).
Run Request still prefers an active `.api` document, then `resolveSourceRun`.

The catalog is built from Collection discovery plus open `.api` document
overlays. Activation does not scan the repository. `.api` text changes debounce
catalog rebuild; source CodeLens parses only the current document.

## Related

- [User guide](../user/source-integration.md)
- [Execution](./execution.md)
- [Response](./response.md)
