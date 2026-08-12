# Roadmap

Honest near-term plan for **API Hero** after **2.8.4** (OpenAPI environment safety, Collection Run Report / Variable Trace UX, Scenario menu cleanup; **2.8.3** Copy as cURL + MCP `apihero_run_scenario`; **2.8.2** OpenAPI URL import; **2.8.1** complete README + Marketplace documentation; **2.8.0** universal MCP `--workspace` + client-owned MCP docs; **2.7.0** MCP server for AI agents; **2.6.0** Scenarios progressive disclosure, project-store scenario paths, Reset Workspace, Run Report failure diagnostics; Authentication Premium UX + Scenario Experience shipped in **2.5.0**; Scenarios Phase 1 foundation in **2.4.0**). Product features through **2.3.x** already ship — Execution Center, Collection Runner / Run Report polish, dependency workflow, Collection Run Debugger, Managers (Environments, Auth), Overview, History Detail, OpenAPI wizard, Response copy/save/search, response variable extraction, and collection chaining (`@depends-on`, per-run store, collection variables). Those are not roadmap gaps.

## Shipped in 2.8.4

| Item | Notes |
| --- | --- |
| OpenAPI environment safety | Preserve active env on import; imported envs selectable; undefined security schemes warn without inventing auth |
| Collection Run Report UX | Compact summary/rows, filters, folder grouping, drill-down Details |
| Variable Trace UX | Compact Variables status; expand for full trace / unresolved |
| Scenario menu cleanup | Create Scenario removed from Collections top-level `…`; dedicated Scenario UX unchanged |

## Shipped in 2.8.3

| Item | Notes |
| --- | --- |
| Copy as cURL | Resolve without HTTP; secrets redacted by default |
| MCP `apihero_run_scenario` | Existing ScenarioEngine (same path as UI Run Scenario) |

## Shipped in 2.8.2

| Item | Notes |
| --- | --- |
| OpenAPI URL import | Fetch OpenAPI 3.0/3.1 from HTTP(S) URL into the existing importer |

## Shipped in 2.8.1

| Item | Notes |
| --- | --- |
| Complete public README / docs pin | Marketplace landing + developer reference; storage paths corrected; release readiness pinned to **2.8.1** |

## Shipped in 2.8.0

| Item | Notes |
| --- | --- |
| Universal MCP `--workspace` | CLI workspace flag preferred over `APIHERO_WORKSPACE`; client-owned Codex/Cursor/Claude docs; no auto-registration |

## Shipped in 2.7.0

| Item | Notes |
| --- | --- |
| MCP server for AI agents | Stdio MCP tools over Collection Runner / Execution Orchestrator; secret-safe payloads; Cursor / Claude / Codex docs |

## Shipped in 2.6.0

| Item | Notes |
| --- | --- |
| Scenarios progressive disclosure | Activity Bar Scenarios hidden until load/create; sticky per workspace |
| Scenario storage consolidation | Canonical `.apihero/scenarios/` with legacy `.api-hero/scenarios` migration |
| Reset Workspace | Command Palette–only destructive reset of API Hero workspace data |
| Run Report failure diagnostics | Categorized failure details in Collection Run Report |

## Shipped in 2.5.0

| Item | Notes |
| --- | --- |
| Authentication Premium UX | Auth Manager redesign, Login API / Session, one-shot Bearer, collection default, response→auth, health/identity/preview |
| Scenario Experience | Templates, editor palette/binding, last-run status, live step status |

## Shipped in 2.4.0

| Item | Notes |
| --- | --- |
| Scenarios Phase 1 | `.apihero/scenarios/*.scenario.json`, Scenario Editor, Run Reports, `apiHero.explorer` view |

## Near term

| Item | Notes |
| --- | --- |
| **Headless CLI / CI Runner — Planned / In Development** | Not currently distributed or shipped as a public product capability; implementation may exist in-repo |
| Marketplace asset refresh | Capture Auth Manager + Scenario Editor screenshots; keep README section images in sync |
| Scenarios Phase 2+ | Deeper step types / orchestration polish after Experience feedback |
| Run File | Implement multi-request file execution (today: stub, palette-hidden) |
| Examples pack | Curated `.api` samples including extract flows; optional scenario samples |
| Docs drift checks | Keep user/architecture docs matched to `package.json` |
| Configure MCP for Codex | Convenience command to write/open official Codex config with user consent (**not implemented**) |

## Later

| Item | Notes |
| --- | --- |
| OAuth2 / OIDC | New auth provider + secure token handling; not in 2.0.1 |
| Cookie jar | Explicit product + security design required |
| Code Actions | Optional language assist (not shipped) |
| Import Hub extras | Swagger 2 / Postman / Insomnia only if provider model stays thin |

## Explicitly not claiming

Do not schedule "build Env Manager / Auth Manager / Overview / Extraction / collection chaining / Execution Center / Scenarios Phase 1 / Authentication Premium UX / Scenario Experience" — those exist. Prefer polish, docs, and assets before large new auth protocols.

## Related

- [Product index](./README.md)
- [Vision](./vision.md)
- [User guide](../user/getting-started.md)
- [Scenarios](../user/scenarios.md)
- [CLI (not publicly distributed)](../user/cli.md)
- [ADR-0001](../architecture/adr/0001-variables-extraction-auth-dependencies.md)
