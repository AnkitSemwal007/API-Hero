# Variables and environments

Authentication runs after variable resolution. Profiles may reference a
resolved variable by name; authentication reads the captured value and never
persists it to SecretStorage. Authentication query decoration extends the
already-masked `presentationUrl` without exposing the resolved credential.

## Syntax, scopes, and precedence

Runtime references use the parser's canonical `{{name}}` syntax. Document
definitions use additive parser-recognized directives:

```api
@variable host=https://api.example.test
@sensitive-variable token=secret
GET {{host}}/users
Authorization: Bearer {{token}}
```

Definitions are effective in this highest-to-lowest order: document, active
environment, workspace, global. Shadowing across scopes is intentional.
Duplicate names within one scope are errors. Variable names match
`[A-Za-z_][A-Za-z0-9_.-]*`. Values are strings and may contain references.
Request-scoped definitions and operating-system environment variables are not
supported.

The settings schema is:

- `apiRunner.variables.global`: `{ name, value, sensitive? }[]`
- `apiRunner.variables.workspace`: `{ name, value, sensitive? }[]`
- `apiRunner.environments`: `{ id, name, variables }[]`
- `apiRunner.activeEnvironment`: an optional environment ID

Settings own persistence. The switch command changes the active environment
for the extension session; it does not write settings. No SecretStorage schema
was introduced. Sensitive values should therefore be kept in trusted user
settings rather than committed workspace settings.

## Environment snapshots

`EnvironmentManager` exposes one active environment and switches it atomically.
`capture()` returns a detached, deeply frozen snapshot. Execution and language
features consume the same manager. A request captures definitions before
resolution, so later switches cannot alter in-flight behavior. Environments
are user-defined; no Development/Testing/Staging/Production records are
hard-coded.

## Resolution

`DefaultVariableResolver` is framework neutral. It computes effective
definitions, expands dependencies with deterministic depth-first traversal,
and reports structured errors for missing variables, duplicate definitions,
cycles, malformed definitions, and unsupported built-ins. Cycle reports
contain names only and have a stable chain such as `a -> b -> a`.

Sensitivity propagates transitively. Substitution is string-only: no code,
expression, or host environment evaluation occurs. `{{$timestamp}}` and
`{{$uuid}}` are recognized and reported as unsupported for future
compatibility.

The resolver creates a new deeply frozen `RuntimeRequest`. URL and body content
remain authoritative; query and form projections are rebuilt from resolved
content and path placeholders are cleared. Headers, cookies, directive values,
references, metadata, and string extension values are resolved. The input is
never mutated or aliased.

## Boundaries and integration

The only execution sequence is:

`parse -> scoped validate -> buildSelectedRequest -> resolveRequest -> RequestExecutor`

The parser adapter extracts document definitions, but the resolver never
inspects the AST. The executor and transport do not resolve variables. A
resolution error relevant to the selected request blocks network execution,
marks status failed, and never opens the response viewer. Unrelated unresolved
definitions do not block the selected request.

The runtime parser adapter combines parser/validator diagnostics with variable
diagnostics and deduplicates by code and range. It reuses the document-version
cache. Configuration or active-environment changes invalidate adapters and
refresh diagnostics. Hover and completion use the same immutable definition
snapshot: hover masks sensitive values, and completion exposes names,
effective scopes, and sensitivity but never values.

## Security and presentation

Errors, diagnostics, status, and notifications contain variable names/chains
only. Sensitive values are masked with `••••••••`. Resolved requests carry a
separate masked presentation URL; execution uses the real URL while result
presentation uses the masked form. Sensitive response headers retain the
existing masking behavior. The resolver does not log values.

## Exclusions

This subsystem does not implement authentication, history, collections,
OpenAPI, AI, operating-system variables, built-in values, secret persistence,
request-scoped definitions, or broad environment UI. Node's existing
`node:test` runner remains authoritative; adding Vitest would create a second
runner and duplicate the established test infrastructure.
