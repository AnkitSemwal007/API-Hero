# Response viewer

After a successful single-request run (or a completed execution result), API Hero shows a **Response** webview panel.

## What you see

- Status, timing, sizes, and content type
- Headers (sensitive values masked)
- Body preview with Pretty / Raw (and hex for binary previews)
- Assertion results when assertions ran
- **Extracted** tab when `@extract` / `@sensitive-extract` rules ran (masked values for sensitive extracts)

Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, etc.) are always masked. Large bodies are truncated for display; transport also enforces `apiHero.maxResponseBytes`.

## JSON body tree

Pretty JSON renders as a tree. Each node carries:

| Attribute | Meaning |
| --- | --- |
| `data-json-path` | Extract path (e.g. `body.access_token`, `body.items[0].id`) |
| `data-json-type` | `string` \| `number` \| `boolean` \| `null` \| `object` \| `array` |
| `data-json-value` | Primitive value (scalars only) — visible in the tree like any response viewer |
| `data-json-extractable` | `true` when the path uses the json-path identifier grammar (Extract Variable enabled) |

Body leaf scalars appear in the tree for inspection (including values that look secret). The **Extracted** tab still masks sensitive extract outcomes. Copy Value for extractable paths is resolved on the extension host from the last response; Extract Variable is disabled for property names outside the json-path grammar (spaces, punctuation, etc.), though Copy Value remains available.

### Context menu (right-click)

| Action | Behavior |
| --- | --- |
| Copy Value | Copies the scalar value |
| Copy JSON Path | Copies the extract path |
| Extract Variable… | Opens the confirmation sheet (scalars with extractable paths only) |
| Expand / Collapse | Object and array nodes |

### Save as Variable

When an extractable scalar leaf is selected, the body toolbar **Save as Variable** opens the same confirmation sheet.

### Extract Variable sheet

Confirm before writing (not one-click):

1. Variable name (default: sanitized leaf key)
2. Path (read-only, copyable)
3. Scope: Environment (default), Request, Collection, Workspace, or Run — **Global is not offered**
4. Sensitive checkbox (defaults on for names/paths matching token, secret, password, api_key, Authorization)
5. Value preview (masked when sensitive)
6. Overwrite warning when the name is already known
7. Confirm with **Save Extract Rule**

On confirm, API Hero:

1. Inserts `@extract` / `@sensitive-extract` into the active request’s `.api` source
2. Writes the current value to the chosen scope so it is immediately available
3. Shows a toast with an option to open Variables (Environment Manager)

## Copy, save, and search

| Action | Use |
| --- | --- |
| Copy body | Clipboard from Pretty or Raw mode |
| Save body | Save dialog with a suggested filename |
| Copy headers | Clipboard |
| Search | Find within the visible body |

These actions post messages to the extension host. Body Pretty/Raw and the JSON tree show response content for display (including leaf scalars). Sensitive **headers** and the **Extracted** tab remain masked; Copy Value for extractable paths is re-resolved on the host from the last execution result rather than trusting arbitrary webview plaintext.

## Possible causes (Failure Diagnostics)

When a run fails or returns a non-success HTTP status, the Response panel can show **Possible causes** alongside recorded facts (status, URL, elapsed time, timeout, transport error). Guidance is deterministic for common statuses (401 / 403 / 404 / 422 / 429 / 5xx) and for network / timeout failures — never speculation stated as fact. Secrets stay redacted. The same explanations appear in Collection Run Report **Details** and in MCP / diagnostics fields.

## Compare with Previous Run

After you run the same request more than once in this session, the Response panel offers **Compare with Previous Run** (also Command Palette: `API Hero: Compare with Previous Run`). The diff uses the in-session presentation ring only — not History — and compares already-redacted presentations:

- Status code
- Headers (sensitive values stay masked)
- JSON body fields as `$.path` (added / removed / changed)
- Non-JSON bodies as a simple text line diff

Sides are labeled **Previous** vs **Current**. Collection Run Report Details also offers **Compare Runs** when a prior recent collection-run presentation exists for that request (**A** vs **B** / Current).

## Generate TypeScript

For **successful JSON** responses (non-truncated Pretty body), the Response panel offers **Generate TypeScript** (also Command Palette: `API Hero: Generate TypeScript`).

API Hero infers interfaces / types from **this one observed body** — not a complete API schema. Nested objects become nested interfaces; arrays, null, empty values, and mixed element types are handled conservatively.

Then choose:

| Action | Behavior |
| --- | --- |
| Copy | Copies the generated TypeScript to the clipboard |
| Create .ts | Asks for a root interface/type name, then a save destination. Existing `.ts` files require an explicit overwrite confirmation |

Type names come from JSON **keys** only (never from string values such as tokens).

## Related

- [Creating requests](./creating-requests.md)
- [Variables](./variables.md)
- [Assertions](./assertions.md)
- [History](./history.md)
