# GraphQL

API Hero runs GraphQL **queries and mutations over HTTP** using the same request pipeline as REST. Protocol is chosen on the request, not by a separate runner, CLI flag, or MCP tool.

Subscriptions, GraphQL schema import, and gRPC are **not** supported. Bounded WebSocket sessions are a separate protocol — see [WebSocket](./websocket.md).

## Author a GraphQL request

Add `@protocol graphql` and send the GraphQL-over-HTTP JSON envelope as the body:

```api
@protocol graphql
@name GetUser
@auth bearer-prod
POST {{baseUrl}}/graphql
Content-Type: application/json

{
  "query": "query GetUser($id: ID!) { user(id: $id) { name } }",
  "variables": { "id": "{{userId}}" },
  "operationName": "GetUser"
}

expect status == 200
expect body.data.user.name == "Ada"
```

Mutations use the same shape with a mutation document in `query`.

In the Request Editor, set **Protocol** to GraphQL in the toolbar. The Body tab becomes **Query** with Query, Variables, and optional Operation name fields — a projection of the same JSON envelope. Run still uses ExecutionOrchestrator (variables, auth, and HTTP transport are unchanged). HTTP 200 with `errors` shows a **GraphQL Errors** card in the Response Viewer (messages are already secret-masked). Subscriptions are not supported.

Omit `@protocol` (or set `@protocol http`) for ordinary REST requests. Existing `.api` files are unchanged.

Unknown `@protocol` values are a validation error. They are never treated as HTTP.

## Variables, auth, collections

GraphQL `variables` in the JSON body use the same `{{name}}` substitution and precedence as REST (`run > document > environment > collection > workspace > global`). Existing authentication profiles and headers apply to the HTTP request. GraphQL requests can run in collections, CLI (`apihero run request`), and MCP through the shared execution path.

## Success and errors

HTTP transport success (a response was received) is not the same as a successful GraphQL operation.

| Outcome | Meaning |
| --- | --- |
| HTTP transport failure | Network / timeout / DNS — same as REST |
| HTTP non-2xx | GraphQL request failed |
| HTTP 200 with `data` and no `errors` | Success |
| HTTP 200 with `errors` (including partial `data` + `errors`) | Not a successful GraphQL operation |

Use existing `expect` lines against the JSON envelope (`status`, `body.data…`). Extraction from `body.data…` still runs when GraphQL `errors` are present.

GraphQL `errors[].message` values use the same secret masking as other API Hero display surfaces (Bearer/Basic/JWT heuristics and known sensitive header/variable values). Ordinary GraphQL errors are not rewritten.

Collection retry uses the existing HTTP retry statuses (`408`, `429`, `502`, `503`, `504`). GraphQL HTTP 503 is retried like REST. HTTP 200 with GraphQL `errors` is not retried.

## Related

- [Creating requests](./creating-requests.md)
- [Variables](./variables.md)
- [Assertions](./assertions.md)
- [CLI](./cli.md)
