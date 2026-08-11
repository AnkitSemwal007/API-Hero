# Collection Runner

Run many requests sequentially without opening a response panel for each one. Each attempt still goes through the same execution pipeline and History capture.

## Start a run

From the Collections tree:

| Scope | Command |
| --- | --- |
| Entire collection | **API Hero: Run Collection** |
| Folder (nested DFS) | **API Hero: Run Folder** |
| Selected request nodes | **API Hero: Run Selected Requests** |
| Collection with tests | **API Hero: Run Collection Tests** |

Progress appears in the **Execution** Activity Bar view and the status bar (`API Hero Running`). When finished, a toast summarizes outcomes and the **Collection Run Report** panel opens.

## Execution view

The **Execution** view (Activity Bar → API Hero → Execution) is the management surface for collection runs:

| Area | Behavior |
| --- | --- |
| Running | Compact card with progress, current request, elapsed time, mode/policy |
| Actions | **Open Live Report**, **Cancel**, **Reveal Collection** |
| Recent Runs | Last 20 terminal sessions (newest first); click opens the finished report |

Only one collection run can be active at a time. Starting another shows a warning — cancel from the Execution view or the progress notification first. Status bar idle text is **API Hero Ready**; click it to focus Execution.

## Live Run Report

**Open Live Report** opens the Collection Run Report panel while the run is in progress. Rows fill in as requests finish. When the run completes, the panel switches to the full finished report (including debugger details).

## Failure policy

Setting `apiHero.collectionRunner.failurePolicy` (default `ask`):

| Value | Behavior |
| --- | --- |
| `ask` | Prompt before each run |
| `stop-on-first-error` | Stop; remaining marked skipped |
| `continue-on-error` | Continue after failures |
| `skip-invalid-requests` | Skip unread/invalid; continue on execution failures |

User cancel stops the run; in-flight request is aborted when possible; remaining planned requests are cancelled.

## Request Dependencies & Data Flow

Collection runs can pass values from one request to the next. A request that uses
`@extract` (or `@sensitive-extract`) writes a variable — by default into the
**Run** scope — and later requests in the same collection run can consume it with
`{{name}}`.

### Three-hop example

Login extracts a token; Get User uses that token and extracts a user id; Get Orders
uses the user id:

```api
@name Login
@extract token from body.access_token
POST {{host}}/login
Content-Type: application/json

{
  "username": "demo",
  "password": "{{password}}"
}
```

```api
@name Get User
@extract userId from body.id
GET {{host}}/me
Authorization: Bearer {{token}}
```

```api
@name Get Orders
GET {{host}}/users/{{userId}}/orders
```

Membership order in the Collections tree does not have to match this sequence —
API Hero reorders the run when produces/consumes (or `@depends-on`) require it.

### `@depends-on`

`@depends-on` declares an **explicit** edge to another request by human-readable
ref. It is optional when an implicit edge already exists: if request A
`@extract`s `token` and request B uses `{{token}}`, the Collection Runner orders
A before B without requiring `@depends-on`.

Use `@depends-on` when you need a hard ordering edge that variables alone do not
express, or when you want the dependency visible in the file:

```api
@name Get User
@depends-on Login
@extract userId from body.id
GET {{host}}/me
Authorization: Bearer {{token}}
```

Refs are **human-readable**: a bare `@name` when that name is unique in the
collection, or `Folder/Name` (folder relative path + `/` + name) when the same
display name appears in more than one folder. The Request Editor Depends-on
picker shows name + folder and persists the shortest unique ref. Renaming a
request in the Request Editor rewrites dependents' `@depends-on` tokens across
the collection.

Opaque `req_*` tokens and discovery ids (`request:…#…`) are never written to
`@depends-on`. Leftover `req_*` values from older drafts are migrated back to
names on save when uniquely resolvable.

### Extracted variables

`@extract` / `@sensitive-extract` default to **Run** scope during a collection
run: values live in the shared per-run store and are available to later requests
in that run only. Use `scope=collection` (or other scopes) when you need the
value to persist beyond the run — see [Variables](./variables.md).

### Execution order

- **Collection / folder / multi-select runs** analyze produces/consumes and
  `@depends-on`, then reorder the frozen membership plan into dependency order
  before execution. If reordering was needed, a notification reads
  **"Reordered N requests for dependencies"** after the run.
- **Single-request Run** (Run Request from the editor) executes only that
  request. It does **not** automatically run upstream producers or walk
  `@depends-on` edges. Ensure required variables already exist in a persisted
  scope (for example environment, collection, or `@extract … scope=collection`
  from an earlier run) or as document `@variable`s before running one request
  alone. Default Run-scope extracts from a finished collection run do not
  survive for a later editor Run Request.

### Failure and cycles

If an upstream request fails, is skipped, or does not produce the expected
variable, dependents are skipped with a reason such as
`Missing run variable: token (producer Login failed)` instead of running with a
stale or missing value.

A circular dependency (two requests that depend on each other, directly or
through others) **blocks the run before any request executes** and shows the
cycle path in an error notification, for example
`Dependency cycle detected: Login → Get User → Login`.

### Collection Run Report

The **Collection Run Report** shows the resulting execution order (with a
"Reordered" badge when it changed), which variables each request produced
(`+name`) and planned to consume (`-name`), skip reasons, and a text list of
dependency edges such as `Login → Get User (token)` — variable **names** only,
never values. Unresolved consumes and a variable trace appear when applicable.

### How scenarios relate

[Scenarios](./scenarios.md) orchestrate workflows with their own step graph:
connections and `requestRef` control order and which Collection request each
step runs. Scenario scheduling does **not** auto-import or apply collection
`@depends-on` / implicit produces→consumes edges. Use Collection Runner for
bulk collection dependency order; use Scenarios when you need branches and
scenario-level control flow.

## Collection Run Debugger

After a collection (or folder / selection) run, open the **Collection Run Report**
and expand a request’s **Details** to inspect that attempt without re-running APIs:

- Response, Headers, Cookies
- Extracted Variables
- Assertions
- Execution Details (including secret-safe resolved `{{variables}}`)
- Dependencies and Timeline (Start / End / Duration)

Debugger data is **in-memory for the last run only** (V1) — it is not persisted
into History or `.api` files. Presentation uses the same response pipeline as the
single-request Response Viewer.

## Collection variables

Extracting with `scope=collection` persists the value in that collection's own
`api-hero.variables.json` file (sensitive values are redacted there and kept
in the local, gitignored variables overlay instead). There is no separate
Variable Manager UI for collection variables in this release — edit the file
directly, or use `@extract … scope=collection` to write it from a response.

## Notes

- Per-request Response viewer is suppressed during collection runs.
- History still records each network-attempted request (with optional `collectionName`).
- Order follows a frozen Collections snapshot (depth-first folder expansion), then adjusts for dependencies.

## Related

- [Collections](./collections.md)
- [Variables](./variables.md)
- [Scenarios](./scenarios.md)
- [Assertions](./assertions.md)
- [History](./history.md)
