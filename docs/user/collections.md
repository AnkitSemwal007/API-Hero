# Collections

Collections organize `.api` requests under your workspace. The **Collections** view is one of four Activity Bar views (with **Scenarios**, **Execution**, and **History**).

## Browse and filter

- Expand collections and folders in the tree.
- Toolbar **New Request**, **New Collection**, **Filter**, and **Refresh** (or **API Hero: Filter Collections** / **Refresh Collections**).
- View `…` menu: **New Folder**, **Import Collection**, **Import OpenAPI Specification**, **Reveal Active Request**.
- Environments, Authentication, Settings, History, and Overview are available from the Command Palette or Overview — not the Collections toolbar.
- **API Hero: Reveal Active Request** locates the open `.api` request in the tree.

## Create and structure

### New collection (prompt-first)

1. Click toolbar **New Collection** (or **API Hero: New Collection**).
2. If the workspace has multiple roots, choose which folder receives the collection.
3. The **Create Collection** dialog opens with:
   - **Name** (required)
   - **Description** (optional)
4. Validation stays in the dialog — empty name, invalid filesystem characters, reserved names, duplicate name, and path collisions. Errors appear inline; nothing is kept if Create fails.
5. Click **Create** to write under `Collections/<name>/` (initialize project store if needed, create the folder, write metadata, refresh the tree, and reveal the new collection).
6. **Cancel** closes the dialog with no filesystem writes, no project-store changes, no temporary collection, and no tree refresh.

This prompt-first flow avoids unnecessary disk writes, validates before the collection is kept, and matches modern create UX. It is distinct from **New Folder**, which still uses allocate-then-rename.

### Other structure actions

| Action | How |
| --- | --- |
| New folder | Context menu or view `…` menu — allocate-then-rename (creates a default-named folder, then opens rename; Cancel keeps the allocated folder) |
| New request | Toolbar **New Request** — webview dialog (name, method, URL, destination) |
| Rename | Context menu **Rename**, or **F2** on the selected item |
| Duplicate | Context menu — instant copy with a unique name; selection reveals the copy |
| Delete | Context menu **Delete**, or **Delete** / **⌘⌫** — modal confirmation |
| Move request | Context menu **Move…** |

Native collections may include `api-hero.collection.json` under the collection root (also produced by [OpenAPI import](./openapi-import.md)).

## Import and export

| Action | How |
| --- | --- |
| Import collection | View `…` menu **Import Collection** (folder picker) |
| Export collection | Context menu on a native collection (folder picker) |
| Import OpenAPI | View `…` menu **Import OpenAPI Specification** |

## Run from Collections

Use inline play actions or context menus:

- **Run Collection** / **Run Folder** / **Run Selected Requests**
- **Run Collection Tests** (assertions-focused collection run)

See [Collection Runner](./collection-runner.md).

## Related

- [Creating requests](./creating-requests.md)
- [Git workflow](./git-workflow.md)
- [Overview](./getting-started.md) via **API Hero: Open Overview**
- Contributors: [Create Collection workflow](../architecture/collections.md#create-collection-workflow)
