# Test Hardening Sprint Report

Date: 2026-07-21  
Baseline: 24 test files, 288 tests  
After: 32 test files (net), **321 tests, 0 failures**

## Overall coverage (c8)

```
Statements   : 89.13% ( 16629/18657 )
Branches     : 81.98% ( 2745/3348 )
Functions    : 81.81% ( 783/957 )
Lines        : 89.13% ( 16629/18657 )
```

Coverage is report-only — no CI threshold was configured.

> Note: c8 instruments compiled `dist/` sources that map back to `src/`. VS Code adapter modules that import `vscode` remain largely unexecuted under `node:test` (expected). Deprecated `line-analysis` is skipped and shows ~14% incidental load coverage.

## Coverage by module (approximate statement %)

| Module | Approx. lines % | Notes |
|--------|-----------------|-------|
| `storage` | 100% | Fake SecretStorage seam |
| `commands` (pure helpers) | 100% | Argument + invocation resolver |
| `history` (domain + file store) | ~95%+ | File store via Node fs backend |
| `collection-runner` | ~95% | Failure policies 100% |
| `assertions` | ~85–98% | Engine/json-path still have gaps |
| `orchestration` | ~93% | Integration path covered |
| `parser` / lexer / tokenizer | ~94–98% | Strong |
| `execution` | ~95% | Empty body / content-type edges |
| `response` | ~95% | Masking already strong |
| `variables` | ~90% | Document adapter 100% |
| `shared` | ~91% | Logging/errors lightly covered |
| `openapi-import` | ~70–85% | `schema-sample` still weak (~29%) |
| `language-support/core/line-analysis` | ~14% | Suite skipped (deprecated) |
| VS Code adapters (`**/vscode/**`) | Low / N/A | Not run under node:test |

## Inventory added this sprint

### Production seams (minimal)

1. **`src/history/file-history-store.ts`** — framework-free `HistoryStorageFs` + `FileHistoryStore`; VS Code `FileHistoryRepository` is a thin adapter (public API unchanged).
2. **`src/assertions/build-assertion-diagnostics.ts`** — pure `buildAssertionDiagnostics(report)`; Problems panel adapter calls it.
3. **`src/commands/resolve-run-request-invocation.ts`** — pure `resolveRunRequestInvocation(...)`; Run Request command is a thin UI adapter.

### New test files

- `src/variables/document-variable-adapter.test.ts`
- `src/collection-runner/failure-policies.test.ts`
- `src/storage/secret-storage-service.test.ts`
- `src/history/file-history-repository.test.ts`
- `src/shared/shared-security.test.ts`
- `src/commands/resolve-run-request-invocation.test.ts`
- `src/orchestration/pipeline-integration.test.ts`

### Strengthened / adjusted suites

- `assertions.test.ts` — deep `parseExpectLine` structure, summary/history counts, diagnostics mapping + secret absence
- `history.test.ts` — forbidden field names; richer sanitize cases
- `parser.test.ts` — empty body, unicode headers, long URL, large-doc hang detector
- `execution/request-executor.test.ts` — empty body + unexpected content-type
- `collections.test.ts` — empty workspace + duplicate `@name` labels
- `openapi-import.test.ts` — traversal edges, invalid YAML, empty paths, duplicate operationIds; large-import hang budget → 60s
- `line-analysis.test.ts` — entire suite skipped with deprecation message

### Tooling

- `c8` added as a devDependency
- Scripts: `test:coverage`, `test:unit` (alias)
- `test` globs extended for `dist/storage/*.test.js` and `dist/shared/*.test.js`

## Missing scenarios remaining

- Most `src/**/vscode/**` adapters (tree providers, panels, command registration, progress UI)
- OpenAPI `schema-sample.ts` branches and many generator edge media types
- Assertion engine operator combinations not exercised exhaustively
- Shared `Logger` / domain error constructors
- Collection discovery issue paths (`UNREADABLE_FILE`, `PARSE_FAILURE`) depth
- Full multi-request collection runs against real parse→execute (only single-item integration today)
- Extension activation / `extension.ts` wiring smoke (requires VS Code test host)

## Risk assessment

| Area | Risk | Rationale |
|------|------|-----------|
| Domain pipelines | Low | Integration covers success, assertion failure, cancel, collection single-item |
| Secret leakage in reports/history | Low | Cross-layer masking/sanitize tests extended |
| File history persistence | Low | Node-backed store round-trips + corrupt/missing/concurrent |
| VS Code UI adapters | Medium | Still untested under node:test |
| OpenAPI generators | Medium | Structural import OK; schema sampling thin |
| Deprecated line-analysis | Low | Skipped; runtime parser adapter is authoritative |

## Performance concerns

- Large OpenAPI import hang detector relaxed to **60s** (structural asserts remain primary).
- Parser large-document hang detector (**200 requests**, 60s) added — cheap.
- Large assertion JSON and concurrent history appends already covered without tight SLAs.
- No evidence of pathological hangs in the suite (~1–2s domain run after compile).

## Security concerns

- Remaining: VS Code-facing surfaces (webview postMessage already schema-tested; SecretStorage enumeration deliberately absent).
- History sanitize on a single line collapses after the first header match (by design of the regex) — multiline messages are fully scrubbed; callers should avoid packing multiple header leaks on one line without separators if they need per-header markers.
- Continue avoiding plaintext secrets in expect/assert output (placeholders only when proving redaction).

## Recommended follow-up work

1. Introduce a VS Code test host (or `@vscode/test-electron`) for adapter smoke tests.
2. Raise OpenAPI `schema-sample` / request-generator branch coverage.
3. Optionally add `c8` thresholds later (start with statements ≥ 85% on domain packages only).
4. Expand collection-runner integration to multi-request stop/continue policies against the real orchestrator.
5. Consider deleting or relocating deprecated `line-analysis` once no production callers remain.
6. ~~Harden `FileHistoryStore.readDocument` so non-missing I/O errors rethrow instead of caching an empty document~~ **Done (2026-07-21):** missing/corrupt → empty; other I/O rethrows; cache unset on failure.

## Verification gate

- `npm run check` — pass
- `npm test` — **321 pass, 0 fail**
- Public APIs of `FileHistoryRepository` / `fromExtensionContext` preserved
