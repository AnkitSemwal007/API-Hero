# API Hero CLI (`apihero`)

Run API Hero requests, collections, and scenarios from the terminal or CI — **without VS Code**.

The CLI reuses the same headless composition as MCP: `ExecutionOrchestrator`, `CollectionRunnerService`, and `ScenarioEngine`. It does **not** start an MCP server and does **not** import `vscode`.

## Requirements

- Node.js 18+
- A workspace folder with `Collections/<Name>/` (standard API Hero layout)
- Built package output: `npm run compile` (produces `dist/cli/main.js`)

## Install / build

From the API Hero repo root:

```bash
npm install
npm run compile
```

Bin entry after install/link (same package as MCP):

```bash
npx apihero --help
# or
node ./bin/apihero.js --help
# or (after npm link / global install)
apihero run request Hello --workspace "/absolute/path/to/your-api-workspace"
```

Without `--workspace`, set `APIHERO_WORKSPACE` or run with cwd at the workspace root (same priority as MCP).

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

## Environments

When `.apihero` exists, the CLI loads environments, workspace variables, and auth **profiles** from the Project Store (same as the enhanced headless MCP composition). Global VS Code settings variables are empty in headless.

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

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Successful execution |
| 1 | Execution failure (HTTP / assertions / failed scenario or collection counts) |
| 2 | Invalid arguments / usage |
| 3 | Project / configuration / validation (unknown env, not found, unbound, empty plan, …) |
| 4 | Auth / secret resolution (when detectable) |

Note: `runScenario` may return an ok MCP payload when `report.status === 'failed'`. The CLI checks domain status and exits **1**.

## Output

Human (default) prints a short step/request summary with ✓ / ✗ and a final `Result:` line.  
`--json` prints a redacted envelope:

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
npm run compile
export APIHERO_SECRET_apiHero_auth_profile_demo_token="$DEMO_TOKEN"
node ./bin/apihero.js run scenario checkout \
  --workspace "$PWD" \
  --environment staging \
  --json
```

### GitHub Actions

```yaml
- name: Compile API Hero
  run: npm ci && npm run compile

- name: Run scenario
  env:
    APIHERO_SECRET_apiHero_auth_profile_demo_token: ${{ secrets.DEMO_TOKEN }}
  run: node ./bin/apihero.js run scenario checkout --workspace . --environment staging --json
```

## Limitations

- No VS Code Secret Storage (use env vars above)
- No interactive prompts or UI failure-policy ask
- Headless **global** variables are empty (workspace / environment / collection / scenario scopes still apply)
- No remote runner, watch mode, parallel runs, Docker image, or GraphQL

## Related

- [MCP server](./mcp.md) — same headless composition for AI agents
- [Getting started](./getting-started.md)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
