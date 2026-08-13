# Source-code integration

VS Code CodeLens, hover, and navigation between application source and `.api`
requests. Lives in `src/source-integration/` (framework-free catalog) and
`src/source-integration/vscode/` (providers and commands).

## Boundary

```text
CodeLens / Hover / Command
  → ExecutionOrchestrator.runAtPosition
  → RequestExecutor
```

No second parser, runner, type generator, or redaction system. TypeScript
generation calls existing `generateTypeScriptFromJson` /
`ResponseViewerService.generateTypeScript`.

## Mapping

Only explicit annotations (`// @api-hero …`, JSDoc `@api-hero` / `@apiHero`)
and authored `@source` on `.api` files. Unique `@name`, `.api` path, or `@id`.
Ambiguous or missing mappings produce no CodeLens.

The catalog is built from Collection discovery plus open `.api` document
overlays. Activation does not scan the repository. `.api` text changes debounce
catalog rebuild; source CodeLens parses only the current document.

## Related

- [User guide](../user/source-integration.md)
- [Execution](./execution.md)
- [Response](./response.md)
