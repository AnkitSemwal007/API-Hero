# Variables

Runtime substitution uses `{{name}}`. Names match `[A-Za-z_][A-Za-z0-9_.-]*`.

## Where values come from

Every `{{name}}` resolves from the highest scope that defines it. UI labels match IntelliSense:

| UI label | Technical scope | Where you define it |
| --- | --- | --- |
| **Run** | run | Extracted during a request run (`@extract` default scope) or a Collection Runner run's shared store; session-only |
| **Request** | document | `@variable` / `@sensitive-variable` in the `.api` file (Request Editor Variables tab) |
| **Environment** | environment | Environment Manager → named environment (only the **active** environment applies) |
| **Collection** | collection | `Collections/<Name>/api-hero.variables.json` (sensitive values in the local overlay); scoped to the request's owning collection |
| **Workspace** | workspace | Environment Manager → Workspace, or setting `apiRunner.variables.workspace` |
| **Global** | global | Environment Manager → Global, or setting `apiRunner.variables.global` |

**Precedence (highest wins):** Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global.

When the same name exists in more than one scope, hover and completion show the **effective** (winning) source. Sensitive values stay masked.

## Define variables

| Scope | Where |
| --- | --- |
| Run | Extraction with `scope=run` (default), or the Collection Runner's per-run store during a collection run |
| Request (document) | `@variable host=https://api.example.test` or `@sensitive-variable token=…` |
| Environment | Environment Manager → environment variables |
| Collection | `Collections/<Name>/api-hero.variables.json`; sensitive values move to a local overlay, keyed by collection |
| Workspace | Setting `apiRunner.variables.workspace` |
| Global | Setting `apiRunner.variables.global` |

Optional `sensitive: true` masks values in language UI and previews.

## Extract from responses

Use `@extract` / `@sensitive-extract` (or the Request Editor **Extract** tab) to
copy values from the last response into variables:

```api
@extract token from body.access_token scope=environment
@extract id from body.id
GET https://example.test/login
```

Default scope is **Run** (session-only, highest precedence). Environment writes
persist to the active environment. Collection writes (`scope=collection`)
persist to the running request's collection variables file — sensitive values
go to the local overlay instead of the tracked file. Request (`document`)
writes are a session overlay for that request. Sensitive extracts are masked
in the Response Viewer **Extracted** tab.

## Resolution rules

- Highest scope wins when names collide (Run > Request > Environment > Collection > Workspace > Global).
- Duplicate names **within** one scope are errors.
- Values may reference other variables; cycles are reported by name chain only.
- Built-ins such as `{{$timestamp}}` / `{{$uuid}}` are recognized as unsupported (not evaluated).
- OS environment variables and request-scoped definitions are not supported.

## Preview and diagnostics

- Request Editor shows a masked resolution preview with the effective source label per variable.
- Hover and completion expose names and scopes (document scope labeled **Request**); sensitive values stay masked.
- Unresolved variables needed by the selected request block network execution.
- Unknown names may suggest a close match (“Did you mean…?”).

## Related

- [Environments](./environments.md)
- [Authentication](./authentication.md)
- [Troubleshooting](./troubleshooting.md)
