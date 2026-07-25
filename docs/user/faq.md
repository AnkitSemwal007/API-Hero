# FAQ

## What is the extension ID?

`ankitsemwal.api-hero`. Command IDs still use the `apiRunner.*` prefix.

## Why only Collections and History in the Activity Bar?

Managers (Environments, Auth), Overview, Response, History Detail, Run Report, and wizards open as editors or panels. That keeps the Activity Bar focused.

## Is GraphQL supported?

No. API Hero targets REST/HTTP `.api` requests. Do not expect GraphQL examples or import.

## Is OAuth2 supported?

Not yet. Use `basic`, `bearer`, or `apiKey` profiles. OAuth is on the longer-term [roadmap](../product/roadmap.md).

## Does History store response bodies?

No by default. Entries are sanitized metadata for browse, filter, and re-run.

## Can I run an entire `.api` file at once?

**Run File** is a stub. Use Collection runner for multi-request runs, or run one request at a time from the editor.

## Where are settings documented?

See [Configuration](../reference/configuration.md) and [Commands](../reference/commands.md).

## Related

- [Troubleshooting](./troubleshooting.md)
- [Getting started](./getting-started.md)
