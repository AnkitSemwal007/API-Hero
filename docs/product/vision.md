# Vision

**API Hero** makes HTTP API work feel native to VS Code: requests are plain `.api` files, collections live in the workspace, and runs stay reviewable in History.

## Principles

1. **Text is canonical** — UI writes into the `.api` grammar; no parallel opaque schema.
2. **Small shell** — Activity Bar shows Collections and History only; managers open as panels.
3. **Secure by default** — secrets in Secret Storage; History and UI mask credentials.
4. **Stable IDs** — `apiRunner.*` for compatibility while the brand is API Hero.

## Audience

Developers and testers who already live in the editor and want a focused REST client without a separate Electron app.

## Non-goals (current product)

OAuth2 flows, cookie jars, GraphQL tooling, and marketplace “alternative to X” positioning are out of scope for the current line. See [roadmap.md](./roadmap.md).
