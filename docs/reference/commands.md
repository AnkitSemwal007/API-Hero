# Commands reference

Extension ID: `ankitsemwal.api-hero`. All command IDs use the `apiHero.*` prefix. Commands use `category: "API Hero"` with short titles; the Command Palette still displays them as **API Hero: Title**.

## Stubs (Coming Soon)

Hidden from the Command Palette (`when: false`). Invoking shows an information message.

| ID | Title |
| --- | --- |
| `apiHero.runFile` | Run File (Coming Soon) |
| `apiHero.login` | Login (Coming Soon) |
| `apiHero.logout` | Logout (Coming Soon) |

## Execution

| ID | Title |
| --- | --- |
| `apiHero.runRequest` | Run Request |
| `apiHero.runRequestWithAssertions` | Run Request with Assertions |

## Environments and authentication

| ID | Title |
| --- | --- |
| `apiHero.switchEnvironment` | Switch Environment |
| `apiHero.manageEnvironments` | Manage Environments |
| `apiHero.manageAuthProfiles` | Manage Authentication |
| `apiHero.selectAuthentication` | Select Authentication |

## Collections

| ID | Title | Notes |
| --- | --- | --- |
| `apiHero.focusCollections` | Focus Collections | |
| `apiHero.refreshCollections` | Refresh Collections | |
| `apiHero.filterCollections` | Filter Collections | |
| `apiHero.revealActiveRequest` | Reveal Active Request | |
| `apiHero.openCollectionRequest` | Open Request | |
| `apiHero.createCollection` | New Collection | Opens **Create Collection** (prompt-first; writes only after Create) |
| `apiHero.renameCollection` | Rename Collection | Explicit rename of an existing collection |
| `apiHero.deleteCollection` | Delete Collection | |
| `apiHero.duplicateCollection` | Duplicate Collection | |
| `apiHero.exportCollection` | Export Collection | |
| `apiHero.importCollection` | Import Collection | |
| `apiHero.createFolder` | New Folder | Allocate-then-rename (Explorer-like); distinct from Create Collection |
| `apiHero.renameFolder` | Rename Folder | |
| `apiHero.deleteFolder` | Delete Folder | |
| `apiHero.duplicateFolder` | Duplicate Folder | |
| `apiHero.createRequest` | New Request | |
| `apiHero.renameRequest` | Rename Request | |
| `apiHero.duplicateRequest` | Duplicate Request | |
| `apiHero.deleteRequest` | Delete Request | |
| `apiHero.moveRequest` | Move Request | |

## Collection runner

| ID | Title |
| --- | --- |
| `apiHero.runCollection` | Run Collection |
| `apiHero.runCollectionTests` | Run Collection Tests |
| `apiHero.runFolder` | Run Folder |
| `apiHero.runSelectedRequests` | Run Selected Requests |

## History

| ID | Title |
| --- | --- |
| `apiHero.focusHistory` | Focus History |
| `apiHero.openHistoryEntry` | Open History Entry |
| `apiHero.rerunHistoryEntry` | Re-run History Entry |
| `apiHero.revealHistoryRequest` | Reveal Original Request |
| `apiHero.copyHistorySummary` | Copy History Summary |
| `apiHero.deleteHistoryEntry` | Delete History Entry |
| `apiHero.clearHistory` | Clear History |
| `apiHero.searchHistory` | Filter History |
| `apiHero.refreshHistory` | Refresh History |

## Import and navigation

| ID | Title |
| --- | --- |
| `apiHero.importOpenApi` | Import OpenAPI Specification |
| `apiHero.openWorkspace` | Open Existing Workspace |
| `apiHero.openRequestEditor` | Open Request Editor |
| `apiHero.openOverview` | Open Overview |
| `apiHero.openSettings` | Open Settings |
| `apiHero.recentRequests` | Open History (palette-hidden alias of Focus History) |

## Related

- [Configuration](./configuration.md)
- [Stable identifiers](../release/stable-identifiers.md)
- [User guide](../user/getting-started.md)
