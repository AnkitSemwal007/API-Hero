# API Hero — Product Experience

**Version:** 1.2 (Final Polish)  
**Role:** The experiential north star for every UX decision.  
**Audience:** Product, design, engineering  
**Related:** [`design-principles.md`](./design-principles.md) · [`north-star.md`](./north-star.md) · [`interaction-model.md`](./interaction-model.md)

If a proposed UI conflicts with this document, change the UI — not these feelings.

---

## How API Hero should feel

| Feeling | Meaning in practice |
| --- | --- |
| **Fast** | Actions complete before the user wonders whether anything happened. Trees, editors, and responses stay snappy under normal workspaces. |
| **Native** | Feels like a built-in VS Code feature: Tree Views, editors, Settings, Problems, Progress — not a foreign web app bolted on. |
| **Minimal** | Only the chrome needed for the current job. No dashboard wallpaper, no decorative cards, no Activity Bar sprawl. |
| **Git-first** | Saving work means files on disk. Collaboration means commits and PRs. Cloud sync is never required to feel “done.” |
| **Professional** | Calm, precise, trustworthy. Status codes, errors, and secrets are handled with seriousness — no playful clutter. |
| **Zero friction** | Create → edit → run → inspect in the fewest clicks. No obligatory wizards for everyday tasks. |
| **Predictable** | The same verb always does the same thing. Session vs persisted state never surprises. Incomplete features are honest, not faked. |
| **Visual first** | Common tasks happen in forms, tables, and trees. The `.api` text is always available, rarely required. |
| **Never surprising** | Side effects are visible: what will be written, what will be deleted, what is session-only vs saved. |
| **Never block unnecessarily** | Do not interrupt Run, Open, Refresh, or Reveal with dialogs. Confirm only when destructive or irreversible. |

---

## Emotional arc of a good session

```text
Open workspace
  → Confidence (“my collections are here”)
  → Flow (edit visually, run, inspect)
  → Trust (env/auth did what I expect; secrets stayed secret)
  → Closure (files dirty/clean in SCM; history recorded)
```

Bad sessions feel like: hunting Settings JSON, wondering which editor is “real,” pasting tokens into files, or waiting on unexplained progress.

---

## Experience pillars (decision tests)

Before shipping any surface, ask:

1. **Would a Thunder Client user feel at home in under a minute?**  
2. **Would a Bruno user trust that Git still owns the truth?**  
3. **Would a REST Client power user still reach the raw `.api` without fighting the UI?**  
4. **Does this use a VS Code-native pattern first?** ([`interaction-model.md`](./interaction-model.md))  
5. **Does this stay within performance budgets?** ([`performance-goals.md`](./performance-goals.md))  
6. **Does the Activity Bar stay Collections + History only?** ([`information-architecture.md`](./information-architecture.md))

If any answer is no, revise the design.

---

## Feature decision tree

When proposing a new capability, choose the surface in this order:

```text
1. Can it be a command + QuickPick / InputBox?
   → Prefer that (zero new chrome).
2. Does it edit a single .api document?
   → Request Editor tab / section (or Text).
3. Is it temporal / organizational browsing?
   → Collections or History tree only.
4. Is it multi-field CRUD over settings?
   → Command-opened **panel** (Env / Auth managers).
5. Is it orientation / marketing / rare?
   → Walkthrough, Overview **command**, or README — never a third Activity Bar view.
```

**Reject by default:** new permanent Activity Bar views, mini-SPA shells, dual storage models, fake Login.

---

## Tone of voice (UI copy)

| Do | Don't |
| --- | --- |
| Short, imperative: “Create collection”, “Run request” | Marketing fluff: “Unleash your API superpowers” |
| Specific errors: “Secret missing for profile `prod`” | Vague: “Something went wrong” |
| Honest limits: “Multipart bodies are not supported yet” | Fake UI that implies cookies/OAuth work |
| “Coming soon” only outside the product palette | Stub commands that look runnable |

Brand name in titles: **API Hero**. Runtime ids remain `apiRunner.*`.

### Copy patterns

| Situation | Pattern |
| --- | --- |
| Empty state | Problem + one next action (“No collections yet. Create one to start.”) |
| Confirm delete | Name the object + consequence |
| Progress | Verb + object (“Importing OpenAPI…”) |
| Partial success | Counts + what to do next |
| Unsupported | Hide control or disable with tooltip stating the limit |

---

## Density & calm

- Prefer **one primary action** per toolbar region.  
- Prefer **inline tables** over nested modal stacks.  
- Prefer **panels beside the editor** for response/history detail — not center-modals for rich content.  
- Prefer **status bar chips** for ambient env/auth identity — not permanent sidebar views.  
- Match workbench density; do not invent a spacious marketing layout inside webviews.

Visual rules: [`design-system.md`](./design-system.md).

---

## Modes of failure (how it should feel)

| Failure | Felt experience |
| --- | --- |
| Network / HTTP error | Response panel shows clear status; history still records; no crash |
| Missing secret | Actionable CTA (“Set secret for profile…”) — never a stack trace |
| Parse error | Problems + keep user text; form does not clobber |
| Import failure | No partial collection on disk; one error message |
| Slow workspace | Progress appears; cancel available; UI remains responsive |

Silence without progress is a defect. Panic without recovery is a defect.

---

## Trust & safety (felt, not just implemented)

Users should *feel* safe because:

- Secrets never appear in webviews, history bodies, or screenshots guidance.  
- Deletes ask once, clearly naming the object.  
- Form edits show up as normal dirty editors on `.api` files.  
- Collection runs do not spam response panels.  
- Unsupported features are hidden or labeled — never half-drawn as working.

Constraints: [`technical-constraints.md`](./technical-constraints.md).

---

## Motion & feedback

| Moment | Feeling |
| --- | --- |
| Click Run | Immediate progress; status bar updates |
| Response arrives | Panel focuses content, not chrome |
| Tree mutates | Node appears/updates without full flicker when possible |
| Error | Clear, actionable, dismissible — Output for depth |
| Success (single run) | Quiet if Response is open; no toast spam |

Budgets: [`performance-goals.md`](./performance-goals.md).  
Interaction rules: [`interaction-model.md`](./interaction-model.md) §§ Loading, Notifications, Confirmation.

---

## Competitive feel (what we borrow / reject)

| From | Borrow | Reject |
| --- | --- | --- |
| Thunder Client | IDE presence, quick run loop | Opaque storage as the primary story |
| Bruno | Git honesty, file collections | Standalone app chrome |
| Postman | Completeness of request builder | Cloud-first, heavy marketing UI |
| REST Client | Text always available | Text-only as the only UX |

---

## Anti-experiences (explicitly reject)

- Turning API Hero into a mini Postman SPA inside one webview  
- Crowding the Activity Bar with Environments, Auth, Variables, Dashboard views  
- Requiring account login for core HTTP workflows  
- Dual sources of truth (UI model vs file) that can diverge  
- Cute empty states that bury the next action  
- Confirming Run, Open, Refresh, or Reveal  

---

## Mapping feelings → documents

| Feeling | Governing docs |
| --- | --- |
| Fast | `performance-goals.md` |
| Native / Minimal | `design-system.md`, `information-architecture.md` |
| Git-first | `vision.md`, `technical-constraints.md` |
| Visual first / Zero friction | `north-star.md`, `user-flows.md` |
| Predictable / Never surprising | `interaction-model.md`, `design-principles.md` |
| Professional | `ux-review.md`, Marketplace copy in `marketplace-strategy.md` |

---

## Change control

Updates to this document require product + design agreement. Engineering may challenge feasibility via [`technical-constraints.md`](./technical-constraints.md) and [`performance-goals.md`](./performance-goals.md), but may not silently weaken the intended feel.
