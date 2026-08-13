# Troubleshooting

## Request will not run

- Confirm the file language is `api` / extension `.api`.
- Fix Problems diagnostics (syntax, unknown method, duplicate variables).
- Ensure required `{{variables}}` resolve for the active environment.
- Check auth: missing profile, duplicate profile id, or missing secret fields block execution.
- Verify `apiHero.requestTimeout` and network reachability.

## Response too large

`RESPONSE_TOO_LARGE` means the download exceeded `apiHero.maxResponseBytes` (default 10 MiB). Raise the limit or set `0` for no limit (use carefully).

## Collections empty or stale

- **Refresh Collections**.
- Confirm `.api` files are under a workspace folder.
- Clear **Filter Collections** if a filter is active.
- After OpenAPI import errors, no files are written — fix the spec and re-import.

## History missing a run

History skips runs that never reached transport (parse/validate/variables/auth failures) and cancelled-before-execute cases. Check Problems instead.

## Auth or environment UI

- **Manage Environments** / **Manage Authentication** open webviews — not Activity Bar views.
- Secret values never appear cleartext in managers after save; re-enter secrets when rotating.

## Reset workspace data

Use **API Hero: Reset Workspace...** from the Command Palette (no Explorer or Settings UI). Confirm the modal carefully: it permanently removes `.apihero` data (auth profiles, environments, workspace/local variables, project config), request history (extension-wide), and related workspace state for the **primary** workspace folder. **Collections**, `.api` request files, collection variables (`api-hero.variables.json`), and project source code are preserved. Workspace settings (`apiHero.*`) are not cleared.

## Stubs

**Run File**, **Account Login**, and **Account Logout** are not available and are
hidden from the Command Palette. They are unrelated to **Authentication Login API**
(**Run Authentication Login** / Auth Manager **Run Login**), which is supported.

## Related

- [FAQ](./faq.md)
- [Configuration](../reference/configuration.md)
- [Getting started](./getting-started.md)
