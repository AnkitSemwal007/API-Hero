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

## Run Options (retry + destructive skip)

After the failure policy is resolved, API Hero prompts for **Run Options**
(QuickPick — no separate settings page):

1. **Retries** — Off, settings preset (e.g. `2 exponential 500ms`), or Custom…
2. **Destructive requests** — Skip DELETE for this run, or allow DELETE

Defaults come from settings (pre-selected in the QuickPick):

| Setting | Default | Meaning |
| --- | --- | --- |
| `apiHero.collectionRunner.retryEnabled` | `false` | Prefer retries on / off |
| `apiHero.collectionRunner.maxRetries` | `2` | Retries after the first attempt (total attempts = maxRetries + 1) |
| `apiHero.collectionRunner.retryDelayMs` | `500` | Base delay between attempts |
| `apiHero.collectionRunner.retryBackoff` | `exponential` | `fixed` or `exponential` (`delayMs × 2^(retryIndex−1)`, capped) |
| `apiHero.collectionRunner.skipDestructiveRequests` | `false` | Prefer skipping DELETE |

**What is retried:** network/transport failures and HTTP `408`, `429`, `502`,
`503`, `504` — including when the HTTP response completed successfully with
those status codes (orchestrator `outcome: success`). Assertion failures on a
retryable status are also retried.

**What is not retried:** `400` / `401` / `403` / `404` / `409` / `422`, assertion
failures on non-retryable statuses, cases where assertions were evaluated and
all passed (including `expect status == 503` succeeding), variable/precondition
failures, extraction failures, unread files, cancels, and dependency skips.

Cancel during a retry wait aborts the run (remaining requests cancelled).
Intermediate retry attempts do not commit request history or write extracted
variables — only the final attempt does. After retry exhaustion, a
success+503 response with no failing assertions still finishes as **Passed**
(orchestrator HTTP semantics are preserved).

**Destructive skip:** when enabled, `DELETE` requests are skipped with reason
“Destructive requests are disabled for this run.” `POST` / `PUT` / `PATCH` are
not treated as destructive.

The Run Report and Execution view show attempt progress (`Attempt 2/3`,
`Retrying… 1/2`) and, for retried requests, an Attempts list (status codes /
outcomes). Dependency skip reasons are unchanged.

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

The **Collection Run Report** opens after a collection (or folder / selection) run
(and via **Open Live Report** while a run is in progress).

**Summary and rows**

- Compact summary counts (total / passed / failed / skipped / cancelled)
- Compact per-request rows (status, method, name, timing) instead of a dense dump

**Filters and grouping**

- Outcome filter chips (All / Passed / Failed / Skipped — Skipped includes cancelled)
- Search by name, method, or URL
- Optional method filter
- Rows grouped by collection folder (collapsible groups with pass/fail marks)

**Drill-down**

- Expand a request’s **Details** for Response, Headers, Cookies, Assertions,
  Variables, Execution Details, Dependencies, and Timeline — same Collection Run
  Debugger data as before (last run in memory only)
- Failure / status guidance shows recorded facts plus labeled **Possible causes**
  for common HTTP statuses (401/403/404/422/429/5xx) and timeout/network
  transport errors (never speculation stated as fact; secrets stay masked)

**Variables**

- Header shows a **compact Variables status** (`Variables ✓` when healthy, or
  unresolved variable names when not)
- Expand **View Variables** for the full Variable Trace (produced/consumed edges)
  and unresolved diagnostics
- Per-request **Variables** in Details lists resolved (masked) values and roles
  (`+produced` / `-consumed` names only — never secret values)

Dependency edges and reorder badges still appear when applicable.

**Export**

Export writes a **snapshot** of the current Collection Run Report model:

- **JSON** — redacted machine-readable report
- **Standalone HTML** — self-contained file you can open in a browser

Secrets (API keys, passwords, Bearer tokens, refresh tokens, Authorization, Cookie, and other sensitive values) are redacted. **Run Again** remains available on the live report. Export is not a Scenario Run Report.

## Collection Run Debugger

After a collection (or folder / selection) run, open the **Collection Run Report**
and expand a request’s **Details** to inspect that attempt without re-running APIs:

- Response, Headers, Cookies
- Variables (resolved display values + produced/consumed roles)
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
- History records the final attempt for each planned request (with optional `collectionName`). Intermediate retry attempts do not create History rows.
- Order follows a frozen Collections snapshot (depth-first folder expansion), then adjusts for dependencies.

## Related

- [Collections](./collections.md)
- [Variables](./variables.md)
- [Assertions](./assertions.md)
- [History](./history.md)
