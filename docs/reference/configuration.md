# Configuration reference

All settings use the `apiHero.*` namespace (configuration title: **API Hero**).

## Logging and HTTP

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.logLevel` | `debug` \| `info` \| `warning` \| `error` | `info` | Minimum severity for the API Hero output channel |
| `apiHero.requestTimeout` | number (ms, ≥ 0) | `30000` | Request timeout |
| `apiHero.maxResponseBytes` | number (≥ 0) | `10485760` | Max buffered response body; `0` = no limit. Exceeding fails with `RESPONSE_TOO_LARGE` |

## History

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.history.maxEntries` | number (1–10000) | `1000` | Retention limit; newest kept |

## Variables and environments

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.variables.global` | `{ name, value, sensitive? }[]` | `[]` | Global variables |
| `apiHero.variables.workspace` | `{ name, value, sensitive? }[]` | `[]` | Workspace variables (avoid committing secrets) |
| `apiHero.environments` | `{ id, name, variables }[]` | `[]` | Named environments |
| `apiHero.activeEnvironment` | string | — | Active environment id; omit for none |

Variable `name` pattern: `^[A-Za-z_][A-Za-z0-9_.-]*$`.

## Authentication

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.authentication.profiles` | profile objects[] | `[]` | Profile metadata; secrets live in Secret Storage |

Profiles require `id` and `providerId` (`none` \| `basic` \| `bearer` \| `apiKey`). Credential fields use `{ kind: secret \| variable \| literal, … }` with `literal` requiring `unsafe: true`. API key profiles may set `name` and `location` (`header` \| `query`).

## OpenAPI import

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.import.maxFileBytes` | number (1–52428800) | `5242880` | Max OpenAPI file size |

## Collection runner

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.collectionRunner.failurePolicy` | enum | `ask` | Default failure policy for collection/folder/selected runs |

Values: `ask`, `stop-on-first-error`, `continue-on-error`, `skip-invalid-requests`.

## Language features

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `apiHero.languageFeatures.hover` | boolean | `true` | Documentation hovers |
| `apiHero.languageFeatures.outline` | boolean | `true` | Outline symbols |
| `apiHero.languageFeatures.diagnostics` | boolean | `true` | Syntax diagnostics |

## Related

- [Commands](./commands.md)
- [Environments](../user/environments.md)
- [Authentication](../user/authentication.md)
