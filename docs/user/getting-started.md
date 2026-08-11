# Getting started

Install **API Hero** (`ankitsemwal.api-hero`) from the Marketplace or a VSIX, then open a folder workspace.

## First five minutes

1. Open the **API Hero** Activity Bar icon. You see **Collections**, **Execution**, and **History**. (**Scenarios** appears when you create or successfully load scenarios.)
2. In Collections, choose **New Collection** (or **API Hero: New Collection**). Fill the **Create Collection** dialog (**Name** required, **Description** optional). The collection is created under `Collections/<name>/` only after you confirm **Create** — Cancel writes nothing.
3. Choose **New Request**, set a name/method/URL in the dialog, then edit in the **Request Editor** (default for `*.api`).
4. Click **Run** in the Request Editor toolbar, or press `Ctrl+Alt+R` / `Cmd+Alt+R` while the Request Editor (or text editor) is focused.
5. Inspect the **Response** panel; the run also appears under **History**.

Environments and authentication are optional for a first public GET — configure them when you need variables or credentials.

## Core concepts

| Concept | Role |
| --- | --- |
| `.api` file | Canonical request source (text grammar; UI writes into it) |
| Collection | Workspace folder of requests (optional `api-hero.collection.json` marker) |
| Environment | Named variable set; switch via command or status bar |
| Auth profile | Metadata in settings; secrets in VS Code Secret Storage |
| History | Local metadata of completed runs (no response bodies by default) |

## Useful entry points

| Task | Command |
| --- | --- |
| Overview | **API Hero: Open Overview** |
| Environments | **API Hero: Manage Environments** |
| Authentication | **API Hero: Manage Authentication** |
| Reset workspace | **API Hero: Reset Workspace...** (destructive; Collections preserved) |
| Import OpenAPI | **API Hero: Import OpenAPI Specification** |
| Settings | **API Hero: Open Settings** |

## Next steps

- [Creating requests](./creating-requests.md)
- [Collections](./collections.md)
- [CLI / CI runner](./cli.md)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
- [Troubleshooting](./troubleshooting.md)
