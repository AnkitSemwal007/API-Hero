# ADR 0005 — WebSocket Phase 1 (bounded session)

Status: Accepted

## Decision

WebSocket Phase 1 is a **dedicated transport** used by `RequestExecutor` when `@protocol websocket` is set. It is not an HTTP adapter and does not implement `HttpTransport`.

```text
ExecutionOrchestrator
        → RequestExecutor
        → protocol selection (no registry)
        → WebSocket adapter (prepare URL + text message)
        → WebSocketTransport (Node `ws` client)
```

`NodeHttpTransport` remains HTTP-only. GraphQL remains an HTTP adapter above `NodeHttpTransport`. REST is unchanged.

There is no second runner, variable resolver, authentication system, or ScenarioEngine.

## Protocol marker

Same `@protocol` directive as GraphQL Phase 1.

| Authored value | Behavior |
| --- | --- |
| omitted | HTTP |
| `http` | HTTP |
| `graphql` | GraphQL-over-HTTP adapter |
| `websocket` | bounded WebSocket session |
| any other value | semantic **error** — never HTTP or WebSocket fallback |

## Session

CONNECT → optional SEND (request body as one UTF-8 text frame) → RECEIVE (one text frame) → CLOSE.

`@timeout` bounds the entire session. Incoming JSON reuses existing assertion and extraction engines via `RuntimeResponse.body`. Results do not fake HTTP 200; presentation reports `WebSocket received` rather than an HTTP status line.

## Dependency

The `ws` package is required: `engines.node` is `>=18`, and Node 18 has no stable built-in WebSocket client. Implementing RFC 6455 in-tree would not meet the close/cleanup requirement. `ws` is small, has no required native addons, and is bundled by the existing esbuild pipeline (VSIX / CLI / MCP).

## Out of scope

- Persistent connections
- Subscriptions / infinite streams
- Reconnect / pooling
- Binary frames
- gRPC
