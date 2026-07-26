# Product

**API Hero** is a VS Code REST/HTTP client built around editable `.api` files, workspace collections, and a small Activity Bar surface.

| Doc | Purpose |
| --- | --- |
| [Vision](./vision.md) | Why API Hero exists |
| [Roadmap](./roadmap.md) | Near-term honest plan |
| [North star](./north-star.md) | Longer-term experience target (aspirational) |

Implementation is source of truth. Prefer [user docs](../user/getting-started.md) and [architecture](../architecture/README.md) for what ships today.

## Vision (short)

Help developers author, run, assert, and review HTTP APIs without leaving the editor — with git-friendly text artifacts and secure secret handling.

## What shipped in 2.1.1

- Everything from **2.0.1** (Phase 1 extraction + Phase 2 collection chaining)
- **Create Variable From Response** in the Response Viewer (context menu, Save as variable, confirmation sheet, Mode B `@extract` persist)
- **Workspace-scope** extraction writes; Collection + Workspace scopes in the Request Editor Extract tab
- Collection-scope extract outside collection runs (with cache refresh)
- Run report **consumed variables** (`-varName`) alongside produced vars

Not in 2.1.1: OAuth2, cookie jar, Code Actions, GraphQL, full Run File, Global-scope extract (manual only).

## What shipped in 2.0.1 (Phase 1 + Phase 2)

- Everything from the 0.6.x line (Request Editor, Collections, History, Env/Auth managers, OpenAPI wizard, Run Report)
- **Extraction Engine** with `@extract` / `@sensitive-extract`
- Request Editor **Extract** tab and Response Viewer **extraction report**
- Variable resolution overlay (document / environment / collection / workspace / run scopes)
- Post-execution extraction pipeline and parser diagnostics for extract directives
- **Collection chaining** (`@depends-on`, produces/consumes edges, topo-ordered runner, per-run store, pre-flight dependency skip)
- Collection-scope variables (`api-hero.variables.json` + sensitive local overlay)

## Related

- [Commands](../reference/commands.md)
- [Marketplace readiness](../release/marketplace-readiness.md)
- [Docs index](../README.md)
