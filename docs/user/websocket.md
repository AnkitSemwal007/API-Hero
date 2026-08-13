# WebSocket

API Hero runs **bounded WebSocket request/response sessions** through the same execution pipeline as REST and GraphQL. Protocol is chosen on the request. There is no WebSocket runner, CLI flag, or MCP tool.

Persistent connections, subscriptions, reconnect, infinite streams, and binary frames are **not** supported.

## Author a WebSocket request

Add `@protocol websocket` and use a `ws://` or `wss://` URL. The outgoing message is the request body. Prefer JSON (or a multi-word text line). A single alphabetic token such as `ping` is parsed as an HTTP method, not a body.

```api
@protocol websocket
@name Echo
@timeout 5000
@auth bearer-prod
GET {{wsUrl}}/echo
Content-Type: application/json

{"type":"ping"}

expect body.type == "pong"
```

`@timeout` bounds the whole session (connect, send, receive, close). Existing `{{variable}}` substitution applies to the URL, headers, and message. Existing authentication profiles attach headers during the WebSocket handshake.

Omit `@protocol` (or set `@protocol http`) for REST. Use `@protocol graphql` for GraphQL-over-HTTP. Unknown `@protocol` values are a validation error and are never treated as HTTP or WebSocket.

## Success and errors

A WebSocket execution succeeds when the socket connects, the optional message is sent, one text frame is received, and assertions (if any) pass. The received text is the response body. If it is JSON, existing `expect body…` assertions and `@extract … from body…` rules apply.

Failures are connection, send, receive timeout, cancellation, or assertion/extraction failures — not HTTP status codes. The socket is closed on every path, including timeout, cancellation, and assertion failure (the message is buffered before assertions run).

## Related

- [Creating requests](./creating-requests.md)
- [GraphQL](./graphql.md)
- [Variables](./variables.md)
- [Assertions](./assertions.md)
