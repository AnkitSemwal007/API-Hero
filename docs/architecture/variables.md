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

Definitions are effective in this highest-to-lowest order: run, document,
active environment, collection, workspace, global. Shadowing across scopes is
intentional. Duplicate names within one scope are errors. Variable names match
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

## Response extraction (`@extract`)

`@extract` / `@sensitive-extract` write values from a response into `run`,
document-session overlay, active environment, collection, or workspace after
execute. See [ADR-0001](./adr/0001-variables-extraction-auth-dependencies.md).
Extracted `run` and overlay values are merged into `getVariableContext` for
the next single request; environment and workspace writes refresh Environment
Manager via `EnvironmentVariableWriter` / `WorkspaceVariableWriter` (both use
`writeEnvironmentManagerState` ports; sensitive values follow the existing
local overlay path). Collection-scope writes use `CollectionVariableWriter`:
prefer an active collection-run context, otherwise resolve the owning
collection root from the request source path (`resolveCollectionRootPathForSource`)
so single-request `@extract scope=collection` works outside a collection run.
Global extract remains forbidden.

Create Variable From Response (Response Viewer) persists a Mode B extract rule
into the `.api` source and also writes the current value through
`CompositeVariableWriter` for the chosen scope.

### Collection variables (Phase 2)

Each collection may define its own variable bag, persisted alongside the
collection at `Collections/<Name>/api-hero.variables.json`
(`COLLECTION_VARIABLES_FILENAME`, schema version 1). Non-sensitive values are
written in the tracked file; sensitive values are redacted there (empty
string + `sensitive: true`) and their real values live in the gitignored
`.apihero/local/variables.local.json` overlay under
`collections[collectionId][name]`, matching the existing environment/workspace
redaction pattern. `collectionId` is the same stable id discovery already
computes from the collection root path (`collection:<path>`).

`FilesystemCollectionVariableStore` (`src/variables/collection-variable-store.ts`)
owns load/upsert/refresh: a missing or corrupt tracked file yields `[]`
(never throws), and `load` merges the sensitive overlay before returning
`VariableDefinition[]` with `scope: 'collection'`. Precedence is unchanged —
collection sits between workspace and environment:
`run > document > environment > collection > workspace > global`.

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
snapshot via `VariableCompletionService`: hover masks sensitive values, and
completion exposes names, effective scopes, icons, and sensitivity but never
secret values. Unknown references are warnings (not blockers) and may include a
fuzzy "Did you mean" suggestion.

## Variable Completion Service

`VariableCompletionService` (`src/variables/variable-completion-service.ts`) is
the reusable IntelliSense catalog for text editors and the Request Editor:

- Merges scopes with resolver precedence (run → document → environment →
  collection → workspace → global)
- Caches effective items by definition fingerprint (refresh on env/workspace/
  global/document/project changes only)
- Fuzzy-filters names without rebuilding the catalog
- Detects open `{{` regions, builds insert text without duplicating braces, and
  resolves non-sensitive inline previews

Text language features consume it through `RuntimeParserAdapter`. The Request
Editor host posts a safe `variableCompletions` catalog; the webview renders a
VS Code–like suggestion popup (keyboard/mouse, Escape, Tab/Enter, Ctrl+Space)
plus URL resolution preview and unknown-variable hints.

## Security and presentation

Errors, diagnostics, status, and notifications contain variable names/chains
only. Sensitive values are masked with `••••••••`. Resolved requests carry a
separate masked presentation URL; execution uses the real URL while result
presentation uses the masked form. Sensitive response headers retain the
existing masking behavior. The resolver does not log values.

## Environment Manager and status bar

**API Hero: Manage Environments** opens the Environment Manager webview
(`src/variables/vscode/environment-manager-panel.ts`) for CRUD on
`apiRunner.environments` and related variable lists. The sidebar is split into
two sections: **Environments** (named environment records) and **Scopes**
(Workspace Variables and Global Variables). Scopes are not environments; they
are fixed variable stores edited in the same panel. The active environment is
called out with a persistent detail strip, an **Active** badge on the list row
and header, and bold list labeling. An **environment status bar** item reflects
the active environment and opens the switch flow. These UI surfaces sit outside
the Activity Bar (Collections + History only).

## Exclusions

This subsystem does not implement authentication, history, OpenAPI, AI,
operating-system variables, built-in value evaluation, secret persistence for
variables, or request-scoped definitions. Collection *discovery*, mutation,
and the runner belong to the Collections and Collection Runner subsystems —
only the collection variable store and writer described above live here.
Node's existing `node:test` runner remains authoritative; adding Vitest would
create a second runner and duplicate the established test infrastructure.
