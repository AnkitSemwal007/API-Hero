# Architecture Decision Records

Accepted ADRs are normative for future implementation. Domain docs under `docs/architecture/` describe the shipped system unless an ADR says otherwise.

| ADR | Status | Summary |
| --- | --- | --- |
| [0001 — Variables, Extraction, Auth & Dependencies](./0001-variables-extraction-auth-dependencies.md) | Accepted | Canonical pipeline, scopes, storage, lifecycle, deferred list, and phased roadmap |
| [0002 — Human-Readable Dependencies](./0002-authored-request-ids.md) | Accepted | Depend refs as names / `Folder/Name`; runtime discovery IDs only; rename cascade; no opaque `req_*` on disk |
| [0003 — Intelligent Variable & Dependency Autofill](./0003-intelligent-variable-dependency-autofill.md) | Accepted | Editor projects one dependency engine; Auto never persisted; no fixed-point loop; facade must not own graph logic |

Phase implementation specs and task plans (exact files, APIs, acceptance criteria) are normative for their phase only — see [docs/architecture/README.md](../README.md) for the full list:

| Spec | Status | Summary |
| --- | --- | --- |
| [P0 Implementation Spec](./0001-phase-0-implementation-spec.md) | Complete | Variable/extraction foundations (scopes, stubs, observer seam) |
| [P1 Implementation Spec](./0001-phase-1-implementation-spec.md) | Complete | Response variable extraction (`@extract`, engine, Extract tab) |
| [P2 Implementation Spec](./0001-phase-2-implementation-spec.md) | Complete (PRs 1–6) | Collection runner store, `@depends-on`, dependency graph, collection variables, run report |
