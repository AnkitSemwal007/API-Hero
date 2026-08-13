# API Hero CLI (`apihero`)

Run API Hero requests, collections, and scenarios from the terminal or CI — **without VS Code**.

The CLI reuses the same headless composition as MCP: `ExecutionOrchestrator`, `CollectionRunnerService`, and `ScenarioEngine`. It does **not** start an MCP server and does **not** import `vscode`.

## Requirements

- Node.js 18+
- A workspace folder with `Collections/<Name>/` (standard API Hero layout)

## Installation

The CLI is published to npm as **`@ankitsemwal007/api-hero`** (binary: `apihero`).  
The VS Code Marketplace extension id remains **`ankitsemwal.api-hero`** — npm cannot use unscoped `api-hero` (too similar to an existing `apihero` package), and vsce requires an unscoped `package.json` `name`.

```bash
npm install -g @ankitsemwal007/api-hero
apihero --version
apihero --help
```

Without a global install:

```bash
npx --package=@ankitsemwal007/api-hero apihero --help
```

From a local checkout (contributors / before registry publish):

```bash
npm install
npm run compile   # or: npm run bundle
node ./bin/apihero.js --help
# publish to npm (scoped rewrite handled by script):
npm run publish:npm
```

Installing the VS Code extension from the Marketplace does **not** put `apihero` on your PATH.

## Commands

```bash
apihero --help
apihero --version
apihero run --help
apihero run request <request>
apihero run collection <collection>
apihero run scenario <scenario>
```

### Options

| Flag | Meaning |
| --- | --- |
| `--workspace <path>` / `--workspace=<path>` | Workspace root |
| `--environment <name>` / `--environment=<name>` | Environment **id** or **name** from `.apihero` |
| `--json` | Redacted JSON envelope on stdout |
| `--quiet` | Failures / final result only |
| `--verbose` | Runtime logs on stderr |

Unknown options exit with code **2**.

### Targets

- **request** — label, id, or path fragment (e.g. `hello.api`, `Hello`). Resolved the same way as MCP `runRequest` (workspace-wide when no collection is implied).
- **collection** — collection display name or id
- **scenario** — scenario name, id, or `.scenario.json` path under `.apihero/scenarios/`

## Workspace selection

Priority (same as MCP):

1. `--workspace <path>`
2. `APIHERO_WORKSPACE`
3. Current working directory (`cwd`)

There is **no** parent-directory walk. Run from the workspace root, or pass `--workspace` / set `APIHERO_WORKSPACE`.

If `cwd` is a nested folder under `Collections/<Name>/`, a request might still resolve via the Legacy `.api` layout, but collection lookup by name will fail until you point at the real workspace root. Prefer an explicit `--workspace`.

Invalid / empty workspaces return configuration errors (exit **3**), e.g. `EMPTY_WORKSPACE` / `REQUEST_NOT_FOUND` / `COLLECTION_NOT_FOUND`.

## Environments

When `.apihero` exists, the CLI loads environments, workspace variables, and auth **profiles** from the Project Store (same as headless MCP). Global VS Code settings variables are empty in headless.

```bash
apihero run collection Demo --workspace . --environment staging
```

Unknown environments fail with a clear message and exit code **3**.

## Secrets (CI)

Headless hosts do **not** use VS Code Secret Storage. Provide secrets via process environment:

1. **Exact Secret Storage key** (preferred when keys are known), e.g.  
   `apiHero.auth.profile.demo.token=...`
2. **Prefixed alias** — replace `.` with `_` and prefix `APIHERO_SECRET_`:  
   `APIHERO_SECRET_apiHero_auth_profile_demo_token=...`

Auth profiles still use `{ kind: "secret" }` metadata; only the SecretStore backend differs.

The CLI does **not** map arbitrary `process.env` names to `{{variable}}` substitution, and does **not** support `--var` yet.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Successful execution |
| 1 | Execution failure (HTTP / assertions / failed scenario or collection counts / CI-unsafe scenario skips) |
| 2 | Invalid arguments / usage |
| 3 | Project / configuration / validation (unknown env, not found, unbound, empty plan, …) |
| 4 | Auth / secret resolution (when detectable) |

### Scenario CI semantics

The ScenarioEngine / MCP report may still show an overall non-`failed` status when steps are skipped for preconditions. For **CLI / CI**, a run is **not** exit **0** when:

- any step failed, or
- the run `status` is `failed` or `cancelled`, or
- `statistics.cancelled > 0`, or
- any step is **skipped with an error** (e.g. “Request precondition failed.”), or
- `total > 0` and `completed === 0`

Dependent skips after a real failure already yield exit **1** via `failed > 0`. This CLI policy does **not** change ScenarioEngine or MCP tool behavior.

## Output

Human (default) prints a short step/request summary with ✓ / ✗ / ○ and a final `Result:` line.  
`--json` prints a redacted envelope on **stdout** (no human progress mixed in). Verbose logs go to **stderr**.

```json
{
  "ok": false,
  "target": { "type": "scenario", "name": "checkout" },
  "status": "failed",
  "statistics": {},
  "steps": [],
  "data": {}
}
```

Secrets and Authorization values are always redacted (same helpers as MCP).

## CI examples

### Generic shell

```bash
npm install -g @ankitsemwal007/api-hero
export APIHERO_SECRET_apiHero_auth_profile_demo_token="$DEMO_TOKEN"
apihero run scenario checkout \
  --workspace "$PWD" \
  --environment staging \
  --json
```

### GitHub Actions

```yaml
- name: Install API Hero CLI
  run: npm install -g @ankitsemwal007/api-hero

- name: Run scenario
  env:
    APIHERO_SECRET_apiHero_auth_profile_demo_token: ${{ secrets.DEMO_TOKEN }}
  run: apihero run scenario checkout --workspace . --environment staging --json
```

## Limitations

- No VS Code Secret Storage (use env vars above)
- No interactive prompts or UI failure-policy ask
- Headless **global** variables are empty (workspace / environment / collection / scenario scopes still apply)
- No `--var` / OS-env → `{{variable}}` mapping
- No scenario `--inputs` flag yet (MCP `apihero_run_scenario` supports `inputs`; CLI may gain parity later)
- No remote runner, watch mode, parallel runs, Docker image, or GraphQL

## Related

- [MCP server](./mcp.md) — same headless composition for AI agents
- [Getting started](./getting-started.md)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
