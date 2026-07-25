# Configuration reference

All settings use the `apiRunner.*` namespace (configuration title: **API Hero**).

## Logging and HTTP

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.logLevel` | `debug` \| `info` \| `warning` \| `error` | `info` | Minimum severity for the API Hero output channel |
| `apiRunner.requestTimeout` | number (ms, ≥ 0) | `30000` | Request timeout |
| `apiRunner.maxResponseBytes` | number (≥ 0) | `10485760` | Max buffered response body; `0` = no limit. Exceeding fails with `RESPONSE_TOO_LARGE` |

## History

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.history.maxEntries` | number (1–10000) | `1000` | Retention limit; newest kept |

## Variables and environments

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.variables.global` | `{ name, value, sensitive? }[]` | `[]` | Global variables |
| `apiRunner.variables.workspace` | `{ name, value, sensitive? }[]` | `[]` | Workspace variables (avoid committing secrets) |
| `apiRunner.environments` | `{ id, name, variables }[]` | `[]` | Named environments |
| `apiRunner.activeEnvironment` | string | — | Active environment id; omit for none |

Variable `name` pattern: `^[A-Za-z_][A-Za-z0-9_.-]*$`.

## Authentication

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.authentication.profiles` | profile objects[] | `[]` | Profile metadata; secrets live in Secret Storage |

Profiles require `id` and `providerId` (`none` \| `basic` \| `bearer` \| `apiKey`). Credential fields use `{ kind: secret \| variable \| literal, … }` with `literal` requiring `unsafe: true`. API key profiles may set `name` and `location` (`header` \| `query`).

## OpenAPI import

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.import.maxFileBytes` | number (1–52428800) | `5242880` | Max OpenAPI file size |

## Collection runner

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.collectionRunner.failurePolicy` | enum | `ask` | Default failure policy for collection/folder/selected runs |

Values: `ask`, `stop-on-first-error`, `continue-on-error`, `skip-invalid-requests`.

## Language features

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiRunner.languageFeatures.hover` | boolean | `true` | Documentation hovers |
| `apiRunner.languageFeatures.outline` | boolean | `true` | Outline symbols |
| `apiRunner.languageFeatures.diagnostics` | boolean | `true` | Syntax diagnostics |

## Related

- [Commands](./commands.md)
- [Environments](../user/environments.md)
- [Authentication](../user/authentication.md)
