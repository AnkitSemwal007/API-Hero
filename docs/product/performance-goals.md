# API Hero — Performance Goals

**Version:** 1.2 (Final Polish)  
**Role:** Measurable UX performance targets from 0.5 → 1.0.  
**Related:** [`product-experience.md`](./product-experience.md) · [`technical-constraints.md`](./technical-constraints.md) · [`roadmap.md`](./roadmap.md)

Targets assume a mid-range developer laptop, single workspace folder, warm extension host, and collections of the sizes noted. Exceeding a **budget** is a release blocker for the owning phase; exceeding a **stretch** is tech-debt.

---

## 1. Principles

1. **Activation stays light** — Do not pay OpenAPI/network costs at activate.  
2. **Trees use snapshots** — No unbounded FS walk on every expand.  
3. **Debounce sync** — Form ↔ document sync batches edits.  
4. **Response stays local** — Render in-process; no remote webview fetches.  
5. **Measure on CI where possible** — Unit/integration for pure paths; manual/EDH for webview paint.  
6. **Degrade gracefully** — Prefer progress + cancel + simpler rendering over freeze.

---

## 2. Latency budgets

| Operation | Target (p95) | Stretch | Max acceptable | Notes |
| --- | --- | --- | --- | --- |
| **Extension activate** (to commands/views registered) | ≤ 400 ms | ≤ 250 ms | 800 ms | Eager today; defer heavy work |
| **Collections tree first paint** (≤ 50 requests) | ≤ 300 ms | ≤ 150 ms | 1 s | From focus/refresh |
| **Collections tree** (≤ 500 requests) | ≤ 1.0 s | ≤ 600 ms | 2.5 s | Parse cache warm |
| **Collections tree** (≤ 2 000 requests) | ≤ 3.0 s | ≤ 2.0 s | 6 s | Still usable; show progress if >1 s |
| **Tree refresh** (incremental, small change) | ≤ 200 ms | ≤ 100 ms | 500 ms | Single file save |
| **Request Editor open** (single-request file) | ≤ 350 ms | ≤ 200 ms | 800 ms | Including first webview |
| **Request Editor sync** (form→doc debounce settle) | ≤ 150 ms after idle | ≤ 80 ms | 400 ms | Debounce window excluded |
| **Text → form refresh** | ≤ 200 ms after idle | ≤ 100 ms | 500 ms | |
| **Run request** (local/mock excluded) | Network-bound | — | UI chrome ≤ 100 ms to show progress | Progress must appear immediately |
| **Response panel first content** (≤ 256 KB body) | ≤ 250 ms after result | ≤ 120 ms | 800 ms | |
| **Response panel** (≤ 2 MB body) | ≤ 1.0 s | ≤ 600 ms | 2.5 s | Consider truncated pretty-print |
| **History load** (≤ 1 000 entries) | ≤ 200 ms | ≤ 100 ms | 500 ms | Metadata only |
| **History search filter** | ≤ 50 ms | ≤ 20 ms | 150 ms | In-memory |
| **OpenAPI import** (≤ 100 operations) | ≤ 5 s | ≤ 3 s | 15 s | Progress + cancel |
| **OpenAPI import** (≤ 500 operations) | ≤ 20 s | ≤ 12 s | 60 s | |
| **Postman import** (≤ 100 requests) | ≤ 8 s | ≤ 5 s | 20 s | Phase 5 |
| **Collection run UI tick** (per request overhead) | ≤ 30 ms | ≤ 15 ms | 80 ms | Beyond HTTP time |
| **Manager webview open** | ≤ 300 ms | ≤ 150 ms | 700 ms | Env/Auth/Import Hub panels |
| **History Detail panel open** | ≤ 200 ms | ≤ 100 ms | 500 ms | Metadata only |
| **Walkthrough step reveal** | ≤ 150 ms | ≤ 80 ms | 400 ms | Host-controlled |

---

## 3. Memory budgets

| Area | Target | Max | Notes |
| --- | --- | --- | --- |
| Extension host baseline (idle, small workspace) | ≤ 40 MB delta | 80 MB | Rough; host-shared |
| Parse cache | Bound by file count × avg AST | Evict/inactive | Do not retain all bodies |
| History store | Metadata only; ≤ `history.maxEntries` | Enforce setting | Never store response bodies by default |
| Response webview | Release prior large DOM on new run | — | Avoid stacking panels unbounded |
| Webview count | Prefer singleton Response panel | — | Managers may be singleton per type |
| Import buffers | Stream/chunk where practical | Cap by setting | |

---

## 4. Synchronization budgets

| Path | Rule |
| --- | --- |
| Form → document | Debounce 100–200 ms; coalesce bursts |
| Document → form | Debounce 100–200 ms; drop stale via version |
| Echo loop | Must be zero WorkspaceEdit ping-pong |
| Concurrent edits | Buffer wins; form reloads |
| Manager → settings | Debounce save 300–500 ms; never write every keystroke |

Violation = data-loss risk → P0 defect.

---

## 5. Webview rendering

| Rule | Detail |
| --- | --- |
| Initial HTML | Prefer static shell + `postMessage` state |
| Large JSON | Virtualize or collapse by default past depth/size thresholds |
| Syntax highlight | Cap work for huge raw text; fall back to plain |
| CSP | No remote scripts/styles/fonts (load cost + security) |
| Repaint | Avoid full innerHTML replace on every keystroke |
| First paint | Shell visible before heavy JSON parse when possible |

---

## 6. Search latency

| Surface | Budget |
| --- | --- |
| History text filter | ≤ 50 ms p95 for 1k entries |
| Future Collections filter | ≤ 100 ms p95 for 2k nodes (client-side index) |
| Response body find | ≤ 100 ms for 1 MB text |

---

## 7. Performance budgets by roadmap phase

| Phase | Must meet before exit |
| --- | --- |
| 1 | Request Editor open + Response ≤256KB targets; progress visible <100 ms |
| 2–3 | Manager open ≤300 ms; settings write not on every keystroke (debounce save) |
| 4 | History panel open ≤200 ms for 1k entries |
| 5 | OpenAPI 100-op target; Postman import similar order |
| 6 | Multipart build must not freeze UI; file read progress for large binaries |
| 8 | Collections search ≤100 ms for 2k nodes |

---

## 8. Measurement methods

| Method | Use |
| --- | --- |
| `performance.now` in extension host logs (debug) | Activate, discovery, sync |
| Unit benches for pure parse/serialize | Parser, request-source |
| Manual EDH stopwatch | Webview paint feel |
| Fixture workspaces | `perf/small` (≤50), `perf/medium` (≤500), `perf/large` (≤2000) under test fixtures |

Document results in phase exit notes / CHANGELOG “Performance” subsection when materially improved.

---

## 9. Regression policy

| Severity | Trigger | Action |
| --- | --- | --- |
| **Blocker** | p95 exceeds **Max acceptable** for a phase-owned metric | Fail phase exit |
| **Warning** | p95 exceeds **Target** but under Max | File tech-debt; may ship with note |
| **Watch** | Stretch missed | Optional optimization backlog |

No silent regressions: if a PR worsens a measured path by >20% vs previous release baseline, require justification in the PR description.

---

## 10. Degradation behavior

When over budget:

1. Show progress (never silent multi-second stalls).  
2. Prefer cancel over freeze.  
3. Degrade Pretty JSON → Raw for huge payloads.  
4. Keep Collections interactive (don’t block tree on one huge parse — isolate errors).  
5. Truncate display with “Show more” rather than locking the UI thread.

---

## 11. Non-goals

- Competing with native curl microbenchmarks for HTTP itself  
- Guaranteeing performance on 100k-request monorepos without pagination/virtualization follow-ups  
- Pixel-perfect FPS animations  

---

## Related documents

- [`roadmap.md`](./roadmap.md)  
- [`technical-constraints.md`](./technical-constraints.md)  
- [`product-experience.md`](./product-experience.md)  
- [`north-star.md`](./north-star.md)  
