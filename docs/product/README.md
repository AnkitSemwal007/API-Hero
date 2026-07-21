# API Hero — Product Specification

**Status:** Final polish complete (**v1.2**) — guides development from **0.5 → 1.0** without another product redesign.  
**Code:** Do not treat these docs as implemented features. Implementation follows [`roadmap.md`](./roadmap.md).

---

## How to use this folder

| If you need… | Start here |
| --- | --- |
| Ideal v1.0 experience | [`north-star.md`](./north-star.md) |
| How the product should *feel* | [`product-experience.md`](./product-experience.md) |
| Why we exist / competitors | [`vision.md`](./vision.md) |
| What to build when | [`roadmap.md`](./roadmap.md) |
| What exists vs planned | [`feature-matrix.md`](./feature-matrix.md) |
| What’s missing today | [`gap-analysis.md`](./gap-analysis.md) |
| Navigation rules | [`information-architecture.md`](./information-architecture.md) |
| Screen catalog | [`screen-list.md`](./screen-list.md) |
| Workflows | [`user-flows.md`](./user-flows.md) |
| Clicks / keyboard / dialogs | [`interaction-model.md`](./interaction-model.md) |
| UX principles | [`design-principles.md`](./design-principles.md) |
| Visual tokens | [`design-system.md`](./design-system.md) |
| Component contracts | [`component-library.md`](./component-library.md) |
| Design inventory (lighter) | [`ui-components.md`](./ui-components.md) |
| Latency / memory budgets | [`performance-goals.md`](./performance-goals.md) |
| Hard technical limits | [`technical-constraints.md`](./technical-constraints.md) |
| Marketplace / release story | [`marketplace-strategy.md`](./marketplace-strategy.md) |
| Current UX scorecard | [`ux-review.md`](./ux-review.md) |

As-built inventory (engineering): [`../ux/api-hero-ui-inventory.md`](../ux/api-hero-ui-inventory.md).

---

## Non-negotiables (read first)

1. **`.api` is canonical** — UI serializes into grammar; no parallel schema.  
2. **Activity Bar = Collections + History only** — managers are editors/panels/dialogs.  
3. **Reuse the engine** — parser, orchestrator, auth, variables, assertions, executor.  
4. **Stable ids** — `apiRunner.*`, language `api` ([`../release/stable-identifiers.md`](../release/stable-identifiers.md)).  
5. **Secrets never in webviews** — SecretStorage only.  
6. **Native VS Code** — tokens, TreeView, Custom Editor, Settings.

---

## Document map

```text
docs/product/
├── README.md                 ← you are here
├── north-star.md             ← v1.0 destination experience
├── product-experience.md     ← experiential principles
├── vision.md
├── design-principles.md
├── design-system.md
├── interaction-model.md
├── information-architecture.md
├── screen-list.md
├── user-flows.md
├── component-library.md      ← canonical components
├── ui-components.md          ← design inventory
├── feature-matrix.md
├── gap-analysis.md
├── roadmap.md
├── performance-goals.md
├── technical-constraints.md
├── marketplace-strategy.md
└── ux-review.md
```

---

## Glossary

| Term | Meaning |
| --- | --- |
| **`.api`** | Canonical request document language / file |
| **Request Editor** | Custom Text Editor form UI for single-request files |
| **Native collection** | Folder under `Collections/<Name>/` with optional marker |
| **Legacy collection** | Synthetic group of `.api` files outside native layout |
| **Manager** | Command-opened **panel** for Env/Auth/Import — never Activity Bar |
| **Orchestrator** | Single execution pipeline for all Run entry points |
| **IA law** | Activity Bar hosts only Collections + History |
| **G-id** | Gap id in `gap-analysis.md` |
| **S-id** | Screen id in `screen-list.md` |

---

## Consistency rules (for editors of this spec)

When changing a screen, update: `screen-list` → `component-library` → `user-flows` → `roadmap` phase Screens row → `feature-matrix` / `gap-analysis` as needed.  
When changing IA, update: `information-architecture`, `north-star`, `product-experience`, `ux-review`, and any “Dashboard as Activity Bar” language.  
When changing a phase, update exit criteria and linked G-ids.  
When changing a component, update `component-library` first, then `ui-components` inventory, then screen map.

### Consistency validation matrix

| Rule | Enforced by |
| --- | --- |
| Every screen references reusable components | `screen-list` master index ↔ `component-library` map |
| Every workflow references existing screens | `user-flows` ↔ `screen-list` S-ids |
| Every component exists in the library | `component-library` is canonical; `ui-components` points here |
| Every roadmap phase lists affected screens | `roadmap` Screens / Phase summary |
| Every UX rule references interaction model | `design-principles` / `product-experience` → `interaction-model` |
| Every feature references the roadmap | `feature-matrix` Phase index ↔ `gap-analysis` Gap→phase |
| Env/Auth are panels not views | IA law repeated in vision, north-star, roadmap, gaps |

---

## Spec completeness checklist (Phase 0 exit)

- [x] Vision, North Star, Product Experience  
- [x] IA: Collections + History only  
- [x] Screen list S01–S34 with components + phases  
- [x] Component library contracts  
- [x] Design system (VS Code tokens)  
- [x] Interaction model + design principles  
- [x] User flows including managers / Import Hub / Overview  
- [x] Feature matrix + gap analysis with phase map  
- [x] Roadmap phases 0–10 with full template fields  
- [x] Performance goals + technical constraints  
- [x] Marketplace strategy + v1.0 gate  
- [x] UX review of current 0.5.x  

---

## Versioning

| Spec version | Meaning |
| --- | --- |
| 1.0 | Product Definition Sprint (initial) |
| 1.1 | Final polish — experience/design/marketplace docs; simplified IA; full roadmap template |
| 1.2 | Final polish review — consistency matrix, complete screen↔component map, gap→phase index, deepened experience/system docs |
