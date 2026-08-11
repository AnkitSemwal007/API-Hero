# Collection chaining / runner regression suite

Catalog of FakeStore + ADR 0003 bug cases (TC001–TC041). Prefer real engine
assertions; Auto edges never serialize.

| TC | File | Notes |
|----|------|--------|
| TC001–TC005 | `collection-chaining-regression.test.ts` | Extract parse + engine |
| TC006–TC010 | `collection-chaining-regression.test.ts` | Depends-on + rename |
| TC011–TC013 | `collection-chaining-regression.test.ts` | Facade projection; TC011 asserts `graphEdges` ≡ `buildDependencyGraph` |
| TC014 | `collection-runner-regression.test.ts` | FakeStore mocked run (order + extract + run store) |
| TC015–TC017 | `collection-chaining-regression.test.ts` | Unknown / garbage depends-on |
| TC018–TC020 | `collection-runner-regression.test.ts` | Variables / static scopes never create Auto edges |
| TC021–TC025 | `collection-chaining-regression.test.ts` | JSON path accept/reject |
| TC026–TC028 | `collection-chaining-regression.test.ts` | Graph / cycle / mixed topo; TC027 asserts cycle path labels |
| TC029–TC031 | `collection-chaining-regression.test.ts` | Serialize / pin |
| TC032–TC035 | `collection-chaining-regression.test.ts` | UI HTML smoke only (PARTIAL — not engine proof) |
| TC036–TC038 | `collection-chaining-regression.test.ts` | Scale smoke / cache (no wall-clock flake gate) |
| TC039–TC041 | `collection-runner-regression.test.ts` | A→B→C Login→Get User→Get Orders (reorder, failure skip, cycle path + one-request enrich no-reorder) |

## Intentionally PARTIAL

- **Create Extract / Create Variable** suggestions in the Unknown-variables UI —
  projection surfaces `unknownVariables`; click-to-create handlers are UI-only
  and are not re-asserted beyond HTML presence of the Unknown list (TC034).
- **TC032–TC035** prove webview markup presence, not Autofill engine behavior.
