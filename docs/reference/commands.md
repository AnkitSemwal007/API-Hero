# Commands reference

Extension ID: `ankitsemwal.api-hero`. All command IDs use the `apiRunner.*` prefix. Commands use `category: "API Hero"` with short titles; the Command Palette still displays them as **API Hero: Title**.

## Stubs (Coming Soon)

Hidden from the Command Palette (`when: false`). Invoking shows an information message.

| ID | Title |
| --- | --- |
| `apiRunner.runFile` | Run File (Coming Soon) |
| `apiRunner.login` | Login (Coming Soon) |
| `apiRunner.logout` | Logout (Coming Soon) |

## Execution

| ID | Title |
| --- | --- |
| `apiRunner.runRequest` | Run Request |
| `apiRunner.runRequestWithAssertions` | Run Request with Assertions |

## Environments and authentication

| ID | Title |
| --- | --- |
| `apiRunner.switchEnvironment` | Switch Environment |
| `apiRunner.manageEnvironments` | Manage Environments |
| `apiRunner.manageAuthProfiles` | Manage Authentication |
| `apiRunner.selectAuthentication` | Select Authentication |

## Collections

| ID | Title | Notes |
| --- | --- | --- |
| `apiRunner.focusCollections` | Focus Collections | |
| `apiRunner.refreshCollections` | Refresh Collections | |
| `apiRunner.filterCollections` | Filter Collections | |
| `apiRunner.revealActiveRequest` | Reveal Active Request | |
| `apiRunner.openCollectionRequest` | Open Request | |
| `apiRunner.createCollection` | New Collection | Opens **Create Collection** (prompt-first; writes only after Create) |
| `apiRunner.renameCollection` | Rename Collection | Explicit rename of an existing collection |
| `apiRunner.deleteCollection` | Delete Collection | |
| `apiRunner.duplicateCollection` | Duplicate Collection | |
| `apiRunner.exportCollection` | Export Collection | |
| `apiRunner.importCollection` | Import Collection | |
| `apiRunner.createFolder` | New Folder | Allocate-then-rename (Explorer-like); distinct from Create Collection |
| `apiRunner.renameFolder` | Rename Folder | |
| `apiRunner.deleteFolder` | Delete Folder | |
| `apiRunner.duplicateFolder` | Duplicate Folder | |
| `apiRunner.createRequest` | New Request | |
| `apiRunner.renameRequest` | Rename Request | |
| `apiRunner.duplicateRequest` | Duplicate Request | |
| `apiRunner.deleteRequest` | Delete Request | |
| `apiRunner.moveRequest` | Move Request | |

## Collection runner

| ID | Title |
| --- | --- |
| `apiRunner.runCollection` | Run Collection |
| `apiRunner.runCollectionTests` | Run Collection Tests |
| `apiRunner.runFolder` | Run Folder |
| `apiRunner.runSelectedRequests` | Run Selected Requests |

## History

| ID | Title |
| --- | --- |
| `apiRunner.focusHistory` | Focus History |
| `apiRunner.openHistoryEntry` | Open History Entry |
| `apiRunner.rerunHistoryEntry` | Re-run History Entry |
| `apiRunner.revealHistoryRequest` | Reveal Original Request |
| `apiRunner.copyHistorySummary` | Copy History Summary |
| `apiRunner.deleteHistoryEntry` | Delete History Entry |
| `apiRunner.clearHistory` | Clear History |
| `apiRunner.searchHistory` | Filter History |
| `apiRunner.refreshHistory` | Refresh History |

## Import and navigation

| ID | Title |
| --- | --- |
| `apiRunner.importOpenApi` | Import OpenAPI Specification |
| `apiRunner.openWorkspace` | Open Existing Workspace |
| `apiRunner.openRequestEditor` | Open Request Editor |
| `apiRunner.openOverview` | Open Overview |
| `apiRunner.openSettings` | Open Settings |
| `apiRunner.recentRequests` | Open History (palette-hidden alias of Focus History) |

## Related

- [Configuration](./configuration.md)
- [Stable identifiers](../release/stable-identifiers.md)
- [User guide](../user/getting-started.md)
