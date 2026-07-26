# ADR 0002 — Human-Readable Dependencies (Supersedes Authored IDs)

**Status:** Accepted (supersedes prior Hybrid Option A / opaque `req_*` decision in this file)  
**Date:** 2026-07-26  
**Related:** ADR 0001 §8

---

## Context

An earlier draft of this ADR proposed authored `@id req_*` tokens in `@depends-on` for rename safety. That conflicted with API Hero’s north star: **Git-friendly, human-readable `.api` files** that do not expose internal implementation details in code review.

Runtime already uses discovery IDs (`request:<path>#<index>`) as plan keys after enrich. The remaining product needs are rename safety and natural folder-organized duplicate display names — without opaque tokens on disk.

## Decision

**Option C (refined): human-readable depend refs + runtime-only IDs + rename cascade.**

| Layer | Form | Role |
| --- | --- | --- |
| Display `@name` | Free text (e.g. `Login`) | Editable label; duplicates allowed **across folders** |
| Depend ref | `Login` or `Authentication/Login` | Persisted in `@depends-on`; Git-reviewable |
| Discovery id | `request:<path>#<index>` | Plan / graph / execution only; **never** in `@depends-on` |

### Forbidden

- Persisting `req_*` or `request:…#…` in `@depends-on` or as a required `@id` for dependency identity.
- Guessing when a bare name matches multiple requests.

### Depend-ref grammar

- **Bare** `Login` — resolves when exactly one request in the collection has that `@name`.
- **Qualified** `Authentication/Login` — `folder.relativePath` + `/` + `@name`.
- **Root-qualified** `./Login` — distinguishes a root request from same-named folder requests.
- **Same-folder duplicate `@name`** — disallowed / fail-closed (no human disambiguator without opaque ids).
- **`/` in `@name`** — validation error (collides with qualification).

### Ambiguity

Bare name with multiple matches → diagnostic + Quick Fix offering qualified candidates (`Authentication/Login`, …). Fix rewrites the token on disk.

### Rename

Request Editor rename/move cascades like VS Code Rename Symbol: rewrite bare and qualified refs that targeted that request (collection-scoped).

### Runtime

Resolve depend refs → discovery IDs **once** at plan enrich. Execution uses ID edges only.

## Consequences

### Positive

- Readable diffs and natural folder naming (`Login` under Authentication / Admin).
- Rename safety without opaque ids.
- Aligns UI-first + Git-friendly product principles.

### Negative / trade-offs

- Slightly richer token grammar and cascade logic than globally unique names.
- Non-IDE renames still need diagnostics / optional fix command.

### Migration from premature authored-id work

- Stop emitting `@id` / migrating `@depends-on` to `req_*`.
- Reverse-migrate `req_*` tokens to names when uniquely resolvable; otherwise diagnostic.
- Remove authored-id dual-resolve as the preferred path.

## Supersession note

Any earlier “Accepted” Hybrid Option A content in this ADR is **void**. Opaque authored dependency ids are not the product direction.
