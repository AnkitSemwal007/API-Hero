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
5. **Save** to persist into settings (`apiRunner.environments`).

## Switch environment

- **API Hero: Switch Environment** (QuickPick)
- Click the environment **status bar** item (left)

Switching updates the session active environment. Persistence of the environment list and optional `apiRunner.activeEnvironment` ID is through VS Code settings.

## Variable scopes

Effective definitions (highest wins):

1. **Request** (`@variable` / `@sensitive-variable` in the `.api` file — document scope)
2. Active **Environment**
3. **Workspace** (`apiRunner.variables.workspace`)
4. **Global** (`apiRunner.variables.global`)

One-line reminder: Request overrides Environment overrides Workspace overrides Global.

Reference values as `{{name}}` in URLs, headers, and bodies.

## Tips

- Prefer user settings for secrets; avoid committing sensitive workspace values.
- Auth profiles can reference variables by name after resolution.

## Related

- [Variables](./variables.md)
- [Authentication](./authentication.md)
- [Configuration](../reference/configuration.md)
