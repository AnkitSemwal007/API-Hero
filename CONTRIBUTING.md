# Contributing to API Hero

Thanks for contributing. Implementation is the source of truth; keep docs in sync when behavior changes.

## Prerequisites

- Node.js 20+ (or current LTS used by the repo)
- VS Code 1.90+
- Familiarity with TypeScript and VS Code Extension API

## Setup

```bash
npm install
npm run compile
npm test
```

Press **F5** in VS Code to launch an Extension Development Host.

## Project layout (high level)

| Path | Responsibility |
| --- | --- |
| `src/parser` | `.api` lexer / AST / parse |
| `src/request-source` | Form ↔ `.api` serialization |
| `src/execution` / `orchestration` | HTTP execute + run UX |
| `src/variables` / `auth` / `assertions` | Domain pipelines (no VS Code in core) |
| `src/*/vscode` | Panels, trees, commands |
| `src/ui/webview` | Shared webview CSP / escape / styles |
| `docs/` | User, architecture, development, reference |

## Rules

1. **Stable IDs** — do not rename `apiRunner.*` commands, settings, view IDs, language id `api`, or grammar `scopeName` without a major-version plan. See `docs/release/stable-identifiers.md`.
2. **Layering** — core domain modules must not import `vscode`. Adapters live under `*/vscode`.
3. **Secrets** — never log or persist credential values; use Secret Storage for auth secrets.
4. **Webviews** — nonce CSP, validate inbound messages, prefer shared helpers in `src/ui/webview`.
5. **Tests** — add or update unit tests for domain changes (`npm test`).
6. **Docs** — update `docs/user` or architecture notes when shipping user-visible behavior; update `CHANGELOG.md`.

## Pull requests

- Keep PRs focused; avoid unrelated refactors.
- Describe *why* and note any user-facing impact.
- Do not commit secrets, `.vsix` build artifacts, or local backup bundles unless intentionally releasing.

## Code of conduct

Be respectful. Prefer actionable GitHub issues for bugs and enhancements.
