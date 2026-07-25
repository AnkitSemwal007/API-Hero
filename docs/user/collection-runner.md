# Collection Runner

Run many requests sequentially without opening a response panel for each one. Each attempt still goes through the same execution pipeline and History capture.

## Start a run

From the Collections tree:

| Scope | Command |
| --- | --- |
| Entire collection | **API Hero: Run Collection** |
| Folder (nested DFS) | **API Hero: Run Folder** |
| Selected request nodes | **API Hero: Run Selected Requests** |
| Collection with tests | **API Hero: Run Collection Tests** |

Progress appears as a cancellable notification and status bar item. When finished, the **Collection Run Report** panel summarizes outcomes.

## Failure policy

Setting `apiRunner.collectionRunner.failurePolicy` (default `ask`):

| Value | Behavior |
| --- | --- |
| `ask` | Prompt before each run |
| `stop-on-first-error` | Stop; remaining marked skipped |
| `continue-on-error` | Continue after failures |
| `skip-invalid-requests` | Skip unread/invalid; continue on execution failures |

User cancel stops the run; in-flight request is aborted when possible; remaining planned requests are cancelled.

## Notes

- Per-request Response viewer is suppressed during collection runs.
- History still records each network-attempted request (with optional `collectionName`).
- Order follows a frozen Collections snapshot (depth-first folder expansion).

## Related

- [Collections](./collections.md)
- [Assertions](./assertions.md)
- [History](./history.md)
