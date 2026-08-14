# WebSocket

API Hero runs **bounded WebSocket request/response sessions** through the same execution pipeline as REST and GraphQL. Protocol is chosen on the request. There is no WebSocket runner, CLI flag, or MCP tool.

Persistent connections, subscriptions, reconnect, infinite streams, and binary frames are **not** supported.

## Author a WebSocket request

Add `@protocol websocket` and use a `ws://` or `wss://` URL. The outgoing message is the request body, including plaintext and JSON. A body line that is a known HTTP method followed by a URL-like remainder can still start a new request.

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

## Request Editor

**New Request** and the Request Editor hide the HTTP method selector for WebSocket. Method stays `GET` internally on the `.api` request line for compatibility. The WebSocket URL defaults to `ws://localhost:8080/socket`.

The Request Editor toolbar for WebSocket is **Protocol | WS | URL**. **Run Session** is the same bounded session as CLI: connect → optional send of the Message body → receive one text frame → close. The socket is **not** kept open after the run.

The Message tab accepts **none / json / text** only. WebSocket messages do not get HTTP Content-Type defaults (`application/json`, `text/plain`, or the raw `application/xml` placeholder). Handshake headers you add yourself, including Content-Type, are kept.

Params, Headers, Auth, Variables, Tests, Extract, and Settings stay available (handshake headers and auth already apply). Persistent connections are not supported.

Collection Runner executes each WebSocket request as one bounded session (same as CLI). It does not keep a socket open across requests.

## Related

- [Creating requests](./creating-requests.md)
- [GraphQL](./graphql.md)
- [Variables](./variables.md)
- [Assertions](./assertions.md)
