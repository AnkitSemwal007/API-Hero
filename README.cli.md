# API Hero CLI

Headless runner for API Hero requests and collections — without VS Code.

The `apihero` binary reuses the same execution pipeline as the VS Code extension and MCP server. It does **not** start an MCP server and does **not** require VS Code.

- **Package:** [`@ankitsemwal007/api-hero`](https://www.npmjs.com/package/@ankitsemwal007/api-hero)
- **Binary:** `apihero`
- **Node.js:** 18+

The VS Code extension id is **`ankitsemwal.api-hero`**. Installing the extension from the Marketplace does **not** put `apihero` on your PATH.

## Installation

```bash
npm install -g @ankitsemwal007/api-hero
apihero --version
apihero --help
```

Without a global install:

```bash
npx --package=@ankitsemwal007/api-hero apihero --help
```

## Commands

```bash
apihero --help
apihero --version
apihero run --help
apihero run request <request>
apihero run collection <collection>
```

### Options

| Flag | Meaning |
| --- | --- |
| `--workspace <path>` | Workspace root |
| `--environment <name>` | Environment **id** or **name** from `.apihero` |
| `--json` | Redacted JSON envelope on stdout |
| `--quiet` | Failures / final result only |
| `--verbose` | Runtime logs on stderr |

Unknown options exit with code **2**.

### Request

```bash
apihero run request Login --workspace . --environment local
```

`<request>` may be a label, id, or path fragment (for example `hello.api` or `Hello`). Resolution matches MCP `runRequest` (workspace-wide when no collection is implied).

HTTP, `@protocol graphql`, and `@protocol websocket` requests use this same command. There is no `--graphql`, `--websocket`, `--ws`, `--listen`, or `--stream` flag. Authentication and `{{variables}}` use the same runtime — there is no separate GraphQL, WebSocket, Authentication, or Variables CLI.

GraphQL is queries and mutations over HTTP. WebSocket is a bounded connect → optional text send → first text frame receive → close session. Persistent connections, subscriptions, reconnect, streaming, binary frames, and gRPC are not included.

### Collection

```bash
apihero run collection Demo --workspace . --json
```

`<collection>` is a collection display name or id.

## Environment

When `.apihero` exists, the CLI loads environments, workspace variables, and auth **profiles** from the Project Store. Global VS Code settings variables are empty in headless runs.

```bash
apihero run collection Demo --workspace . --environment staging
```

Unknown environments fail with a clear message and exit code **3**.

OS `process.env` names are **not** mapped to `{{variable}}`. There is no `--var` flag.

## Output modes

| Mode | Behavior |
| --- | --- |
| Default | Human summary with ✓ / ✗ / ○ and a final `Result:` line |
| `--json` | Redacted envelope on **stdout** (no human progress mixed in) |
| `--quiet` | `Result: PASSED` on success; failures still print detail |
| `--verbose` | Runtime logs on **stderr** |

Example `--json` envelope:

```json
{
  "ok": false,
  "target": { "type": "collection", "name": "Demo" },
  "status": "failed",
  "statistics": {},
  "steps": [],
  "data": {}
}
```

Structured output redacts credential-like values (tokens, passwords, sensitive headers/keys) so logs are less likely to leak secrets. Treat this as defense-in-depth, not a guarantee that every secret is hidden.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Successful execution |
| 1 | Request, assertion, or collection failure |
| 2 | Invalid arguments / usage |
| 3 | Workspace / request / collection / environment resolution failure |
| 4 | Auth / secret resolution (when detectable) |

## CI usage

Use `--json` for machine-readable results. Point `--workspace` at the project root that contains `Collections/<Name>/`.

```bash
npm install -g @ankitsemwal007/api-hero
apihero run collection Demo --workspace . --json
```

GitHub Actions:

```yaml
- name: Install API Hero CLI
  run: npm install -g @ankitsemwal007/api-hero

- name: Run collection
  run: apihero run collection Demo --workspace . --json
```

Headless hosts do **not** use VS Code Secret Storage. Provide auth-profile secrets via process environment:

1. Exact Secret Storage key when known
2. Prefixed alias: replace `.` with `_` and prefix `APIHERO_SECRET_`

Do not put real API keys, tokens, or secrets in command examples or committed collection files.

## Workspace requirements

- A folder with `Collections/<Name>/` (standard API Hero layout)
- Optional `.apihero/` Project Store for environments and auth profile metadata

Workspace priority (first wins):

1. `--workspace <path>`
2. `APIHERO_WORKSPACE`
3. Current working directory (`cwd`)

There is **no** parent-directory walk. Run from the workspace root, or pass `--workspace`.

Invalid / empty workspaces return configuration errors (exit **3**), for example `EMPTY_WORKSPACE`, `REQUEST_NOT_FOUND`, or `COLLECTION_NOT_FOUND`.

## Not included

- `--var` / OS env → `{{variable}}` mapping
- Parent workspace discovery
- Docker image, watch mode, or parallel execution
- Interactive prompts or UI failure-policy ask
- Persistent WebSocket, subscriptions, reconnect, streaming, binary frames, or gRPC

## Documentation

- [CLI guide](https://github.com/AnkitSemwal007/API-Hero/blob/main/docs/user/cli.md)
- [VS Code extension](https://marketplace.visualstudio.com/items?itemName=ankitsemwal.api-hero)
- [Website](https://apihero.in/)
- [GitHub](https://github.com/AnkitSemwal007/API-Hero)
- [Changelog](https://github.com/AnkitSemwal007/API-Hero/blob/main/CHANGELOG.md)

## License

[MIT](LICENSE)
