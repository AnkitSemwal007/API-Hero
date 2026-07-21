# API Hero — UX Review

**Version:** 1.2 (Final Polish)  
**Scope:** Professional review of the **current** product experience (0.5.x).  
**Method:** Evaluate only — redesigns live in [`gap-analysis.md`](./gap-analysis.md) / [`roadmap.md`](./roadmap.md).  
**Primary evidence:** `docs/ux/api-hero-ui-inventory.md`, architecture docs, contributed commands/views.  
**Target experience:** [`product-experience.md`](./product-experience.md) · [`north-star.md`](./north-star.md)

**Scale:** Excellent · Good · Fair · Poor · Missing

---

## Executive verdict

API Hero already has a **credible VS Code-native spine**: Collections tree with real CRUD/DnD, a working Request Editor with two-way `.api` sync, a solid run pipeline, assertions, history, and OpenAPI import. The product is **not yet UI-first end-to-end**. The largest UX risks are **inconsistent editor defaults**, **settings-JSON dependency for env/auth**, and **response/history tool gaps** that break expectations set by Thunder Client / Postman users.

Overall UX maturity: **Fair → Good** on engine-backed workflows; **Fair** on discoverable visual management; **Poor** on guided secrets/onboarding polish.

---

## 1. Navigation — Good

**Strengths**

- Single Activity Bar entry (`API Hero`) avoids workbench clutter.  
- **Exactly two views** (Collections + History) matches VS Code density — preserve this.  
- Collections ↔ Reveal Active Request ↔ History Reveal form a coherent loop.  
- Tree hierarchy matches filesystem mental model (`Collections/<Name>/`).

**Weaknesses**

- Env/auth require Settings JSON today (managers should be **panels**, not new sidebar views).  
- Reserved explorer id unused — not harmful.  
- Multi-root descriptions help; orientation without a permanent Dashboard is correct — use welcome + walkthrough + Overview command instead.

**Gap refs:** G04, G05, G21  
**IA law:** [`information-architecture.md`](./information-architecture.md)

---

## 2. Discoverability — Fair

**Strengths**

- Welcome views for empty Collections/History with useful CTAs.  
- CodeLens Run / Run Tests appear in-document.  
- Context menus on tree nodes are comprehensive for native collections.

**Weaknesses**

- Coming Soon commands pollute Command Palette (Run File, Login, Logout).  
- Request Editor not obvious as default; Open Request Editor is palette-only for many paths.  
- Auth/env capabilities exist but are hard to stumble into visually.  
- Failure policy QuickPick is easy to dismiss without understanding.

**Gap refs:** G01, G08, G10, G11

---

## 3. Workflow efficiency — Fair

**Strengths**

- Run shortcut `Ctrl/Cmd+Alt+R` is fast for text users.  
- DnD reorder/move reduces dialog chaining.  
- Collection/folder/selected runs reuse one pipeline.  
- OpenAPI import is a relatively short path to a full tree.

**Weaknesses**

- Create request → text editor → optionally reopen form adds clicks.  
- Env/auth changes may not persist → repeated switching.  
- Response lacks copy/save → users reselect manually or re-run.  
- History open is a modal, not actionable workspace.

**Gap refs:** G01, G02, G06, G07

---

## 4. Consistency — Fair

**Strengths**

- Run always hits the orchestrator (CodeLens, tree, form).  
- Native CRUD verbs align across toolbar and context menus.  
- Sensitive masking appears in multiple surfaces.

**Weaknesses**

- Legacy vs native: same icons, different powers — inconsistent capability.  
- Session vs settings semantics differ between features without labeling.  
- Create opens text; tree open opens form — inconsistent “source of editing.”

**Gap refs:** G01, G02, G03, G09

---

## 5. Learnability — Fair

**Strengths**

- `.api` samples and snippets help text learners.  
- Form tabs map cleanly to HTTP concepts (Params, Headers, Body, Auth, Tests).  
- Assertions as `expect` lines are teachable and visible in Tests tab.

**Weaknesses**

- Beginners still encounter Settings JSON early for env/auth.  
- No walkthrough; README is external.  
- Multi-request banner is correct but abrupt without teaching “one request per file” recommendation.

**Gap refs:** G04, G05, G21

---

## 6. Visual hierarchy — Good (within constraints)

**Strengths**

- Response hero + stats grid establish clear scanning order.  
- Tree labels (method + URL description) support scanning.  
- ThemeIcon usage fits VS Code chrome.

**Weaknesses**

- Response is a long single scroll rather than segmented tabs — acceptable but dense.  
- No persistent status bar env/auth identity.  
- Managers absent → hierarchy stops at trees + editors.

**Gap refs:** G07 tools, status bar env (roadmap Phase 1–2)

---

## 7. Empty states — Good

**Strengths**

- Collections welcome: Create / Import / OpenAPI / Open Workspace.  
- History welcome: Refresh / Focus Collections.  
- Copy is concise and actionable.

**Weaknesses**

- No empty state inside Request Editor tabs (e.g. no headers yet).  
- No “no environments yet” guided empty (because no manager).

**Gap refs:** G04, G21

---

## 8. Feedback — Good

**Strengths**

- Progress for runs and OpenAPI.  
- Status bar transient run states.  
- Assertion Problems after run.  
- Mutation/import notifications with severity.

**Weaknesses**

- Successful single runs may feel quiet if user misses the panel.  
- Collection summary is notification-centric vs dedicated report.  
- Stub “Coming Soon” feels like false feedback.

**Gap refs:** G08, Phase 4 report

---

## 9. Error handling — Good

**Strengths**

- Orchestration failures surface messages.  
- OpenAPI failures avoid partial writes.  
- Auth/variable diagnostics in Problems.  
- Unsupported body returns explicit `UNSUPPORTED_BODY`.

**Weaknesses**

- Missing secret setup lacks a one-click remediation UI.  
- Legacy action warnings exist but education is thin.  
- Form sync edge cases (stale edits) are engineer-correct but under-explained.

**Gap refs:** G05, G16

---

## 10. Onboarding — Poor → Fair

**Strengths**

- Welcome CTAs cover create/import.  
- Placeholder request (httpbin) gives an immediate run target after create.

**Weaknesses**

- No interactive walkthrough.  
- First-run editor surface is wrong for UI-first claim.  
- Secrets after OpenAPI are “hints,” not a guided completion path.  
- Marketplace screenshots missing — external discoverability suffers.

**Gap refs:** G01, G05, G21, G22

---

## 11. Keyboard support — Fair

**Strengths**

- Primary Run keybinding.  
- Tree and palette accessibility inherit VS Code.

**Weaknesses**

- Few product-specific shortcuts (env/auth).  
- Request Editor keyboard coverage depends on webview tab order quality.  
- No documented shortcut cheatsheet in-product.

**Gap refs:** interaction-model planned shortcuts

---

## 12. Accessibility — Fair (assumed / partial evidence)

**Strengths**

- Native TreeView/menus get VS Code a11y baseline.  
- CSP-locked webviews reduce drive-by script risk.  
- Secrets not injected into webviews.

**Weaknesses**

- Custom webviews (Request Editor, Response, New Request) need ongoing audit for focus order, ARIA, contrast.  
- History modal is a poor SR experience vs a proper panel.  
- No documented a11y test pass in repo.

**Gap refs:** G06; interaction-model § Accessibility

---

## Scorecard

| Dimension | Rating |
| --- | --- |
| Navigation | Good |
| Discoverability | Fair |
| Workflow efficiency | Fair |
| Consistency | Fair |
| Learnability | Fair |
| Visual hierarchy | Good |
| Empty states | Good |
| Feedback | Good |
| Error handling | Good |
| Onboarding | Poor–Fair |
| Keyboard support | Fair |
| Accessibility | Fair |

---

## Top 5 UX issues (priority order)

1. **Inconsistent default editor** after create vs tree open (blocks UI-first promise).  
2. **Env/auth management buried in Settings** with session/settings split.  
3. **Response missing copy/save/search** (basic client expectations).  
4. **History detail modal** underpowers a primary Activity Bar view.  
5. **Palette stubs + missing walkthrough** hurt trust and first-run success.

---

## What not to change casually

Per review-only scope — these are strengths to preserve while closing gaps:

- Two-way Request Editor sync with `.api` canonical  
- Collections as real folders + marker ordering  
- Single orchestrator for all run entry points  
- SecretStorage boundary and history metadata-only policy  
- Stable `apiRunner.*` contribution IDs  

---

## Related documents

- [`gap-analysis.md`](./gap-analysis.md)  
- [`product-experience.md`](./product-experience.md)  
- [`design-principles.md`](./design-principles.md)  
- [`interaction-model.md`](./interaction-model.md)  
- [`north-star.md`](./north-star.md)  
- [`../ux/api-hero-ui-inventory.md`](../ux/api-hero-ui-inventory.md)  
