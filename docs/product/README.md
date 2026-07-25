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

## What shipped in 1.0.0 (Phase 1)

- Everything from the 0.6.x line (Request Editor, Collections, History, Env/Auth managers, OpenAPI wizard, Run Report)
- **Extraction Engine** with `@extract` / `@sensitive-extract`
- Request Editor **Extract** tab and Response Viewer **extraction report**
- Variable resolution overlay (document / environment / run scopes)
- Post-execution extraction pipeline and parser diagnostics for extract directives

Not in 1.0.0: collection chaining (`@depends-on`), OAuth2, cookie jar, Code Actions, GraphQL, full Run File.

## Related

- [Commands](../reference/commands.md)
- [Marketplace readiness](../release/marketplace-readiness.md)
- [Docs index](../README.md)
