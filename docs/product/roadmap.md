# Roadmap

Honest near-term plan for **API Hero** after **2.4.0** (Scenarios Phase 1 shipped — Scenario Engine, Editor, Run Reports, and Scenarios Activity Bar view). Product features through **2.3.x** already ship — Execution Center, Collection Runner / Run Report polish, dependency workflow, Collection Run Debugger, Managers (Environments, Auth), Overview, History Detail, OpenAPI wizard, Response copy/save/search, response variable extraction, and collection chaining (`@depends-on`, per-run store, collection variables). Those are not roadmap gaps.

## Shipped in 2.4.0

| Item | Notes |
| --- | --- |
| Scenarios Phase 1 | `.api-hero/scenarios/*.scenario.json`, Scenario Editor, Run Reports, `apiHero.explorer` view |

## Near term

| Item | Notes |
| --- | --- |
| Scenarios Phase 2+ | Deeper step types / orchestration polish after Phase 1 feedback |
| Marketplace asset refresh | Update Cloudinary captures when UI changes (include Scenarios); keep README section images in sync |
| Run File | Implement multi-request file execution (today: stub, palette-hidden) |
| Examples pack | Curated `.api` samples including extract flows; optional scenario samples |
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

Do not schedule "build Env Manager / Auth Manager / Overview / Extraction / collection chaining / Execution Center / Scenarios Phase 1" — those exist. Prefer polish, docs, and assets before large new auth protocols.

## Related

- [Product index](./README.md)
- [Vision](./vision.md)
- [User guide](../user/getting-started.md)
- [Scenarios](../user/scenarios.md)
- [ADR-0001](../architecture/adr/0001-variables-extraction-auth-dependencies.md)
