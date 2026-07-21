# API Hero — Marketplace Strategy

**Version:** 1.2 (Final Polish)  
**Extension ID:** `ankitsemwal.api-hero`  
**Related:** [`vision.md`](./vision.md) · [`north-star.md`](./north-star.md) · [`roadmap.md`](./roadmap.md) Phase 5 · `docs/release/*`

---

## 1. Positioning

**Category:** API clients / REST tools for VS Code  

**Positioning statement**

> API Hero is the UI-first HTTP client for VS Code that keeps every request as a plain `.api` file — so you get a modern visual workflow without leaving Git.

**Not positioned as:** Postman cloud replacement, AI agent, or multi-protocol lab.

**Subtitle candidates**

1. `UI-first HTTP client for VS Code`  
2. `REST client with Git-friendly .api files`  
3. `Collections, assertions, and OpenAPI — as code`

---

## 2. Value proposition

| Promise | Proof in product |
| --- | --- |
| Visual request building | Request Editor tabs |
| Git-native collections | `Collections/` + `.api` diffs |
| Run + assert in IDE | Orchestrator + `expect` + Problems |
| Import real specs | OpenAPI 3.x (Postman on roadmap) |
| Secrets done right | VS Code Secret Storage |

**Primary CTA:** Install → open folder → Create Collection → New Request → Run  

**Secondary CTA:** Import OpenAPI → review generated `.api` files in Git  

---

## 3. Target audience (Marketplace)

1. VS Code users searching “postman”, “rest client”, “thunder client”, “http client”  
2. Developers who want Bruno-like Git honesty inside the editor  
3. Teams importing OpenAPI into reviewable files  
4. QA engineers who want assertions beside application code  

**Non-audience (do not optimize listing for):** desktop-only Postman power users who refuse IDEs; GraphQL-first teams (until deferred protocols ship).

---

## 4. Feature comparison (listing table)

Use a short, honest table in README (keep updated with [`feature-matrix.md`](./feature-matrix.md)):

| Capability | API Hero | REST Client | Thunder Client | Bruno |
| --- | --- | --- | --- | --- |
| Inside VS Code | Yes | Yes | Yes | No (app) |
| Visual request UI | Yes | Limited | Yes | Yes (app) |
| Files as source of truth | `.api` | `.http` | Varies | Yes |
| Collections tree + DnD | Yes | No | Yes | Yes |
| Assertions in-file | `expect` | Scripts/limited | Yes | Yes |
| OpenAPI import | Yes | Limited | Yes | Yes |

Never claim OAuth/GraphQL/Postman import until shipped. Prefer under-claim and over-deliver.

---

## 5. README strategy

| Section | Guidance |
| --- | --- |
| Hero line | One sentence value prop |
| Screenshots | 4–6 immediately under hero |
| Quick start | ≤ 8 lines to first 200 |
| Features | Bullets matching Marketplace Q&A |
| Comparison | Short table; link competitors fairly |
| Roadmap | Short; link to `docs/product/roadmap.md` for depth |
| Stable IDs note | `apiRunner.*` compatibility |
| Support | Link SUPPORT.md |

Tone: [`product-experience.md`](./product-experience.md) — professional, minimal, no hype.

---

## 6. Screenshots (required set)

| # | Shot | Shows | Phase ready |
| --- | --- | --- | --- |
| 1 | Collections + Request Editor | UI-first editing | 1 |
| 2 | Response panel | Pretty JSON + status | 1 |
| 3 | Assertions / Problems | Testing story | now |
| 4 | History | Temporal workflow | 4 (detail panel preferred) |
| 5 | OpenAPI import result | Acquisition | now |
| 6 | Environments manager | Visual config | 2 |

**Specs:** Capture in EDH; light + dark pair preferred; avoid secrets in frame; crop to product chrome.  
Guidance: `docs/release/marketplace-assets.md`.

---

## 7. GIFs

| GIF | Loop story |
| --- | --- |
| Create → Run | New Request → edit URL → Run → response |
| DnD organize | Drag request between folders |
| Switch env | Env picker → re-run → different host |

Keep ≤ 8 seconds; no audio; 1× speed; readable cursor.

---

## 8. Videos (optional)

| Video | Length | Content |
| --- | --- | --- |
| 90-second overview | ≤ 2 min | Install → first run → collection |
| 5-minute deep dive | ≤ 6 min | Env, auth, OpenAPI, assertions |

Host on GitHub README link / YouTube; Marketplace description links out.

---

## 9. Release cadence

| Track | Cadence | Content |
| --- | --- | --- |
| **Patch** `0.x.y` | As needed | Fixes, perf, docs |
| **Minor** `0.x.0` | Per roadmap phase exit | User-visible features |
| **v1.0.0** | When North Star P0 complete | See exit gate below |

Prefer **quality over calendar**. Do not burn Marketplace review goodwill with broken minors.

---

## 10. Versioning

- SemVer on `package.json`  
- Pre-1.0: minor may include larger UX changes with CHANGELOG migration notes  
- Command/config IDs **do not** semver-break ([`../release/stable-identifiers.md`](../release/stable-identifiers.md))  
- Document UX behavior changes (e.g. env persistence) under **Migration** in CHANGELOG  

---

## 11. Changelog

| Rule | Detail |
| --- | --- |
| Audience | Users first, then developers |
| Structure | Added / Changed / Fixed / Deprecated / Migration |
| Honesty | Call out defaults that change |
| Link | Issues/PRs when useful |
| Performance | Note when budgets improve materially |

---

## 12. Demo workspace

Ship or link a **demo repo / folder** containing:

```text
Collections/Demo/
  api-hero.collection.json
  health/get-health.api
  users/…
.env.example  (no secrets)
README-demo.md
```

Used for screenshots, walkthrough, and “Open sample” docs. Keep runnable against httpbin or a tiny mock.

---

## 13. First-run experience (Marketplace → IDE)

1. Install from Marketplace  
2. Open folder (welcome nudges if empty)  
3. Collections welcome → Create Collection / Import OpenAPI  
4. New Request opens **Request Editor** (Phase 1)  
5. Run → Response  
6. Optional walkthrough (Phase 5) mirrors this path  

Details: [`north-star.md`](./north-star.md). Do not block activation on walkthrough.

---

## 14. Walkthrough

| Step | Command / reveal |
| --- | --- |
| Welcome | Open Collections |
| Create request | `createRequest` |
| Run | `runRequest` |
| Switch environment | `switchEnvironment` |
| Import OpenAPI | `importOpenApi` |

Contribute via `package.json` `walkthroughs` when Phase 5 ships.

---

## 15. SEO / Marketplace keywords

**Name:** API Hero  

**Keywords (description + Q&A):**  
`rest client`, `http client`, `api client`, `postman`, `thunder client`, `bruno`, `openapi`, `swagger`, `collections`, `assertions`, `vscode rest`, `.api`, `api testing`, `git friendly api`

Avoid trademark misuse in title; comparison belongs in body.

---

## 16. Marketplace Q&A (draft answers)

| Question | Answer direction |
| --- | --- |
| Is this like Postman? | Visual client inside VS Code; requests are `.api` files you commit |
| Where are collections stored? | `Collections/` folders in your workspace |
| Does it need an account? | No |
| How are secrets stored? | VS Code Secret Storage — never in webviews or Git |
| Can I edit raw files? | Yes — full `.api` text editor always available |
| OpenAPI? | Yes, OpenAPI 3.x import |

---

## 17. Privacy & trust (listing)

State clearly:

- No account required for core workflows  
- No cloud sync of collections by default  
- History is local metadata (no response bodies by default)  
- Telemetry: deferred / none unless later opted-in with disclosure  

---

## 18. Support channels

| Channel | Use |
| --- | --- |
| SUPPORT.md | How to file issues |
| GitHub Issues | Bugs / features |
| Output channel | Diagnostics for support |
| Marketplace Q&A | Short factual answers |

---

## 19. v1.0 Marketplace gate

Ready for **1.0.0** Marketplace push when:

- [ ] North Star P0 journeys work UI-first ([`north-star.md`](./north-star.md))  
- [ ] Screenshot set complete (light + dark)  
- [ ] Banner/icon final  
- [ ] README quick start verified on clean VS Code  
- [ ] No Coming Soon stubs in palette  
- [ ] Performance budgets for Phase 1–4 met ([`performance-goals.md`](./performance-goals.md))  
- [ ] SUPPORT.md + LICENSE present  
- [ ] Demo workspace linked or bundled  
- [ ] Changelog Migration notes for env persistence / editor defaults  

---

## Related documents

- [`north-star.md`](./north-star.md)  
- [`feature-matrix.md`](./feature-matrix.md)  
- [`product-experience.md`](./product-experience.md)  
- [`../release/marketplace-readiness.md`](../release/marketplace-readiness.md)  
- [`../release/marketplace-assets.md`](../release/marketplace-assets.md)  
