# Roadmap

Honest near-term plan for **API Hero** after **2.0.1** (Phase 1 — extraction; Phase 2 — collection chaining). Managers (Environments, Auth), Overview, History Detail, Run Report, OpenAPI wizard, Response copy/save/search, response variable extraction, and collection chaining (`@depends-on`, per-run store, collection variables) already ship — they are not roadmap gaps.

## Near term

| Item | Notes |
| --- | --- |
| Marketplace screenshots / GIFs | Capture Request Editor (Extract), Collections, Response (extraction report), History, managers |
| README / listing copy | Align with shipped 2.0.1 features only |
| Run File | Implement multi-request file execution (today: stub, palette-hidden) |
| Examples pack | Curated `.api` samples including extract flows |
| Docs drift checks | Keep user/architecture docs matched to `package.json` |

## Later

| Item | Notes |
| --- | --- |
| OAuth2 / OIDC | New auth provider + secure token handling; not in 2.0.1 |
| Cookie jar | Explicit product + security design required |
| Code Actions | Optional language assist (not shipped) |
| Import Hub extras | Swagger 2 / Postman / Insomnia only if provider model stays thin |
| CLI / CI runner | Separate distribution concern |

## Explicitly not claiming

Do not schedule "build Env Manager / Auth Manager / Overview / Extraction / collection chaining" — those exist. Prefer polish, docs, and assets before large new auth protocols.

## Related

- [Product index](./README.md)
- [Vision](./vision.md)
- [User guide](../user/getting-started.md)
- [ADR-0001](../architecture/adr/0001-variables-extraction-auth-dependencies.md)
