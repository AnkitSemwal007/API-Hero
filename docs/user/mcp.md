# API Hero MCP server

Use API Hero collections from AI agents (Cursor, Claude Code, Codex, Gemini CLI, and other MCP clients) **without the VS Code UI**.

The MCP server is a **standalone Node stdio process**. It reuses the same discovery, Collection Runner, and execution orchestrator as the extension — it does **not** invent a parallel HTTP client or collection format.

## Requirements

- Node.js 18+
- A workspace folder that contains `Collections/<Name>/` (standard API Hero layout)
- Built extension output: `npm run compile` (produces `dist/mcp/server.js`)

Set the workspace with either:

- Environment variable `APIHERO_WORKSPACE` → absolute path to the folder that contains `Collections/`, or
- Process current working directory (cwd) when the client spawns the server

## Install / build

From the API Hero repo root:

```bash
npm install
npm run compile
```

Optional npm script (compile + run server on stdio — usually the client spawns this for you):

```bash
npm run mcp
```

Bin entry after install/link:

```bash
npx api-hero-mcp
# or
node ./bin/api-hero-mcp.js
# or
node ./dist/mcp/server.js
```

## Tools

| Tool | Purpose |
| --- | --- |
| `apihero_list_collections` | List collections (name, id, counts, kind) |
| `apihero_get_collection` | Collection detail, folder tree, variable metadata (sensitive values masked), auth metadata |
| `apihero_list_requests` | Requests in a collection (optional `folder` filter) |
| `apihero_get_request` | Request details + auth metadata + variable refs |
| `apihero_run_request` | Run one request via `ExecutionOrchestrator` |
| `apihero_run_collection` | Run a collection via `CollectionRunnerService` (`failurePolicy` optional). Per-request rows are slim (status, diagnostics, assertion expected/actual); use `apihero_get_request_result` for full response bodies |
| `apihero_get_run` | Fetch a run summary / session by `runId` |
| `apihero_get_request_result` | One request result from a prior run (full secret-redacted response presentation) |

Agents should prefer **collection display names** (case-insensitive). Ids from list/get responses can be reused on later calls.

## Cursor

Add to `.cursor/mcp.json` (project) or Cursor MCP settings:

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": ["D:/path/to/api-hero/dist/mcp/server.js"],
      "env": {
        "APIHERO_WORKSPACE": "D:/path/to/your-api-workspace"
      }
    }
  }
}
```

Use absolute paths. After changing collections on disk, tools re-scan on each call.

## Claude Code / Claude Desktop

Claude Desktop style (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": ["/absolute/path/to/api-hero/dist/mcp/server.js"],
      "env": {
        "APIHERO_WORKSPACE": "/absolute/path/to/your-api-workspace"
      }
    }
  }
}
```

Claude Code: use `claude mcp add` (or the product’s MCP add flow) with the same command, args, and `APIHERO_WORKSPACE`.

## Codex / other MCP clients

Any client that can spawn a stdio MCP server:

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": ["/absolute/path/to/api-hero/dist/mcp/server.js"],
      "env": {
        "APIHERO_WORKSPACE": "/absolute/path/to/your-api-workspace"
      }
    }
  }
}
```

Gemini CLI and similar tools follow the same pattern: command `node`, args pointing at `dist/mcp/server.js`, env `APIHERO_WORKSPACE`.

## Example workspace (DummyJSON)

The repo ships a full sample under [`examples/collections/`](../../examples/collections/). For MCP:

1. Create (or open) a workspace folder with a `Collections/` directory.
2. Copy or symlink `examples/collections/DummyJSON Complete API Collection` into `Collections/`.
3. Point `APIHERO_WORKSPACE` at that workspace root.

Optional live smoke (not unit tests): `node ./scripts/mcp-e2e-smoke.mjs` — documents how to exercise list → run against DummyJSON; network calls are gated and not part of `npm test`.

## Security

- Tool responses **never** dump VS Code Secret Storage or cleartext API keys / passwords / bearer tokens when redaction applies.
- Response presentation already masks sensitive headers; MCP adds defense-in-depth redaction before JSON is returned.
- Headless MCP uses an **empty in-memory SecretStore**. Auth that requires Secret Storage fails at the authentication precondition stage (same orchestrator behavior as a missing secret in VS Code). Prefer collection variables / environment variables for agent-driven workspaces.
- Do not commit secrets into `api-hero.variables.json`; use `.apihero/local/` overlays locally when needed.

## Architecture (short)

```
AI agent → MCP tool → ApiHeroMcpService
  → CollectionDiscoveryService / CollectionRunnerService / ExecutionOrchestrator
  → DefaultRequestExecutor → NodeHttpTransport
  → RunSummary / RequestRunResult (secret-safe presentation)
```
