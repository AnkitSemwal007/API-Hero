# Variables

Runtime substitution uses `{{name}}`. Names match `[A-Za-z_][A-Za-z0-9_.-]*`.

## Where values come from

Every `{{name}}` resolves from the highest scope that defines it. UI labels match IntelliSense:

| UI label | Technical scope | Where you define it |
| --- | --- | --- |
| **Request** | document | `@variable` / `@sensitive-variable` in the `.api` file (Request Editor Variables tab) |
| **Environment** | environment | Environment Manager → named environment (only the **active** environment applies) |
| **Workspace** | workspace | Environment Manager → Workspace, or setting `apiRunner.variables.workspace` |
| **Global** | global | Environment Manager → Global, or setting `apiRunner.variables.global` |

**Precedence (highest wins):** Request overrides Environment overrides Workspace overrides Global.

When the same name exists in more than one scope, hover and completion show the **effective** (winning) source. Sensitive values stay masked.

## Define variables

| Scope | Where |
| --- | --- |
| Request (document) | `@variable host=https://api.example.test` or `@sensitive-variable token=…` |
| Environment | Environment Manager → environment variables |
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
persist to the active environment. Request (`document`) writes are a session
overlay for that request. Sensitive extracts are masked in the Response Viewer
**Extracted** tab.

## Resolution rules

- Highest scope wins when names collide (Request > Environment > Workspace > Global).
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
