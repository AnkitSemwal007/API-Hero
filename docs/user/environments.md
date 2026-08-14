# Environments

Environments are named sets of variables. Exactly one environment may be active (or none).

## Manage environments

1. Run **API Hero: Manage Environments** (Command Palette or Overview).
2. In the Environment Manager sidebar, use **Environments** for named
   environments and **Scopes** for Workspace / Global variables (scopes are not
   environments).
3. Create, rename, or edit variables in the detail pane. The active environment
   shows an **Active** badge in the list and header.
4. Mark variables **sensitive** when values should be masked in UI.
5. **Save** to persist into settings (`apiHero.environments`).

## Switch environment

- **API Hero: Switch Environment** (QuickPick)
- Click the environment **status bar** item (left)

Switching updates the session active environment. Persistence of the environment list and optional `apiHero.activeEnvironment` ID is through VS Code settings.

Collection Run Setup can select an environment (or **No Environment**) for that run and previews resolved variables with sensitive values masked. That selection applies to the run; it does not replace **Switch Environment** for the workspace session.

## Variable scopes

Effective definitions (highest wins):

1. **Run** (extracted during the current request run, or the Collection Runner's shared per-run store)
2. **Request** (`@variable` / `@sensitive-variable` in the `.api` file — document scope)
3. Active **Environment**
4. **Collection** (`Collections/<Name>/api-hero.variables.json`, with sensitive values in a local overlay)
5. **Workspace** (`apiHero.variables.workspace`)
6. **Global** (`apiHero.variables.global`)

One-line reminder: Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global.

Reference values as `{{name}}` in URLs, headers, and bodies.

## Tips

- Prefer user settings for secrets; avoid committing sensitive workspace values.
- Auth profiles can reference variables by name after resolution.

## Related

- [Variables](./variables.md)
- [Authentication](./authentication.md)
- [Configuration](../reference/configuration.md)
