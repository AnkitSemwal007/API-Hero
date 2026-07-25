# Git workflow

API Hero is designed for request artifacts that live in your repo.

## Commit

| Safe to commit | Keep out of git |
| --- | --- |
| `.api` request files | Sensitive variable values in workspace settings |
| Collection folders and `api-hero.collection.json` | User-scoped secrets / Secret Storage (never in files) |
| Non-secret environment names and public base URLs | Literal `unsafe` auth credentials in shared settings |
| Shared non-secret workspace variables | Personal tokens and passwords |

Prefer:

- Public URLs and IDs in environments committed to the team.
- Secrets via Auth Manager **secret** sources or user settings marked sensitive.
- `@sensitive-variable` only for local documents you do not share.

## Diff and review

`.api` files are plain text — normal PR review works. Prefer small, named requests (`@name`) for readable diffs.

## Multi-root workspaces

Collections discover under workspace folders. Open the folder that contains your `Collections` tree (or use **API Hero: Open Existing Workspace** when applicable).

## Related

- [Collections](./collections.md)
- [Environments](./environments.md)
- [Authentication](./authentication.md)
