# Marketplace readiness — 2.10.0

Checklist for publishing **API Hero** `ankitsemwal.api-hero` **2.10.0** (public `apihero` CLI npm packaging + CLI scenario CI exit policy on the shared headless runtime; builds on **2.9.1** docs/icon patch and **2.9.0** feature set).

**Note:** The headless CLI is a shipped npm/`npx` capability in **2.10.0**. Marketplace install still does **not** put `apihero` on PATH — document CLI via npm/`npx` in README / [user/cli.md](../user/cli.md).

## Version pins

| Field | Value |
| --- | --- |
| `version` | `2.10.0` |
| Extension ID | `ankitsemwal.api-hero` |

## Packaging

- [x] `npm pack` produces `api-hero-2.10.0.tgz` (~661 KB / 16 files) including `dist/cli/main.js`, excluding `src/`
- [x] `npm run package` / `package-vsix.mjs` produces `release/api-hero-2.10.0.vsix` (~666 KB / ~17 files) with `files` allowlist (script moves `.vscodeignore` aside for vsce XOR)
- [x] Clean install: `npx apihero --version` / Windows temp-prefix `apihero --help` verified

## Docs

- [x] README advertises CLI only after packaged install acceptance
- [x] [CLI guide](../user/cli.md) — install, commands, workspace, exit codes, scenario CI semantics
- [x] MCP docs note shared headless runtime with public CLI
- [x] Changelog + [v2.10.0 release notes](./v2.10.0-release-notes.md)

## Related

- [Changelog — 2.10.0](../../CHANGELOG.md)
- [Prior — 2.9.1](./v2.9.1-release-notes.md)
