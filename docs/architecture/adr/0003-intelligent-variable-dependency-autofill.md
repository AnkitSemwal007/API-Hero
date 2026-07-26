# ADR 0003 — Intelligent Variable & Dependency Autofill (Architecture Lock)

**Status:** Accepted  
**Date:** 2026-07-26  
**Related:** ADR 0001 §8, ADR 0002, P2 dependency graph (`graph-builder`, `plan-enricher`)

---

## Context

Auto producer→consumer edges already exist inside collection-run enrich (`buildDependencyGraph` implicit edges) but are invisible in the Request Editor. The product needs IDE-quality autofill (Auto vs Manual, ambiguity, unknown-variable remediation, pin) **without** a second dependency algorithm or persisting inferred edges into Git-friendly `.api` files.

## Decision

Intelligent Variable & Dependency Autofill is an **editor projection** over the **existing** dependency engine. The Collection Runner remains the execution path; the editor never owns graph logic.

### Approved product decisions (Q1–Q6)

| ID | Decision |
| --- | --- |
| Q1 | **Option A** — Runtime unchanged (every in-plan producer → consumer; last-write-wins). Editor may pin a producer. Never silently change runner semantics. |
| Q2 | Producers are **only** `@extract` / `@sensitive-extract`. Env, workspace, collection, global, and default variables **do not** create dependency edges. |
| Q3 | Unknown-variable suppression is **workspace-level** (or until next edit) — not session-only. |
| Q4 | Users may convert **Auto → Manual** (pin). Manual serializes as `@depends-on`. |
| Q5 | Editor indexes the **whole collection**. Runner resolves only the **active execution plan**. Same engine; different analysis set. |
| Q6 | Variable / depend-ref rename scope remains **collection-only**. |

### Fixed-point inference

**Rejected.** `buildDependencyGraph` already emits every **direct** producer→consumer edge in one pass. Topo sort supplies transitive order (A→B→C→D). Do **not** implement repeat-until-stable edge discovery.

---

## Implementation Rules (normative)

### RULE 1 — One dependency engine

There must be exactly **one** dependency engine:

```
Editor  →  buildDependencyGraph  →  Runner
```

The editor is a **projection** of the graph. It is **not** another graph builder.

Never duplicate:

- producer detection
- consumer detection
- edge inference
- cycle detection
- topological ordering

### RULE 2 — Graph is source of truth

The editor asks the dependency engine:

> What does this request depend on?

not:

> How do I compute dependencies?

### RULE 3 — No Auto persistence

Only serialize `@depends-on` (Manual).

Never serialize inferred dependencies. Never write Auto edges into `.api` files.

### RULE 4 — Manual + Auto

```
Manual edges
  +
Auto edges
  → Merged graph
  → Cycle detection
  → Topo
  → Execution
```

Do not create separate execution paths.

### RULE 5 — No fixed-point loop

Do not implement iterative dependency inference. Graph builder discovers every direct edge; topo handles transitive ordering.

### RULE 6 — Projection only

The editor exposes:

- Auto Dependencies
- Manual Dependencies
- Unknown Variables
- Ambiguous Producers

These are **projections of existing analysis**, not new domain models / parallel graphs.

### RULE 7 — Facade

`VariableDependencyFacade` (or equivalent name) must be **thin**:

- collect analyses (reuse `produces-consumes` / plan analyze patterns)
- map to view models
- cache UI projections
- expose diagnostics

It must **never** own graph logic (no custom edge inference, cycles, or topo).

### RULE 8 — Pinning

Pin Auto → Manual must:

1. Write `@depends-on` (human refs per ADR 0002)
2. Trigger a normal refresh

It must **not** alter runtime semantics.

### RULE 9 — Performance

Reuse discovery snapshot, existing analyses, fingerprints, dirty-document tracking.

Never perform repeated full-collection scans while typing.

### RULE 10 — Tests

Regression tests must prove:

- Editor projection == Runner graph (same analyses ⇒ same edges)
- Auto edges never serialize
- Manual edges serialize
- Pin Auto → Manual preserves execution
- Multiple producers preserve runtime semantics (Q1 A)
- Unknown variables never create edges
- Static scopes never create edges
- Rename keeps projection correct
- `buildDependencyGraph` remains the single source of truth

---

## Module placement

| Concern | Location |
| --- | --- |
| Produces / consumes / graph / cycles / topo / enrich | `src/dependencies/**` (framework-free) — **reuse, do not fork** |
| Thin facade + view-model mapping | `src/dependencies/**` helpers + optional cache |
| Request Editor Auto/Manual UI, pin | `src/request-editor/vscode/**` |
| Runner | Existing `enrichRunPlanWithDependencies` only; no parallel execute path |
| Persist Manual | `request-source` serialize `@depends-on` only |

## Success criterion (merge gate)

A future maintainer must be able to **delete the entire editor projection layer** without changing a **single line** of the Collection Runner.

Improvements to `buildDependencyGraph` must **automatically** benefit both the editor and the runner.

If either statement is false, the architecture has drifted and must be corrected before merge.

## Forbidden

- A second producer/consumer scanner or edge builder for the editor
- Persisting Auto / inferred edges
- Fixed-point / repeat-until-stable inference loops
- Changing multi-producer runtime behavior when shipping pin UX
- Owning cycle detection or topo inside the facade or webview

## Consequences

- Autofill ships as authoring intelligence with zero runner fork
- Git diffs stay clean (Manual `@depends-on` only)
- Editor (whole collection) may show Auto edges that a folder/subset run omits — document at the UI boundary; do not fork the engine to hide that
