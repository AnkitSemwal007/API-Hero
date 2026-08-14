# Creating requests

Requests live in `.api` files. The **Request Editor** is the default custom editor for `*.api`. You can also open the plain text editor when you need the raw grammar.

## Create a request

1. **API Hero: New Request** (Collections toolbar or Command Palette).
2. Choose collection/folder and name when prompted.
3. Edit protocol (HTTP / GraphQL / WebSocket), URL, headers, query, body, variables, and auth in the Request Editor, or edit the text file directly. WebSocket has no HTTP method selector (method stays `GET` internally for `.api` compatibility) and the WebSocket URL defaults to `ws://localhost:8080/socket`.

## `.api` basics

Separate multiple requests with `###`:

```api
@name List users
GET {{baseUrl}}/users
Accept: application/json

###
@name Create user
POST {{baseUrl}}/users
Content-Type: application/json

{
  "name": "Ada"
}
```

Common directives:

| Directive | Purpose |
| --- | --- |
| `@name` | Display name in Collections / Outline |
| `@variable name=value` | Document-scoped variable |
| `@sensitive-variable name=value` | Document variable marked sensitive |
| `@extract name from …` | Capture a response value into a variable (default Run scope) |
| `@sensitive-extract name from …` | Same as `@extract`, marked sensitive |
| `@depends-on Name` | Explicit dependency on another request (Collection Runner) |
| `@auth profileId` | Authentication profile for the request |
| `@protocol graphql` | GraphQL-over-HTTP query or mutation (see [GraphQL](./graphql.md)) |
| `@protocol websocket` | Bounded WebSocket connect/send/receive/close session (see [WebSocket](./websocket.md)) |
| `@source` | Optional related source file (`src/app.ts` or `src/app.ts:12`) for Open Related Source (see [Source-code integration](./source-integration.md)) |

For how `@extract` and `@depends-on` chain requests during a collection run, see
[Request Dependencies & Data Flow](./collection-runner.md#request-dependencies--data-flow).

Snippets (`get`, `post`, `graphql`, `websocket`, `separator`, and others) are available in the `api` language.

The Request Editor toolbar **Protocol** selector writes `@protocol` (`http` omits the directive; GraphQL and WebSocket persist). GraphQL uses Query / Variables / Operation name. For WebSocket there is no HTTP method selector; the URL defaults to `ws://localhost:8080/socket`. WebSocket **Run Session** is a bounded connect → optional send → first text frame → close session — not a persistent connection.

## Run a request

| Action | How |
| --- | --- |
| Run Request | Editor title, context menu, CodeLens, or `Ctrl+Alt+R` / `Cmd+Alt+R` |
| Run with assertions | **API Hero: Run Request with Assertions** |
| Copy as cURL | Context menu or **API Hero: Copy as cURL** — copies a resolved, secret-redacted cURL command (does not execute the request) |
| Import cURL | Command Palette / Collections menu / selection context — paste, selection, or file → preview → create `.api` (never shell-executes) |
| Open Request Editor | **API Hero: Open Request Editor** (when using the text editor) |

**Copy as cURL** resolves variables and authentication the same way Run Request does, then writes a POSIX-shell-safe `curl` command to the clipboard. Secrets are redacted by default (presentation URL, sensitive headers, sensitive variable values in the body, Basic `-u` credentials). The request is **not** sent over the network.

**Import cURL** (`apiHero.importCurl`) is the reverse path: paste a curl command, use the editor selection, or open a text file. The command is tokenized and parsed **in-process** (no `child_process` / shell). After a masked preview you choose a destination `.api` file. Bearer/Basic and other sensitive **headers** become `{{token}}` / `{{cookie}}` (or similar) placeholders. **Body and query string values are kept literally** as in the pasted command (so the request shape stays faithful)—avoid committing production secrets in those fields. Unsupported curl flags (proxy, `-k`, output files, etc.) are reported as warnings and ignored. Unclosed quotes fail the import; common `--flag=value` and `-XPOST` forms are accepted.

**Run File** is a stub (Coming Soon) and is hidden from the Command Palette.

## Related

- [Variables](./variables.md)
- [GraphQL](./graphql.md)
- [WebSocket](./websocket.md)
- [Authentication](./authentication.md)
- [Assertions](./assertions.md)
- [Response viewer](./response-viewer.md)
- [Source-code integration](./source-integration.md)
