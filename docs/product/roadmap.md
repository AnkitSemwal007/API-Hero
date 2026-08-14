# Roadmap

Honest near-term plan for **API Hero** after **2.12.1** (docs + Marketplace icon patch on top of **2.9.0** Postman Import, Insomnia Import, cURL→`.api`, Variable Autocomplete polish, Failure Diagnostics Possible causes, Request/Response Diff, TypeScript generation, VSIX esbuild bundling; **2.8.4** Collection Execution Controls, OpenAPI environment safety + sensitive server vars, header masking alignment, Collection Run Report / Variable Trace UX, Scenario menu cleanup; **2.8.3** Copy as cURL + MCP `apihero_run_scenario`; **2.8.2** OpenAPI URL import; **2.8.1** complete README + Marketplace documentation; **2.8.0** universal MCP `--workspace` + client-owned MCP docs; **2.7.0** MCP server for AI agents; **2.6.0** Scenarios progressive disclosure, project-store scenario paths, Reset Workspace, Run Report failure diagnostics; Authentication Premium UX + Scenario Experience shipped in **2.5.0**; Scenarios Phase 1 foundation in **2.4.0**). Product features through **2.3.x** already ship — Execution Center, Collection Runner / Run Report polish, dependency workflow, Collection Run Debugger, Managers (Environments, Auth), Overview, History Detail, OpenAPI wizard, Response copy/save/search, response variable extraction, and collection chaining (`@depends-on`, per-run store, collection variables). Those are not roadmap gaps.

## Shipped in 2.9.1

| Item | Notes |
| --- | --- |
| Marketplace icon restoration | `images/icon.png` restored to pre-Cursor version |
| README / Marketplace docs completeness | Diff, TypeScript generation, Failure Diagnostics, Postman/Insomnia/cURL, dependencies/data flow documented as product capabilities (features from **2.9.0**) |
| Marketplace description clarity | Import formats: OpenAPI / Postman / Insomnia / cURL |

## Shipped in 2.9.0

| Item | Notes |
| --- | --- |
| Postman Collection import | v2/v2.1 → Collections + `.api` via `SpecificationImportProvider`; preview + diagnostics; scripts never executed |
| Insomnia export import | Resource-based export v3/v4 → Collections + `.api` via shared wizard host + `InsomniaImportProvider` |
| cURL → `.api` | `apiHero.importCurl`: in-process curl parse → single `.api` file; completes Copy as cURL round trip |
| Variable Autocomplete polish | Scope / Environment labels; secret-safe detail; catalog refresh on collection/env changes |
| Failure Diagnostics Possible causes | Deterministic status/transport explanations on Request Editor, Run Report Details, MCP diagnostics |
| Request/Response Diff | Compare Previous vs Current (in-session) + Compare Runs from Collection Run Manager |
| TypeScript Type Generation | Successful JSON Response → Generate TypeScript; Copy / Create `.ts` |
| VSIX esbuild bundling | Minified CJS entry bundles; runtime deps inlined; ~659 KB / 21 files |

## Shipped in 2.8.4

| Item | Notes |
| --- | --- |
| Collection Execution Controls | Run Options retry + optional DELETE skip; attempt progress vs final outcome |
| OpenAPI environment safety | Preserve active env on import; imported envs selectable; undefined security schemes warn without inventing auth |
| OpenAPI sensitive server vars | Server `{variables}` named like secrets import as `sensitive: true` |
| Sensitive header masking alignment | Response UI matches MCP/cURL (`x-api-key`, `x-auth-token`, …) |
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

## Shipped in 2.12.1

| Item | Notes |
| --- | --- |
| GraphQL Request Editor | Protocol selector GraphQL; Query / Variables / Operation name; GraphQL Errors card |
| WebSocket Request Editor | Protocol selector WebSocket; bounded **Run Session**; session/message presentation |
| HTTP / GraphQL / WebSocket protocol selection | Toolbar writes `@protocol`; HTTP omits the directive |
| Environment & Variables UI | Environment Manager + Request Editor Variables tab + Run Setup variable preview |
| Centralized Authentication UI | No Auth, Bearer Token, Basic Auth, API Key; shared across Request Editor, Collection Auth, Run Setup. OAuth is not included |
| Collection Run Setup | Environment, variables, authentication, request selection, Continue/Stop; **Run Again** restores config |
| Report presentation | GraphQL errors and WebSocket session/message views; JSON/HTML export unchanged |
| Secret redaction | Masking, WebSocket close-reason redaction, no secrets in History |

## Shipped in 2.12.0

| Item | Notes |
| --- | --- |
| Source-code integration | Explicit `@api-hero` / `@source` mappings; CodeLens, hover, Open Definition / Related Source; Run and Generate TypeScript reuse existing engines |
| Collection Run Report export | Redacted JSON and standalone HTML snapshots of the existing report model |
| Project package v1 | VS Code Export / Import of `.apihero` (formatVersion 1); secrets and Scenarios excluded |
| Scenario product surface | Scenarios are not a current VS Code product capability |

## Near term

| Item | Notes |
| --- | --- |
| **Headless CLI / CI Runner** | Shipped in **2.10.0** — `apihero` npm bin; shared headless runtime with MCP |
| **GraphQL query / mutation over HTTP** | Shipped in **2.11.0** — `@protocol graphql`; reuses `NodeHttpTransport`; no subscriptions |
| **WebSocket bounded sessions** | Shipped in **2.11.0** — `@protocol websocket`; dedicated transport; no persistent connections |
| Marketplace asset refresh | Capture Auth Manager screenshots; keep README section images in sync |
| Run File | Implement multi-request file execution (today: stub, palette-hidden) |
| Examples pack | Curated `.api` samples including extract flows |
| Docs drift checks | Keep user/architecture docs matched to `package.json` |
| Configure MCP for Codex | Convenience command to write/open official Codex config with user consent (**not implemented**) |

## Later

| Item | Notes |
| --- | --- |
| OAuth2 / OIDC | New auth provider + secure token handling; not in 2.0.1 |
| Cookie jar | Explicit product + security design required |
| WebSocket streaming / persistent connections | Subscriptions, reconnect, infinite streams — not Phase 1 |
| gRPC | Not started |
| Code Actions | Optional language assist (not shipped) |
| Import Hub extras | Swagger 2 only if provider model stays thin (Postman + Insomnia + cURL import shipped in **2.9.0**) |

## Explicitly not claiming

Do not schedule "build Env Manager / Auth Manager / Overview / Extraction / collection chaining / Execution Center / Postman Import / Insomnia Import / cURL→.api" — those exist. Prefer polish, docs, and assets before large new auth protocols. Historical shipped tables above already record past Scenario work; do not treat Scenario UX as a current product capability to build upon.

## Related

- [Product index](./README.md)
- [Vision](./vision.md)
- [User guide](../user/getting-started.md)
- [CLI](../user/cli.md)
- [ADR-0001](../architecture/adr/0001-variables-extraction-auth-dependencies.md)
