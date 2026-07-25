# Development

Guide for contributing to **API Hero** (`ankitsemwal.api-hero`).

## Repo structure

```text
src/
  extension.ts          # Activation / composition
  commands/             # Run request + stub commands
  constants/            # Command IDs, views, storage keys
  configuration/        # Settings helpers
  parser/ language-support/ orchestration/ execution/
  variables/ auth/ assertions/ response/
  collections/ collection-runner/ history/
  request-editor/ request-source/ openapi-import/ overview/
  ui/webview/           # Shared CSP, nonce, HTML helpers
  providers/            # VS Code settings adapters
package.json            # Contributions (commands, views, config)
docs/                   # User, architecture, product, release
```

Domain folders keep core logic free of `vscode`. Put host wiring in `*/vscode/`.

## Conventions

- Brand strings: **API Hero**. Stable IDs: `apiRunner.*` ([stable identifiers](../release/stable-identifiers.md)).
- Prefer immutable domain models; adapters own side effects.
- No direct `fetch()` outside the Request Engine / execution transport.
- Secret Storage only through the dedicated SecretStorage service.
- Parser logic stays in the parser / language-support modules.
- Prefer existing abstractions over new parallel services.

## Add a command

1. Add the command to `package.json` `contributes.commands` (and menus if needed).
2. Add the ID constant under `src/constants/commands.ts` if applicable.
3. Register the handler from the domain `register*` module called by `extension.ts`.
4. Keep titles user-facing (`API Hero: …`); never rename published IDs casually.

## Add a webview

1. Reuse helpers in `src/ui/webview/` (CSP nonce, escape, shared CSS, message record checks).
2. Keep HTML builders and message parsers unit-testable (no VS Code types in pure helpers).
3. Follow patterns in Environment Manager, Auth Manager, Response viewer, or Request Editor.
4. See [webviews.md](./webviews.md).

## Build, lint, test

| Script | Purpose |
| --- | --- |
| `npm run compile` | `tsc` → `dist/` |
| `npm run check` | Typecheck without emit |
| `npm run lint` | ESLint on `src/**/*.ts` |
| `npm test` | Compile, then unit tests (`node:test`) |
| `npm run test:coverage` | c8 coverage over unit tests |
| `npm run package` | `vsce package` |

Details: [testing.md](./testing.md).

## Debugging

1. Open the repo in VS Code / Cursor.
2. Launch the Extension Development Host (F5) using the workspace launch config if present.
3. Set breakpoints in TypeScript sources mapped via `sourceMap`.
4. Use the **API Hero** output channel (`apiRunner.logLevel`) for runtime logs.

## Related

- [Webviews](./webviews.md)
- [Testing](./testing.md)
- [Architecture](../architecture/README.md)
