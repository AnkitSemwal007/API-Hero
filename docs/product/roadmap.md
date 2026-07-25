# Roadmap

Honest near-term plan for **API Hero** after **1.0.0** (Phase 1 — extraction). Managers (Environments, Auth), Overview, History Detail, Run Report, OpenAPI wizard, Response copy/save/search, and response variable extraction already ship — they are not roadmap gaps.

## Near term (Phase 2+)

| Item | Notes |
| --- | --- |
| Collection chaining | `@depends-on`, runner-owned run store lifecycle, collection variables, topo/report |
| Marketplace screenshots / GIFs | Capture Request Editor (Extract), Collections, Response (extraction report), History, managers |
| README / listing copy | Align with shipped 1.0.0 features only |
| Run File | Implement multi-request file execution (today: stub, palette-hidden) |
| Examples pack | Curated `.api` samples including extract flows |
| Docs drift checks | Keep user/architecture docs matched to `package.json` |

## Later

| Item | Notes |
| --- | --- |
| OAuth2 / OIDC | New auth provider + secure token handling; not in 1.0.0 |
| Cookie jar | Explicit product + security design required |
| Code Actions | Optional language assist (not shipped) |
| Import Hub extras | Swagger 2 / Postman / Insomnia only if provider model stays thin |
| CLI / CI runner | Separate distribution concern |

## Explicitly not claiming

Do not schedule “build Env Manager / Auth Manager / Overview / Extraction” — those exist. Prefer Phase 2 collection chaining, polish, docs, and assets before large new auth protocols.

## Related

- [Product index](./README.md)
- [Vision](./vision.md)
- [User guide](../user/getting-started.md)
- [ADR-0001](../architecture/adr/0001-variables-extraction-auth-dependencies.md)
