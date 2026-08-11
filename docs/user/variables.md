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
| **Workspace** | workspace | Environment Manager → Workspace, or setting `apiHero.variables.workspace` |
| **Global** | global | Environment Manager → Global, or setting `apiHero.variables.global` |

**Precedence (highest wins):** Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global.

When the same name exists in more than one scope, hover and completion show the **effective** (winning) source. Sensitive values stay masked.

## Define variables

| Scope | Where |
| --- | --- |
| Run | Extraction with `scope=run` (default), or the Collection Runner's per-run store during a collection run |
| Request (document) | `@variable host=https://api.example.test` or `@sensitive-variable token=…` |
| Environment | Environment Manager → environment variables |
| Collection | `Collections/<Name>/api-hero.variables.json`; sensitive values move to a local overlay, keyed by collection |
| Workspace | Setting `apiHero.variables.workspace` |
| Global | Setting `apiHero.variables.global` |

Optional `sensitive: true` masks values in language UI and previews.

## Extract from responses

Use `@extract` / `@sensitive-extract` (or the Request Editor **Extract** tab, or
**Extract Variable…** in the Response Viewer) to copy values from the last
response into variables:

```api
@extract token from body.access_token scope=environment
@extract id from body.id
@extract tenant from body.tenant scope=workspace
GET https://example.test/login
```

| Scope | Behavior |
| --- | --- |
| **Run** (default in DSL) | Session-only; highest precedence |
| **Request** (`document`) | Session overlay for that request |
| **Environment** | Persists to the active environment (Response Viewer default) |
| **Collection** | Persists to the owning collection’s `api-hero.variables.json` (works for single requests under a collection, not only during a collection run) |
| **Workspace** | Persists to workspace variables |
| **Global** | **Forbidden for extract** — not offered in UI; parse rejects it |

Sensitive extracts are masked in the Response Viewer **Extracted** tab. Sensitive
environment / workspace / collection values use the existing local overlay path.

## Passing values between requests

During a **collection run**, extract in one request and consume with `{{name}}`
in a later one. For example: Login `@extract`s `token` → Get User uses
`{{token}}` and `@extract`s `userId` → Get Orders uses `{{userId}}`. The
Collection Runner reorders by produces/consumes (and optional `@depends-on`) so
producers run first. Details, failure skip behavior, and how this differs from
Scenarios: [Request Dependencies & Data Flow](./collection-runner.md#request-dependencies--data-flow).

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

- [Collection Runner](./collection-runner.md) (Request Dependencies & Data Flow)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
- [Troubleshooting](./troubleshooting.md)
