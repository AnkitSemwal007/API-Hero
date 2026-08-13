# API Hero documentation

**API Hero** (`ankitsemwal.api-hero`) is a REST/HTTP client for VS Code. Author `.api` requests, organize collections, orchestrate **Scenarios**, manage environments and authentication, assert responses, import OpenAPI, monitor collection runs in **Execution**, and review run history.

Command IDs remain under the `apiHero.*` namespace for compatibility. See [release/stable-identifiers.md](./release/stable-identifiers.md).

| Area | Description |
| --- | --- |
| [User guide](./user/getting-started.md) | Install, author requests, GraphQL-over-HTTP, bounded WebSocket sessions, collections, env, auth, history, OpenAPI |
| [CLI (`apihero`)](./user/cli.md) | Headless npm CLI for requests, collections, and scenarios |
| [MCP server](./user/mcp.md) | Headless MCP tools for Cursor, Claude Code, Codex, and other agents |
| [Architecture](./architecture/README.md) | Extension composition and domain design |
| [Development](./development/README.md) | Repo layout, conventions, webviews, testing |
| [Reference](./reference/commands.md) | Commands and configuration |
| [Release](./release/stable-identifiers.md) | Stable IDs and Marketplace readiness |
| [Product](./product/README.md) | Vision, shipped scope, roadmap |
| [Examples](../examples/README.md) | Functional `.api` samples |

> The public CLI is **`@ankitsemwal007/api-hero`** (`apihero`). See [CLI guide](./user/cli.md). Installing the VS Code Marketplace extension does **not** put `apihero` on PATH.

## Quick links

- [Getting started](./user/getting-started.md)
- [CLI (`apihero`)](./user/cli.md)
- [MCP for AI agents](./user/mcp.md)
- [Creating requests](./user/creating-requests.md)
- [GraphQL](./user/graphql.md)
- [WebSocket](./user/websocket.md)
- [Scenarios](./user/scenarios.md)
- [Commands](./reference/commands.md)
- [Configuration](./reference/configuration.md)
- [Roadmap](./product/roadmap.md)
- [Changelog](../CHANGELOG.md)
