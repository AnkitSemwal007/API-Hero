# API Hero — North Star

**Role:** Long-term product intent. For what ships **today** (v2.3.4), see [product/README.md](./README.md) and the [user guide](../user/getting-started.md). For sequencing, see [roadmap.md](./roadmap.md).

## One-paragraph North Star

You install API Hero, open your repo, and use **Collections**, **Execution**, and **History** in the Activity Bar. You create folders and requests visually, edit them in the **Request Editor**, pick an environment and auth profile from managers (panels — not extra sidebar views), press Run, and inspect a rich **Response** panel. Collection runs are monitored from **Execution**; per-request history stays in **History**. Everything you save is a normal `.api` file. Teammates review it in Git. Settings JSON and the raw DSL remain available, but everyday work stays UI-first.

## Already true in v2.3.4

- UI-first Request Editor (default for `.api`; Dependencies + Extract) and Response Viewer (copy / save / search / extraction report)
- `@extract` / `@sensitive-extract` with Extraction Engine and Request Editor Extract tab
- Intelligent dependency autofill projections (Auto / Manual / Unknown / Ambiguous) sharing the Collection Runner graph
- Environment Manager + Auth Manager + Overview + History Detail + Collection Run Report / Debugger Details
- Activity Bar **Execution** view (Execution Center) for live collection runs
- Git-friendly collections and OpenAPI import wizard
- Secret Storage for auth credentials; masked presentation in history/responses
- Marketplace listing media on Cloudinary CDN; lean VSIX (extension chrome icons only)

## Still aspirational (not claimed as shipped)

- First-run Walkthrough contribution
- Run File (all requests in one editor)
- OAuth / richer auth providers
- Cookie jar
- Sample collections published as templates

Do not treat this file as a feature checklist for the current release.
