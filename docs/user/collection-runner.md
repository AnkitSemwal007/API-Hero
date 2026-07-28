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

Setting `apiRunner.collectionRunner.failurePolicy` (default `ask`):

| Value | Behavior |
| --- | --- |
| `ask` | Prompt before each run |
| `stop-on-first-error` | Stop; remaining marked skipped |
| `continue-on-error` | Continue after failures |
| `skip-invalid-requests` | Skip unread/invalid; continue on execution failures |

User cancel stops the run; in-flight request is aborted when possible; remaining planned requests are cancelled.

## Chaining requests with `@depends-on`

Requests in a collection run can pass variables to each other. A request that
uses `@extract` (or `@sensitive-extract`) to capture a value makes it
available — by default in the **Run** scope — to every request that runs
after it in the same collection run:

```api
@name Login
@extract accessToken from body.access_token
POST {{host}}/login
```

```api
@name Products
@depends-on Login
GET {{host}}/products
Authorization: Bearer {{accessToken}}
```

`@depends-on` stores **human-readable** refs: a bare `@name` when that name is
unique in the collection, or `Folder/Name` (folder relative path + `/` + name)
when the same display name appears in more than one folder. The Request Editor
Depends-on picker shows name + folder and persists the shortest unique ref.
Renaming a request in the Request Editor rewrites dependents' `@depends-on`
tokens across the collection.

Opaque `req_*` tokens and discovery ids (`request:…#…`) are never written to
`@depends-on`. Leftover `req_*` values from older drafts are migrated back to
names on save when uniquely resolvable.

You only need `@depends-on` when a request consumes a variable but the
producing request isn't already earlier in the collection — API Hero also
detects the `{{accessToken}}` reference itself and orders requests accordingly.

If reordering was needed, a notification reads
**"Reordered N requests for dependencies"** after the run. A circular
dependency (two requests that depend on each other, directly or through
others) blocks the run before any request executes and shows the cycle path
in an error notification.

If an upstream request fails, is skipped, or doesn't produce the expected
variable, the dependent request is skipped with a reason such as
`Missing run variable: accessToken (producer Login failed)` instead of
running with a stale or missing value.

The **Collection Run Report** shows the resulting execution order (with a
"Reordered" badge when it changed), which variables each request produced
(`+name`) and planned to consume (`-name`), skip reasons, and a text list of
dependency edges such as `Login → Products (accessToken)` — variable **names**
only, never values.

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
- [Assertions](./assertions.md)
- [History](./history.md)
