# History

History records completed single-request executions (including transport failures and cancelled-at-transport runs). Precondition failures before network (parse, validate, variables, auth) are **not** stored.

Entries are **metadata-only**: sanitized URL, status, timing, names — not Authorization headers, bodies, or secrets.

## Browse

Open the **History** Activity Bar view. Entries group by time (Today, Yesterday, Last 7 Days, Older).

| Action | Command |
| --- | --- |
| Open detail | **API Hero: Open History Entry** (History Detail panel) |
| Re-run | **API Hero: Re-run History Entry** |
| Reveal `.api` | **API Hero: Reveal Original Request** |
| Copy summary | **API Hero: Copy History Summary** |
| Delete / clear | **API Hero: Delete History Entry** / **Clear History** |
| Filter | **API Hero: Filter History** (status → method → text; clear text box to skip text filter) |
| Refresh | **API Hero: Refresh History** |

## Retention

`apiRunner.history.maxEntries` (default 1000) keeps the newest entries. Storage is under the extension global storage file.

## Related

- [Response viewer](./response-viewer.md)
- [Collection runner](./collection-runner.md)
- [Configuration](../reference/configuration.md)
