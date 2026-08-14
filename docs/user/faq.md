# FAQ

## What is the extension ID?

`ankitsemwal.api-hero`. Command IDs still use the `apiHero.*` prefix.

## Why Collections, Execution, and History in the Activity Bar?

**Collections** organize requests, **Execution** monitors live collection runs, and **History** keeps per-request results. Those three are the Activity Bar views. Managers (Environments, Auth), Overview, Response, History Detail, Run Report, and wizards open as editors or panels — Environments are intentionally not an Activity Bar view.

## Is GraphQL supported?

Yes — **queries and mutations over HTTP**. Add `@protocol graphql` (or choose GraphQL in the Request Editor protocol selector). The Body tab becomes Query / Variables / Operation name. See [GraphQL](./graphql.md).

Subscriptions, GraphQL schema / Postman GraphQL import are not supported. Bounded WebSocket sessions are a separate protocol — see [WebSocket](./websocket.md).

## Is WebSocket supported?

Yes — **bounded connect / send / receive / close sessions** (`ws://` and `wss://`). Add `@protocol websocket` (or choose WebSocket in the Request Editor). **Run Session** is not a persistent connection. Persistent connections, subscriptions, reconnect, and binary frames are not supported. See [WebSocket](./websocket.md).

## Is OAuth2 supported?

Not yet. Use `basic`, `bearer`, or `apiKey` profiles. OAuth is on the longer-term [roadmap](../product/roadmap.md).

## Does History store response bodies?

No by default. Entries are sanitized metadata for browse, filter, and re-run.

## Can I run an entire `.api` file at once?

**Run File** is a stub. Use Collection runner for multi-request runs, or run one request at a time from the editor.

## Where are settings documented?

See [Configuration](../reference/configuration.md) and [Commands](../reference/commands.md).

## Related

- [Troubleshooting](./troubleshooting.md)
- [Getting started](./getting-started.md)
