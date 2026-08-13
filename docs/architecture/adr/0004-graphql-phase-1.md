# ADR 0004 — GraphQL Phase 1 (HTTP adapter)

Status: Accepted

## Decision

GraphQL query and mutation support is an **HTTP-level protocol adapter** above the existing `RequestExecutor` / `NodeHttpTransport` path. It is not a second runner, transport, variable resolver, authentication system, or ScenarioEngine.

```text
ExecutionOrchestrator
        → RequestExecutor
        → GraphQL HTTP adaptation (when @protocol graphql)
        → NodeHttpTransport (unchanged, HTTP-only)
```

`HttpTransport` remains HTTP-only. There is no protocol registry or dispatcher framework in Phase 1. The executor applies a small GraphQL prepare/attach step when the request protocol is `graphql`; otherwise the existing HTTP path is unchanged.

## Protocol marker

Smallest grammar-compatible representation: known directive `@protocol`.

| Authored value | Behavior |
| --- | --- |
| omitted | HTTP (backward compatible) |
| `http` | existing HTTP path |
| `graphql` | GraphQL adapter, then `NodeHttpTransport` |
| any other value | semantic **error** — never silently treated as HTTP |

GraphQL-over-HTTP payload remains a JSON body:

```json
{
  "query": "...",
  "variables": { },
  "operationName": "..."
}
```

Existing `{{variable}}` substitution runs on URL, headers, and body content **before** the adapter canonicalizes the GraphQL JSON. No GraphQL-specific resolver.

## Success model

`ExecutionResult.success` stays transport-level (an HTTP response was received), including HTTP 4xx/5xx — same as REST.

Orchestrator **outcome** for `@protocol graphql` is success only when all of:

- transport succeeded
- HTTP status is 2xx
- response JSON is a GraphQL envelope (`data` and/or `errors`)
- `errors` is absent or empty
- assertions did not fail

HTTP 200 with `errors` (including partial `data` + `errors`) is **not** a successful GraphQL operation. Extraction still runs (not gated on GraphQL/assertion pass).

REST/HTTP requests (missing protocol or `@protocol http`) keep the historical rule: `success && !assertionFailed`, including HTTP 4xx without assertions.

Collection retry keeps the existing HTTP retryable statuses (`408` / `429` / `502` / `503` / `504`) for GraphQL. Mapping GraphQL operation failure onto the Protocol category does not make HTTP 503 non-retryable. HTTP 200 with GraphQL `errors` remains non-retryable.

The Protocol failure category is labelled **Protocol Error** (HTTP non-2xx, invalid envelope, and GraphQL `errors[]`). It is not labelled “GraphQL Errors” for every Protocol failure.

## Out of scope

- GraphQL subscriptions
- Persistent WebSockets / GraphQL over WebSocket
- gRPC
- GraphQL schema / Postman / Insomnia GraphQL import (import stubs unchanged)
- New CLI flags or MCP tools
- New npm GraphQL client libraries

Bounded WebSocket request/response sessions are specified separately in
[ADR-0005](./0005-websocket-phase-1.md). gRPC remains deferred.
