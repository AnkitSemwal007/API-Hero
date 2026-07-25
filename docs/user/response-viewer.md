# Response viewer

After a successful single-request run (or a completed execution result), API Hero shows a **Response** webview panel.

## What you see

- Status, timing, sizes, and content type
- Headers (sensitive values masked)
- Body preview with Pretty / Raw (and hex for binary previews)
- Assertion results when assertions ran

Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, etc.) are always masked. Large bodies are truncated for display; transport also enforces `apiRunner.maxResponseBytes`.

## Copy, save, and search

| Action | Use |
| --- | --- |
| Copy body | Clipboard from Pretty or Raw mode |
| Save body | Save dialog with a suggested filename |
| Copy headers | Clipboard |
| Search | Find within the visible body |

These actions post messages to the extension host; the webview never receives secrets beyond the already-masked presentation model.

## Related

- [Creating requests](./creating-requests.md)
- [Assertions](./assertions.md)
- [History](./history.md)
