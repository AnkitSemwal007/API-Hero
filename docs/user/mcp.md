# API Hero MCP server

Use API Hero collections from AI agents (Cursor, Claude Code, Codex, Gemini CLI, and other MCP clients) **without the VS Code UI**.

The MCP server is a **standalone Node stdio process**. It is **client-independent** — not hosted inside VS Code. It reuses the same discovery, Collection Runner, and execution orchestrator as the extension — it does **not** invent a parallel HTTP client or collection format.

## Client-owned configuration

Each AI client owns how MCP servers are registered (its own settings file, TOML, or CLI). **API Hero does not silently modify client configs** when you install the VS Code extension or build from source. You (or the client’s own UI) must add the server entry.

## Requirements

- Node.js 18+
- A workspace folder that contains `Collections/<Name>/` (standard API Hero layout)
- Built extension output: `npm run compile` (produces `dist/mcp/server.js`)

## Workspace configuration priority

Resolve the workspace root in this order (first wins):

1. CLI: `--workspace "<path>"` or `--workspace=<path>`
2. Environment: `APIHERO_WORKSPACE`
3. Process current working directory (`cwd`) when the client spawns the server

Prefer `--workspace` in client args. `APIHERO_WORKSPACE` remains supported for backward compatibility.

If `--workspace` is present without a value, the process exits immediately with a non-zero status and a clear stderr message. An empty or non-collection path still starts the server; tools return `EMPTY_WORKSPACE` when no `Collections/<Name>/` trees are found (same discovery semantics as before).

## Project Store (environments / auth)

Headless MCP composition loads **`.apihero` Project Store** environments, workspace variables, and authentication **profiles** when present (shared headless runtime with in-repo CLI tooling; the CLI is **not** publicly distributed). VS Code settings-backed globals and VS Code Secret Storage are still unavailable in headless hosts — supply secrets via process env (exact Secret Storage key or `APIHERO_SECRET_*`).

## Install / build

From the API Hero repo root:

```bash
npm install
npm run compile
```

`npm run compile` is required before clients can spawn `dist/mcp/server.js`.

## Starting the server

Optional npm script (compile + run server on stdio — usually the client spawns this for you):

```bash
npm run mcp
```

Bin entry after install/link:

```bash
npx api-hero-mcp --workspace "/absolute/path/to/your-api-workspace"
# or
node ./bin/api-hero-mcp.js --workspace "/absolute/path/to/your-api-workspace"
# or
node ./dist/mcp/server.js --workspace "/absolute/path/to/your-api-workspace"
```

Without `--workspace`, set `APIHERO_WORKSPACE` or run with cwd at the workspace root.

## Tools

| Tool | Purpose |
| --- | --- |
| `apihero_list_collections` | List collections (name, id, counts, kind) |
| `apihero_get_collection` | Collection detail, folder tree, variable metadata (sensitive values masked), auth metadata |
| `apihero_list_requests` | Requests in a collection (optional `folder` filter) |
| `apihero_get_request` | Request details + auth metadata + variable refs |
| `apihero_run_request` | Run one request via `ExecutionOrchestrator` |
| `apihero_run_collection` | Run a collection via `CollectionRunnerService` (`failurePolicy`, optional `retry`, optional `skipDestructiveRequests`). Per-request rows are slim (status, diagnostics, assertion expected/actual); use `apihero_get_request_result` for full response bodies |
| `apihero_run_scenario` | Run a Scenario via `ScenarioEngine` (same engine as UI Run Scenario). Identify by name, id, or `.scenario.json` path; optional `inputs` override variable defaults for this run |
| `apihero_get_run` | Fetch a run summary / session by `runId` |
| `apihero_get_request_result` | One request result from a prior run (full secret-redacted response presentation) |

Agents should prefer **collection display names** (case-insensitive). Ids from list/get responses can be reused on later calls.

## Run a Scenario

`apihero_run_scenario` executes an existing Scenario document under `.apihero/scenarios/` through the same `ScenarioEngine` path as the VS Code **Run Scenario** command (no VS Code UI).

Example args:

```json
{
  "scenario": "checkout",
  "inputs": {
    "apiToken": "override-for-this-run"
  }
}
```

`scenario` may be the scenario **name**, **id**, or a path (absolute, workspace-relative, or under `.apihero/scenarios/`). `inputs` optionally overrides matching scenario variable `defaultValue`s for this run only; unknown keys are ignored.

Result shape (success tool envelope `ok: true`):

- `scenarioId`, `scenarioName`, `runId`, `status` (`completed` | `failed` | `cancelled` | …)
- `startTime`, `endTime`, `durationMs`
- `statistics` — `{ total, completed, failed, skipped, cancelled, durationMs }`
- `steps` — per-step `{ stepId, stepName, status, attempt, durationMs, error?, outputs? }`
- `variables` — `{ name, value, sensitive, displayValue }` (sensitive values already masked)
- `timeline` — included when present on the report

**Domain failure vs tool error:** when the scenario finishes with `status: "failed"` (a step failed), the tool still returns `ok: true` with the report. Tool-level errors (`ok: false`) cover missing/ambiguous scenarios, unbound request steps, validation failures, concurrent runs, and engine throws — codes such as `SCENARIO_NOT_FOUND`, `SCENARIO_AMBIGUOUS`, `SCENARIO_UNBOUND`, `SCENARIO_LOAD_FAILED`, `REQUEST_REF_UNRESOLVED`, `SCENARIO_VALIDATION_FAILED`, `RUN_ALREADY_ACTIVE`, `RUN_FAILED`.

**Redaction:** sensitive scenario variables are masked in the execution report; MCP also applies `redactForMcp` before JSON is returned (Bearer tokens, Authorization-like strings, etc.).

**Scenarios vs collection `@depends-on`:** Scenarios use `requestRef` + connections for orchestration. Collection `@depends-on` scheduling is **not** imported into Scenario execution — use Scenarios for multi-step workflows with branching/variables, and collection runs for dependency-ordered collection membership.

Template steps may still use `pending:*` request ids; when `requestRef` uniquely matches a Collection request, MCP resolves the binding at run time (same catalog path as the UI).

## Generic MCP configuration

Most clients that use a JSON `mcpServers` map share this shape. Prefer `--workspace` in `args`; use `env.APIHERO_WORKSPACE` only as a fallback:

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": [
        "/absolute/path/to/api-hero/dist/mcp/server.js",
        "--workspace",
        "/absolute/path/to/your-api-workspace"
      ]
    }
  }
}
```

Equivalent env-based fallback:

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

Use absolute paths. After changing collections on disk, tools re-scan on each call.

Gemini CLI and similar stdio MCP clients use the same pattern (command `node`, args including `dist/mcp/server.js` and `--workspace`).

## Codex (VS Code extension)

Codex owns MCP registration via its own config. **Installing the API Hero VS Code extension does not automatically register MCP with Codex.**

### Config location

Official Codex config:

- `~/.codex/config.toml`
- Windows: `%USERPROFILE%\.codex\config.toml`

Optional project config: `.codex/config.toml` in the project root — only when the project is trusted by Codex.

### TOML example (installed extension)

Use absolute paths. The extension version folder changes when you update API Hero:

```toml
[mcp_servers.api-hero]
command = "node"
args = [
  "C:/Users/<you>/.vscode/extensions/ankitsemwal.api-hero-2.9.1/dist/mcp/server.js",
  "--workspace",
  "D:/path/to/your-api-workspace"
]
```

Replace `<you>` and the version folder with your actual install path. On macOS/Linux:

`~/.vscode/extensions/ankitsemwal.api-hero-<version>/dist/mcp/server.js`

### Repo-dev alternative

When developing from the API Hero clone (after `npm run compile`):

```toml
[mcp_servers.api-hero]
command = "node"
args = [
  "/absolute/path/to/api-hero/dist/mcp/server.js",
  "--workspace",
  "/absolute/path/to/your-api-workspace"
]
```

Prefer `--workspace` in `args` over `APIHERO_WORKSPACE`.

### Edit from Codex IDE

Per OpenAI Codex docs:

1. Open the Codex gear → **Codex Settings** → **Open config.toml**
2. Or use the MCP settings panel (**MCP servers**) in Codex Settings to review registered servers

After editing, **restart or reload Codex** so tools load.

### Codex-bundled executable (optional)

The Codex VS Code extension bundles a `codex.exe` (or platform equivalent). If you use that bundled executable by full path, it can run `mcp add` / `mcp list`. Durable configuration is still the TOML above — do **not** install a separate Codex CLI package solely for API Hero MCP.

## Cursor

Add to `.cursor/mcp.json` (project) or Cursor MCP settings. Prefer `--workspace` in args:

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": [
        "/absolute/path/to/api-hero/dist/mcp/server.js",
        "--workspace",
        "/absolute/path/to/your-api-workspace"
      ]
    }
  }
}
```

Env fallback (`APIHERO_WORKSPACE`) remains valid if you omit `--workspace`.

## Claude / Claude Code / Claude Desktop

Claude Desktop style (`claude_desktop_config.json`) — prefer `--workspace` in args:

```json
{
  "mcpServers": {
    "api-hero": {
      "command": "node",
      "args": [
        "/absolute/path/to/api-hero/dist/mcp/server.js",
        "--workspace",
        "/absolute/path/to/your-api-workspace"
      ]
    }
  }
}
```

Claude Code: use `claude mcp add` (or the product’s MCP add flow) with the same command and args (include `--workspace`). `APIHERO_WORKSPACE` remains an optional fallback.

## Example workspace (DummyJSON)

The repo ships a full sample under [`examples/collections/`](../../examples/collections/). For MCP:

1. Create (or open) a workspace folder with a `Collections/` directory.
2. Copy or symlink `examples/collections/DummyJSON Complete API Collection` into `Collections/`.
3. Point the server at that workspace root with `--workspace` (preferred), or `APIHERO_WORKSPACE`.

Example:

```bash
node ./dist/mcp/server.js --workspace "/absolute/path/to/your-dummyjson-workspace"
```

Optional live smoke (not unit tests): `node ./scripts/mcp-e2e-smoke.mjs` — documents how to exercise list → run against DummyJSON; network calls are gated and not part of `npm test`.

## Troubleshooting

### Codex does not show `apihero_*` tools

1. **Extension installed ≠ MCP registered** — installing API Hero does not add an entry to Codex config. You must configure Codex yourself (see [Codex (VS Code extension)](#codex-vs-code-extension)).
2. Open **Codex Settings → MCP servers** and confirm `api-hero` is listed.
3. Check `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`) for a `[mcp_servers.api-hero]` section.
4. Verify `command` and `args` paths exist:
   - `node` is on PATH (or use an absolute path to Node)
   - `.../dist/mcp/server.js` exists (installed extension version folder or repo `dist/` after compile)
   - `--workspace` points at a real folder
5. Restart or reload Codex after editing config.
6. Confirm these tools appear when MCP is healthy:
   - `apihero_list_collections`
   - `apihero_get_collection`
   - `apihero_list_requests`
   - `apihero_get_request`
   - `apihero_run_request`
   - `apihero_run_collection`
   - `apihero_run_scenario`
   - `apihero_get_run`
   - `apihero_get_request_result`

### Tools return `EMPTY_WORKSPACE`

Usually wrong `--workspace` (or missing `APIHERO_WORKSPACE` / cwd) — the path must be the workspace **root** that contains `Collections/<Name>/`, not a single collection folder. Fix the path and retry.

## Future (not implemented)

**Planned convenience:** a Command Palette action **"API Hero: Configure MCP for Codex"** that would help write or open the official Codex config **with user consent**.

This command is **not available yet** — do not look for it in the Command Palette today.

## Security

- Tool responses **never** dump VS Code Secret Storage or cleartext API keys / passwords / bearer tokens when redaction applies.
- Response presentation already masks sensitive headers; MCP adds defense-in-depth redaction before JSON is returned.
- Headless MCP loads **`.apihero` Project Store** environments, workspace variables, and auth profiles when present. VS Code settings globals and VS Code Secret Storage are not available — use process-env secrets (`APIHERO_SECRET_*` or exact Secret Storage keys). The in-repo CLI shares this headless composition but is **not** publicly distributed.
- Prefer collection variables / environment variables for agent-driven workspaces when secrets are not injected.
- Do not commit secrets into `api-hero.variables.json`; use `.apihero/local/` overlays locally when needed.

## Architecture (short)

```
AI agent → MCP tool → ApiHeroMcpService
  → CollectionDiscoveryService / CollectionRunnerService / ScenarioEngine / ExecutionOrchestrator
  → DefaultRequestExecutor → NodeHttpTransport
  → RunSummary / RequestRunResult / ExecutionReport (secret-safe presentation)
```
