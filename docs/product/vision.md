# Vision

**API Hero** makes HTTP API work feel native to VS Code: requests are plain `.api` files, collections live in the workspace, and runs stay reviewable in History.

## Principles

1. **Text is canonical** — UI writes into the `.api` grammar; no parallel opaque schema.
2. **Small shell** — Activity Bar shows Collections, Execution, and History. Managers open as panels (Environments are not an Activity Bar view).
3. **Secure by default** — secrets in Secret Storage; History and UI mask credentials.
4. **Stable IDs** — Canonical contribution IDs use `apiHero.*`; legacy `apiRunner.*` aliases remain during the compatibility window (see [stable-identifiers.md](../release/stable-identifiers.md)).

## Audience

Developers and testers who already live in the editor and want a focused REST client without a separate Electron app.

## Non-goals (current product)

OAuth2 flows, cookie jars, GraphQL **subscriptions**, persistent WebSockets, gRPC, and marketplace “alternative to X” positioning are out of scope for the current line. GraphQL query/mutation over HTTP and bounded WebSocket sessions are supported — see [GraphQL](../user/graphql.md) and [WebSocket](../user/websocket.md). See [roadmap.md](./roadmap.md).
